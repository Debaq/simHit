// SimHIT firmware — ESP32-C3 SuperMini
// IMU: L3G4200D (gyro) + LSM303DLHC (accel + mag) sobre I2C
// Fusión: Madgwick (Adafruit_AHRS) → yaw/pitch/roll
//
// Protocolo serial:
//   Salida (formato v1.1, 18 campos):
//     "angX;angY;angZ;gyroX;gyroY;gyroZ;angAccX;angAccY;angAccZ;linAccX;linAccY;linAccZ;magX;magY;magZ;tempC;tsMs;crc\n"
//     - 12 floats: pose (°), velocidad angular (°/s), aceleración angular (°/s²),
//       aceleración lineal (m/s²).
//     - 4 floats nuevos en v1.1: magX/Y/Z (µT, NaN si el sensor no tiene mag),
//       tempC (°C del chip giroscopio, NaN si no soportado).
//     - tsMs: uint32 en ms desde boot (millis()).
//     - crc: CRC-16 CCITT 0x1021 (init 0xFFFF) hexadecimal, calculado sobre
//       todo el payload hasta el ';' anterior (sin incluir el ';crc\n' final).
//   Salida v1.0 (14 campos): sin magX/Y/Z/tempC; el parser cliente la acepta
//   para compatibilidad con firmwares previos.
//   Salida legacy: 6 floats (firmware antiguo). Cliente tolera los 3 formatos.
//
//   Entrada: "IMU ON" | "IMU OFF" | "IMU CAL" | "IMU CAL FORCE" |
//            "IMU CLR" | "IMU STATUS"
//            "MAG CAL" | "MAG CLR" | "MAG STATUS"
//            "LASER ON" | "LASER OFF" | "LASER STATUS"
//            "FILTER SG" | "FILTER IIR" | "FILTER NONE" | "FILTER STATUS"
//            "AXES GET" | "AXES SET <12 chars>" | "AXES RESET"
//            "HELLO" | "VERSION" | "SENSOR" | "RESET"
//
//   El comando AXES configura el mapeo de ejes del sensor a los DOF de cabeza
//   (yaw/pitch/roll del paciente). Persistido en NVS clave "axes". El cliente
//   lo determina con el wizard de ejes y lo escribe via "AXES SET".
//   Formato compacto de 12 chars: 6 pares (axis,sign) en orden
//   pose.yaw pose.pitch pose.roll gyro.yaw gyro.pitch gyro.roll.
//   Ej: "x+y+z+z+x+y+" = identidad pose, gyro yaw=Z+ pitch=X+ roll=Y+.
//
//   El comando FILTER selecciona el método de cálculo de la aceleración
//   angular y se persiste en NVS (clave "accelFilt"). Default: SG.

#include <Wire.h>
#include <Preferences.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_LSM303_Accel.h>
#include <Adafruit_LSM303DLH_Mag.h>
#include <Adafruit_AHRS.h>
#include <esp_mac.h>

#define SERIAL_BAUD_RATE 460800

// Versión del firmware. Sincronizar con firmware/manifest.json cada vez que se
// haga un release. El cliente la usa para chequear actualizaciones contra el
// manifest del repo.
#define FW_VERSION_STRING "1.4.0"

// ──────────────────── Selección del driver de sensor ────────────────────
// La CI pasa -DSENSOR_DRIVER=<MACRO> al compilador para producir un .bin por
// IMU. Cuando se compila localmente (Arduino IDE) sin pasar el flag, queda
// el default L3G_LSM303. Para agregar un sensor nuevo:
//   1) Agregar su macro al bloque #define <NEW> N de abajo.
//   2) Implementar las funciones del driver con #if SENSOR_DRIVER == <NEW>
//   3) Agregar la entrada a strategy.matrix.sensor en firmware-release.yml.
#define L3G_LSM303    1
#define ICM_42688     2
#define MPU9250       3
#define BNO055        4
#define MPU_6050      5
#define ITG_ADXL_HMC  6
#define ICM_20948     7

#ifndef SENSOR_DRIVER
  #define SENSOR_DRIVER L3G_LSM303
#endif

// Banderas de capacidades del driver activo. Permiten que el resto del
// firmware decida si calibrar magnetómetro o leer la aceleración lineal.
#if SENSOR_DRIVER == L3G_LSM303
  #define IMU_HAS_MAG 1
  #define IMU_HAS_ACCEL 1
  #define IMU_NAME_LITERAL "L3G + LSM303"
#elif SENSOR_DRIVER == ICM_42688
  #define IMU_HAS_MAG 0
  #define IMU_HAS_ACCEL 1
  #define IMU_NAME_LITERAL "ICM-42688"
#elif SENSOR_DRIVER == MPU9250
  #define IMU_HAS_MAG 1
  #define IMU_HAS_ACCEL 1
  #define IMU_NAME_LITERAL "MPU-9250"
#elif SENSOR_DRIVER == BNO055
  #define IMU_HAS_MAG 1
  #define IMU_HAS_ACCEL 1
  #define IMU_NAME_LITERAL "BNO055"
#elif SENSOR_DRIVER == MPU_6050
  #define IMU_HAS_MAG 0
  #define IMU_HAS_ACCEL 1
  #define IMU_NAME_LITERAL "MPU-6050"
#elif SENSOR_DRIVER == ITG_ADXL_HMC
  #define IMU_HAS_MAG 1
  #define IMU_HAS_ACCEL 1
  #define IMU_NAME_LITERAL "ITG-3205 + ADXL345 + HMC5883L"
#elif SENSOR_DRIVER == ICM_20948
  #define IMU_HAS_MAG 1
  #define IMU_HAS_ACCEL 1
  #define IMU_NAME_LITERAL "ICM-20948"
#else
  #error "SENSOR_DRIVER no reconocido. Válidos: L3G_LSM303 | ICM_42688 | MPU9250 | BNO055 | MPU_6050 | ITG_ADXL_HMC | ICM_20948"
#endif

#define I2C_SDA_PIN 6
#define I2C_SCL_PIN 7

// Laser: GPIO3 (active-high). Driver simple: pin → resistencia → módulo laser → GND.
#define LASER_PIN 5

// Tasa de muestreo / fusión
#define SAMPLE_RATE_HZ 200.0f
static const uint32_t SAMPLE_PERIOD_US = (uint32_t)(1000000.0f / SAMPLE_RATE_HZ);

#if SENSOR_DRIVER == L3G_LSM303
// L3G4200D — driver mínimo por registros (la librería Adafruit es para L3GD20).
#define L3G_ADDR        0x69
#define L3G_WHO_AM_I    0x0F
#define L3G_CTRL_REG1   0x20
#define L3G_CTRL_REG4   0x23
#define L3G_OUT_X_L     0x28
// FS=2000 dps -> 70 mdps/LSB -> sensitivity en rad/s/LSB:
static const float L3G_SENS_RAD = 0.070f * 0.0174532925f; // ~1.2217e-3

// LSM303DLHC accel + mag
Adafruit_LSM303_Accel_Unified   accelSensor = Adafruit_LSM303_Accel_Unified(30301);
Adafruit_LSM303DLH_Mag_Unified  magSensor   = Adafruit_LSM303DLH_Mag_Unified(30302);
#endif

#if SENSOR_DRIVER == ICM_42688
// ICM-42688-P (TDK InvenSense). I2C 0x68 (AD0=0) o 0x69 (AD0=1).
// La dirección efectiva se descubre en runtime sondeando ambas (icmInit).
static uint8_t icmAddr = 0x68;  // se ajusta en icmInit() según WHO_AM_I
#define ICM_REG_BANK_SEL     0x76
#define ICM_REG_WHO_AM_I     0x75
#define ICM_REG_PWR_MGMT0    0x4E
#define ICM_REG_GYRO_CONFIG0 0x4F
#define ICM_REG_ACCEL_CONFIG0 0x50
#define ICM_REG_ACCEL_DATA_X1 0x1F   // bytes [accelX_H..accelZ_L..gyroX_H..gyroZ_L..temp_H..temp_L]
#define ICM_WHO_AM_I_VAL     0x47
// FS gyro ±2000 dps → 16.4 LSB/dps → 1/16.4 = 0.0609756 dps/LSB → 0.001064 rad/s/LSB
static const float ICM_GYRO_SENS_DPS = 1.0f / 16.4f;
// FS accel ±16g → 2048 LSB/g
static const float ICM_ACCEL_SENS_G  = 1.0f / 2048.0f;
#endif

#if SENSOR_DRIVER == MPU9250
// MPU-9250 (InvenSense, retirado pero abundante). I2C 0x68 (AD0=0) o 0x69 (AD0=1).
// AK8963 magnetómetro en 0x0C (accesible vía bypass).
static uint8_t mpuAddr = 0x68;  // se ajusta en mpuInit()
#define MPU_REG_PWR_MGMT_1   0x6B
#define MPU_REG_PWR_MGMT_2   0x6C
#define MPU_REG_GYRO_CONFIG  0x1B
#define MPU_REG_ACCEL_CONFIG 0x1C
#define MPU_REG_INT_PIN_CFG  0x37
#define MPU_REG_USER_CTRL    0x6A
#define MPU_REG_ACCEL_XOUT_H 0x3B  // bytes [ax_H,ax_L,ay,az,temp,gx,gy,gz]
#define MPU_REG_WHO_AM_I     0x75
#define MPU_WHO_AM_I_VAL     0x71
#define AK8963_ADDR          0x0C
#define AK8963_REG_CNTL1     0x0A
#define AK8963_REG_DATA_X_L  0x03   // bytes [x_L,x_H,y_L,y_H,z_L,z_H,ST2]
#define AK8963_WHO_AM_I_VAL  0x48
// FS gyro ±2000 dps → 16.4 LSB/dps
static const float MPU_GYRO_SENS_DPS = 1.0f / 16.4f;
// FS accel ±16g → 2048 LSB/g, salida en m/s²
static const float MPU_ACCEL_SENS_MS2 = 9.80665f / 2048.0f;
// AK8963 (modo 16-bit): 0.15 µT/LSB
static const float AK8963_MAG_SENS_UT = 0.15f;
#endif

#if SENSOR_DRIVER == BNO055
// BNO055 (Bosch). I2C 0x28 (default) o 0x29 (con ADR pin high).
// Fusión interna (NDOF) — no requiere Madgwick.
static uint8_t bnoAddr = 0x28;  // se ajusta en bnoInit()
#define BNO_REG_CHIP_ID      0x00
#define BNO_REG_OPR_MODE     0x3D
#define BNO_REG_PWR_MODE     0x3E
#define BNO_REG_PAGE_ID      0x07
#define BNO_REG_UNIT_SEL     0x3B
#define BNO_REG_EUL_DATA     0x1A  // 6 bytes: heading,roll,pitch (little endian)
#define BNO_REG_GYR_DATA     0x14  // 6 bytes: x,y,z (little endian)
#define BNO_REG_ACC_DATA     0x08  // 6 bytes: x,y,z (little endian)
#define BNO_OPR_MODE_NDOF    0x0C
#define BNO_CHIP_ID_VAL      0xA0
// Eulers: 1/16 °/LSB. Gyro: 16 LSB/dps. Accel: 100 LSB/(m/s²).
static const float BNO_EUL_SENS_DEG = 1.0f / 16.0f;
static const float BNO_GYR_SENS_DPS = 1.0f / 16.0f;
static const float BNO_ACC_SENS_MS2 = 1.0f / 100.0f;
#endif

#if SENSOR_DRIVER == MPU_6050
// MPU-6050 (InvenSense). Clon del MPU-9250 sin AK8963. I²C 0x68/0x69.
// WHO_AM_I @ 0x75 devuelve 0x68 (su propia 7-bit addr con bit 0 = AD0).
static uint8_t mpu6050Addr = 0x68;
#define MPU6050_REG_PWR_MGMT_1   0x6B
#define MPU6050_REG_GYRO_CONFIG  0x1B
#define MPU6050_REG_ACCEL_CONFIG 0x1C
#define MPU6050_REG_ACCEL_XOUT_H 0x3B
#define MPU6050_REG_TEMP_OUT_H   0x41
#define MPU6050_REG_WHO_AM_I     0x75
#define MPU6050_WHO_AM_I_VAL     0x68
// Gyro ±2000 dps → 16.4 LSB/dps. Accel ±16g → 2048 LSB/g.
static const float MPU6050_GYRO_SENS_DPS  = 1.0f / 16.4f;
static const float MPU6050_ACCEL_SENS_MS2 = 9.80665f / 2048.0f;
#endif

#if SENSOR_DRIVER == ITG_ADXL_HMC
// HW-579: ITG-3205 (gyro 0x68/0x69) + ADXL345 (accel 0x53) + HMC5883L (mag 0x1E).
// ⚠ Algunos clones traen QMC5883L en lugar de HMC5883L (mapping distinto).
// El driver intenta HMC primero; fallback queda en TODO.

// ITG-3205
static uint8_t itgAddr = 0x68;
#define ITG_REG_WHO_AM_I  0x00   // devuelve I²C addr (0x68/0x69)
#define ITG_REG_SMPLRT_DIV 0x15
#define ITG_REG_DLPF_FS    0x16  // ±2000 dps + LPF
#define ITG_REG_PWR_MGM    0x3E
#define ITG_REG_GYRO_XOUT_H 0x1D // 8 bytes: TEMP_H,TEMP_L,GX_H,GX_L,GY_H,GY_L,GZ_H,GZ_L
// ±2000 dps → 14.375 LSB/(°/s)
static const float ITG_GYRO_SENS_DPS = 1.0f / 14.375f;

// ADXL345
#define ADXL_ADDR          0x53
#define ADXL_REG_DEVID     0x00  // 0xE5
#define ADXL_REG_POWER_CTL 0x2D  // 0x08 = measure mode
#define ADXL_REG_DATA_FORMAT 0x31
#define ADXL_REG_BW_RATE   0x2C  // 0x0C = 400 Hz output
#define ADXL_REG_DATAX0    0x32  // 6 bytes little-endian: X_L,X_H,Y_L,Y_H,Z_L,Z_H
#define ADXL_DEVID_VAL     0xE5
// Full-res ±16g: 4 mg/LSB → m/s² / LSB
static const float ADXL_ACCEL_SENS_MS2 = 0.004f * 9.80665f;

// HMC5883L
#define HMC_ADDR           0x1E
#define HMC_REG_CONFIG_A   0x00
#define HMC_REG_CONFIG_B   0x01
#define HMC_REG_MODE       0x02
#define HMC_REG_DATA_X_H   0x03  // 6 bytes big-endian, orden raro: X,Z,Y
#define HMC_REG_ID_A       0x0A  // 'H' = 0x48
#define HMC_ID_A_VAL       0x48
// Gain por defecto ±1.3 gauss → 1090 LSB/gauss = 0.092 µT/LSB
static const float HMC_MAG_SENS_UT = 100.0f / 1090.0f;  // 1 gauss = 100 µT
#endif

#if SENSOR_DRIVER == ICM_20948
// ICM-20948 (TDK InvenSense). Sucesor industrial del MPU-9250 (en producción).
// Registros bancarios igual que ICM-42688: REG_BANK_SEL selecciona banco 0..3.
// AK09916 magnetómetro integrado (no AK8963), accesible vía bypass I²C @ 0x0C.
// I²C 0x68/0x69 autodetect. SIN testear con hardware.
static uint8_t icm20Addr = 0x68;
#define ICM20_REG_BANK_SEL       0x7F
// Bank 0
#define ICM20_REG_WHO_AM_I       0x00  // 0xEA
#define ICM20_REG_USER_CTRL      0x03
#define ICM20_REG_PWR_MGMT_1     0x06
#define ICM20_REG_PWR_MGMT_2     0x07
#define ICM20_REG_INT_PIN_CFG    0x0F
#define ICM20_REG_ACCEL_XOUT_H   0x2D  // 6 bytes accel
#define ICM20_REG_GYRO_XOUT_H    0x33  // 6 bytes gyro
#define ICM20_REG_TEMP_OUT_H     0x39  // 2 bytes temp
// Bank 2
#define ICM20_REG_GYRO_CONFIG_1  0x01  // FS_SEL bits[2:1], DLPF bits[5:3], enable bit 0
#define ICM20_REG_ACCEL_CONFIG   0x14  // FS bits[2:1], DLPF, enable
#define ICM20_WHO_AM_I_VAL       0xEA

// AK09916 (mag interno del package)
#define AK09916_ADDR             0x0C
#define AK09916_REG_WIA2         0x01  // 0x09
#define AK09916_REG_CNTL2        0x31  // modo continuo
#define AK09916_REG_HXL          0x11  // 6 bytes little-endian: x_L, x_H, y_L, y_H, z_L, z_H
#define AK09916_REG_ST2          0x18  // necesario leer para liberar buffer
#define AK09916_WIA2_VAL         0x09

// FS gyro ±2000 dps → 16.4 LSB/dps. FS accel ±16g → 2048 LSB/g.
// AK09916 mag: 0.15 µT/LSB.
static const float ICM20_GYRO_SENS_DPS  = 1.0f / 16.4f;
static const float ICM20_ACCEL_SENS_MS2 = 9.80665f / 2048.0f;
static const float AK09916_MAG_SENS_UT  = 0.15f;
#endif

// Filtro de fusión
Adafruit_Madgwick filter;

// Estado
bool start_imu = false;
bool laser_on  = false;

// Bias gyro (rad/s) — calculado en IMU CAL
float gx_bias = 0.0f, gy_bias = 0.0f, gz_bias = 0.0f;

// Hard-iron (offset) y soft-iron (escala por eje) del magnetómetro.
// Calibrados por "MAG CAL" y persistidos en NVS.
float mx_off = 0.0f, my_off = 0.0f, mz_off = 0.0f;
float mx_scl = 1.0f, my_scl = 1.0f, mz_scl = 1.0f;

Preferences prefs;

// Snapshot completo de la última calibración IMU. Persiste en NVS para
// trazabilidad (auditoría del paper, telemetría entre sesiones). Si no hay
// CAL previa en NVS, schema_version queda en 0 y el cliente lo interpreta
// como "calibrar antes del primer examen".
#pragma pack(push, 1)
struct CalState {
  uint32_t schema_version;   // 1; 0 = no cal previa
  float    bias_xyz[3];      // rad/s (resta aplicada en sampleAndFuse)
  float    sd_dps_xyz[3];    // ruido medido durante el segundo de quietud (°/s)
  float    accel_mag_ms2;    // ‖a‖ media durante CAL — debe ≈9.80
  float    accel_sd_ms2;     // varianza del módulo de accel
  float    temp_c;           // temperatura del chip al momento de la CAL
  uint32_t ts_ms;            // millis() al momento de la CAL
  uint32_t fw_hash;          // hash de FW_VERSION_STRING (CRC-16)
  uint32_t sensor_driver;    // valor del macro SENSOR_DRIVER (1..4)
};
#pragma pack(pop)
static CalState calState = {};

// Tiempo mínimo desde boot (ms) antes de aceptar IMU CAL. El gyro deriva
// rápido por auto-calentamiento del IC durante el primer minuto.
// Calibrado por driver según datasheet de cada chip:
//   L3G:        ruido alto, drift térmico significativo durante 60 s.
//   ICM-42688:  datasheet declara gyro startup ≈ 45 ms, pero el drift
//               térmico (~0.01 °/s/°C) sigue durante ~20 s post-boot.
//   MPU-9250 / MPU-6050: típico 30-40 s hasta estabilizarse.
//   BNO055:    fusión interna compensa parcialmente; 20 s es suficiente.
//   HW-579 (ITG):  ITG-3205 tiene drift térmico similar al L3G; 45 s.
// Bypaseable con "IMU CAL FORCE" para debugging o sesiones ultra-cortas.
#if SENSOR_DRIVER == L3G_LSM303
  static const uint32_t CAL_PREHEAT_MS = 60000;
#elif SENSOR_DRIVER == ICM_42688
  static const uint32_t CAL_PREHEAT_MS = 20000;
#elif SENSOR_DRIVER == MPU9250
  static const uint32_t CAL_PREHEAT_MS = 30000;
#elif SENSOR_DRIVER == MPU_6050
  static const uint32_t CAL_PREHEAT_MS = 30000;
#elif SENSOR_DRIVER == BNO055
  static const uint32_t CAL_PREHEAT_MS = 20000;
#elif SENSOR_DRIVER == ITG_ADXL_HMC
  static const uint32_t CAL_PREHEAT_MS = 45000;
#elif SENSOR_DRIVER == ICM_20948
  static const uint32_t CAL_PREHEAT_MS = 20000;
#else
  static const uint32_t CAL_PREHEAT_MS = 60000;
#endif

// Offsets de orientación (resetean a cero al CAL)
float yaw_off = 0.0f, pitch_off = 0.0f, roll_off = 0.0f;

// Wrap ±180 para mantener salida monotónica (igual que firmware BNO055)
const float wrap_threshold = 180.0f;
float prevAngleX = 0.0f, prevAngleY = 0.0f, prevAngleZ = 0.0f;
float offsetX = 0.0f, offsetY = 0.0f, offsetZ = 0.0f;

uint32_t lastSampleUs = 0;

// --- Aceleración angular calculada en hardware ---
//
// La derivada del gyro se calcula con uno de tres métodos seleccionables
// vía comando "FILTER <SG|IIR|NONE>" y persistente en NVS:
//   SG   - Savitzky-Golay 5pt, primera derivada: coef [-2,-1,0,1,2]/(10·dt).
//          Lag inherente: 2 muestras (10 ms a 200 Hz). Suaviza ruido.
//   IIR  - derivada hacia atrás (xN - xN-1)/dt suavizada por IIR con α=0.3.
//   NONE - derivada hacia atrás sin filtrado.
//
// Las muestras de gyro guardadas en el buffer son °/s (post-bias), de modo
// que la salida de la derivada queda en °/s² directamente.
enum AccelFilter { ACCEL_FILT_SG = 0, ACCEL_FILT_IIR = 1, ACCEL_FILT_NONE = 2 };
AccelFilter accelFilter = ACCEL_FILT_SG;

// Buffer circular de 5 muestras de gyro (°/s), uno por eje. Avanza con cada
// llamada a sampleAndFuse(). gyroBufFilled cuenta hasta 5 (luego se queda en 5)
// para saber si hay historia suficiente para SG.
#define GYRO_BUF_LEN 5
float gyroBufX[GYRO_BUF_LEN] = {0};
float gyroBufY[GYRO_BUF_LEN] = {0};
float gyroBufZ[GYRO_BUF_LEN] = {0};
uint8_t gyroBufIdx = 0;
uint8_t gyroBufFilled = 0;

// Estado del filtro IIR (último valor de la derivada filtrada) y de NONE/IIR
// (última muestra cruda para la derivada hacia atrás).
float angAccIirX = 0.0f, angAccIirY = 0.0f, angAccIirZ = 0.0f;
float prevGyroX = 0.0f, prevGyroY = 0.0f, prevGyroZ = 0.0f;
bool  prevGyroValid = false;

// Aceleración angular calculada en el último sampleAndFuse(), expuesta a
// emitIMU(). En °/s². Si la historia es insuficiente: 0.
float angAccX = 0.0f, angAccY = 0.0f, angAccZ = 0.0f;

// Aceleración lineal LSM303 (m/s²), capturada en sampleAndFuse().
float linAccX = 0.0f, linAccY = 0.0f, linAccZ = 0.0f;

// Última velocidad angular (°/s post-bias) usada por la derivada y emitida
// por emitIMU(). Coherente con la entrada de computeAngularAccel().
float lastGyroDpsX = 0.0f, lastGyroDpsY = 0.0f, lastGyroDpsZ = 0.0f;

// Magnetómetro (µT) y temperatura del chip (°C) capturados en sampleAndFuse()
// y emitidos por emitIMU() (formato v1.1). NaN si el sensor no los provee;
// snprintf("%.2f", NAN) → "nan" — el cliente serial los acepta como NaN en CSV.
float lastMagX = 0.0f / 0.0f, lastMagY = 0.0f / 0.0f, lastMagZ = 0.0f / 0.0f;
float lastTempC = 0.0f / 0.0f;

// Cache de temperatura decimado a ~1 Hz. La temperatura cambia mucho más
// lento que la tasa de muestreo (200 Hz); leerla en cada tick agrega
// overhead I²C innecesario. tempTickCounter cuenta hasta TEMP_REFRESH_TICKS
// y entonces el driver activo recarga cachedTempC; en el medio se emite el
// último valor conocido.
static const uint32_t TEMP_REFRESH_TICKS = 200;
static uint32_t tempTickCounter = 0;
static float cachedTempC = 0.0f / 0.0f;

static inline float radToDeg(float r) { return r * 57.2957795f; }

// CRC-16 CCITT (poly 0x1021, init 0xFFFF, sin reflexión). Calcula sobre los
// primeros `len` bytes de `data`. Emitido en hex big-endian (Serial.print HEX).
uint16_t crc16_ccitt(const char* data, size_t len) {
  uint16_t crc = 0xFFFF;
  for (size_t i = 0; i < len; i++) {
    crc ^= ((uint16_t)(uint8_t)data[i]) << 8;
    for (int b = 0; b < 8; b++) {
      crc = (crc & 0x8000) ? (uint16_t)((crc << 1) ^ 0x1021) : (uint16_t)(crc << 1);
    }
  }
  return crc;
}

// Calcula la derivada del gyro según el modo activo y la guarda en
// angAccX/Y/Z. dtSec es el período de muestreo en segundos.
void computeAngularAccel(float gxDps, float gyDps, float gzDps, float dtSec) {
  // Push al buffer circular SG (siempre, así si el usuario cambia de modo
  // en caliente no hay glitches transitorios).
  gyroBufX[gyroBufIdx] = gxDps;
  gyroBufY[gyroBufIdx] = gyDps;
  gyroBufZ[gyroBufIdx] = gzDps;
  gyroBufIdx = (gyroBufIdx + 1) % GYRO_BUF_LEN;
  if (gyroBufFilled < GYRO_BUF_LEN) gyroBufFilled++;

  if (accelFilter == ACCEL_FILT_SG) {
    if (gyroBufFilled < GYRO_BUF_LEN) {
      // Historia insuficiente en los primeros 4 ticks: emitir 0.
      angAccX = angAccY = angAccZ = 0.0f;
      return;
    }
    // Reconstruir muestras en orden cronológico [-2, -1, 0, +1, +2] a partir
    // del buffer circular. La muestra recién insertada está en (idx-1) mod L,
    // y la más antigua en idx.
    // Coeficientes SG 5pt 1ª derivada: [-2, -1, 0, 1, 2] / (10·dt).
    float sx = 0, sy = 0, sz = 0;
    for (uint8_t k = 0; k < GYRO_BUF_LEN; k++) {
      // k=0 → más antigua (coef -2); k=4 → más reciente (coef +2).
      int8_t coef = (int8_t)k - 2;
      uint8_t pos = (gyroBufIdx + k) % GYRO_BUF_LEN;
      sx += coef * gyroBufX[pos];
      sy += coef * gyroBufY[pos];
      sz += coef * gyroBufZ[pos];
    }
    float denom = 10.0f * dtSec;
    angAccX = sx / denom;
    angAccY = sy / denom;
    angAccZ = sz / denom;
  } else {
    // IIR o NONE: derivada hacia atrás.
    if (!prevGyroValid) {
      angAccX = angAccY = angAccZ = 0.0f;
      angAccIirX = angAccIirY = angAccIirZ = 0.0f;
    } else {
      float dx = (gxDps - prevGyroX) / dtSec;
      float dy = (gyDps - prevGyroY) / dtSec;
      float dz = (gzDps - prevGyroZ) / dtSec;
      if (accelFilter == ACCEL_FILT_IIR) {
        const float alpha = 0.3f;
        angAccIirX = alpha * dx + (1.0f - alpha) * angAccIirX;
        angAccIirY = alpha * dy + (1.0f - alpha) * angAccIirY;
        angAccIirZ = alpha * dz + (1.0f - alpha) * angAccIirZ;
        angAccX = angAccIirX;
        angAccY = angAccIirY;
        angAccZ = angAccIirZ;
      } else { // NONE
        angAccX = dx;
        angAccY = dy;
        angAccZ = dz;
      }
    }
    prevGyroX = gxDps;
    prevGyroY = gyDps;
    prevGyroZ = gzDps;
    prevGyroValid = true;
  }
}

const char* accelFilterName(AccelFilter f) {
  switch (f) {
    case ACCEL_FILT_SG:   return "SG";
    case ACCEL_FILT_IIR:  return "IIR";
    case ACCEL_FILT_NONE: return "NONE";
  }
  return "SG";
}

// CRC-16 reusable para hash corto de la versión del firmware en NVS. No es
// criptográfico; solo permite detectar "esta CAL fue hecha con otro fw, descartar".
static uint16_t crc16Helper(const char* s) {
  uint16_t crc = 0xFFFF;
  for (const char* p = s; *p; p++) {
    crc ^= ((uint16_t)(*p) & 0xFF) << 8;
    for (int b = 0; b < 8; b++) {
      crc = (crc & 0x8000) ? (uint16_t)((crc << 1) ^ 0x1021) : (uint16_t)(crc << 1);
    }
  }
  return crc;
}

void saveCalState() {
  prefs.begin("simhit", false);
  prefs.putBytes("cal", &calState, sizeof(calState));
  prefs.end();
}

void loadCalState() {
  prefs.begin("simhit", true);
  size_t got = prefs.getBytesLength("cal");
  if (got == sizeof(calState)) {
    prefs.getBytes("cal", &calState, sizeof(calState));
    // Si el binario es de otra versión del firmware o de otro driver, no
    // confiar en el bias (puede tener semántica distinta).
    uint16_t fwh = crc16Helper(FW_VERSION_STRING);
    if (calState.fw_hash != fwh || calState.sensor_driver != (uint32_t)SENSOR_DRIVER) {
      calState = {};
    } else {
      // Aplicar el bias persistido al estado en RAM.
      gx_bias = calState.bias_xyz[0];
      gy_bias = calState.bias_xyz[1];
      gz_bias = calState.bias_xyz[2];
    }
  } else {
    calState = {};
  }
  prefs.end();
}

void saveAccelFilter() {
  prefs.begin("simhit", false);
  prefs.putUChar("accelFilt", (uint8_t)accelFilter);
  prefs.end();
}

void loadAccelFilter() {
  prefs.begin("simhit", true);
  uint8_t v = prefs.getUChar("accelFilt", (uint8_t)ACCEL_FILT_SG);
  prefs.end();
  if (v <= (uint8_t)ACCEL_FILT_NONE) accelFilter = (AccelFilter)v;
  else accelFilter = ACCEL_FILT_SG;
}

// ──────────────────── Mapeo de ejes (AXES) ────────────────────
// Mapea cada DOF del paciente (yaw/pitch/roll) a un eje del sensor (x/y/z)
// con un signo. El firmware no aplica el mapeo a las muestras (sigue
// emitiendo angX/Y/Z y gyroX/Y/Z del sensor crudo); el cliente lo aplica al
// renderizar. Lo persistimos acá para que un equipo SimHIT pueda compartirse
// entre PCs sin perder la configuración del wizard.
struct AxisMapFW { uint8_t axis; int8_t sign; };  // axis 0=x,1=y,2=z; sign ±1
struct AxesConfigFW {
  AxisMapFW pose_yaw, pose_pitch, pose_roll;
  AxisMapFW gyro_yaw, gyro_pitch, gyro_roll;
};
static const AxesConfigFW AXES_DEFAULT = {
  {0, 1}, {1, 1}, {2, 1},     // pose: identidad
  {2, 1}, {0, 1}, {1, 1}      // gyro: yaw=Z, pitch=X, roll=Y
};
AxesConfigFW axesConfig = AXES_DEFAULT;
static const char AXIS_NAME[3] = {'x', 'y', 'z'};

bool parseAxes12(const String& s, AxesConfigFW* out) {
  if (s.length() != 12) return false;
  AxisMapFW m[6];
  for (int i = 0; i < 6; i++) {
    char c = s.charAt(2*i);
    if (c == 'x' || c == 'X') m[i].axis = 0;
    else if (c == 'y' || c == 'Y') m[i].axis = 1;
    else if (c == 'z' || c == 'Z') m[i].axis = 2;
    else return false;
    char sg = s.charAt(2*i + 1);
    if (sg == '+') m[i].sign = 1;
    else if (sg == '-') m[i].sign = -1;
    else return false;
  }
  out->pose_yaw   = m[0]; out->pose_pitch = m[1]; out->pose_roll = m[2];
  out->gyro_yaw   = m[3]; out->gyro_pitch = m[4]; out->gyro_roll = m[5];
  return true;
}

void printAxisJson(const char* label, const AxisMapFW& m, bool trailingComma) {
  Serial.print("\""); Serial.print(label);
  Serial.print("\":{\"axis\":\""); Serial.print(AXIS_NAME[m.axis]);
  Serial.print("\",\"sign\":"); Serial.print((int)m.sign);
  Serial.print("}"); if (trailingComma) Serial.print(",");
}

void printAxesJson() {
  Serial.print("AXES JSON {\"pose\":{");
  printAxisJson("yaw",   axesConfig.pose_yaw,   true);
  printAxisJson("pitch", axesConfig.pose_pitch, true);
  printAxisJson("roll",  axesConfig.pose_roll,  false);
  Serial.print("},\"gyro\":{");
  printAxisJson("yaw",   axesConfig.gyro_yaw,   true);
  printAxisJson("pitch", axesConfig.gyro_pitch, true);
  printAxisJson("roll",  axesConfig.gyro_roll,  false);
  Serial.println("}}");
}

void saveAxes() {
  prefs.begin("simhit", false);
  prefs.putBytes("axes", &axesConfig, sizeof(axesConfig));
  prefs.end();
}

void loadAxes() {
  prefs.begin("simhit", true);
  size_t got = prefs.getBytesLength("axes");
  if (got == sizeof(axesConfig)) {
    prefs.getBytes("axes", &axesConfig, sizeof(axesConfig));
    // Validar campos: axis ∈ {0,1,2}, sign ∈ {-1,+1}. Si está corrupto, default.
    AxisMapFW* arr = (AxisMapFW*)&axesConfig;
    for (int i = 0; i < 6; i++) {
      if (arr[i].axis > 2 || (arr[i].sign != 1 && arr[i].sign != -1)) {
        axesConfig = AXES_DEFAULT;
        break;
      }
    }
  } else {
    axesConfig = AXES_DEFAULT;
  }
  prefs.end();
}

void resetAxes() {
  axesConfig = AXES_DEFAULT;
  saveAxes();
}

// Lee 1 byte de un registro por I2C. Retorna -1 en error.
int readReg8(uint8_t addr, uint8_t reg) {
  Wire.beginTransmission(addr);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return -1;
  if (Wire.requestFrom((int)addr, 1) != 1) return -1;
  if (!Wire.available()) return -1;
  return Wire.read();
}

bool writeReg8(uint8_t addr, uint8_t reg, uint8_t val) {
  Wire.beginTransmission(addr);
  Wire.write(reg);
  Wire.write(val);
  return Wire.endTransmission() == 0;
}

#if SENSOR_DRIVER == L3G_LSM303
// Inicializa el L3G4200D a ±2000 dps, ODR 800 Hz, BW 50 Hz, BDU on.
bool l3gInit() {
  int who = readReg8(L3G_ADDR, L3G_WHO_AM_I);
  if (who != 0xD3) return false;
  // CTRL_REG1: DR=11 (800 Hz), BW=01 (cutoff 50), PD=1, X/Y/Z en
  // bits = 1101 1111 = 0xDF
  if (!writeReg8(L3G_ADDR, L3G_CTRL_REG1, 0xDF)) return false;
  // CTRL_REG4: BDU=1, FS=10 (2000 dps) -> 1011 0000 = 0xB0
  if (!writeReg8(L3G_ADDR, L3G_CTRL_REG4, 0xB0)) return false;
  delay(5);
  return true;
}

// Lee X/Y/Z del giroscopio en rad/s.
bool l3gRead(float& gx, float& gy, float& gz) {
  // Auto-incremento: bit 7 del subaddr
  Wire.beginTransmission(L3G_ADDR);
  Wire.write(L3G_OUT_X_L | 0x80);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((int)L3G_ADDR, 6) != 6) return false;
  uint8_t b[6];
  for (int i = 0; i < 6; i++) b[i] = Wire.read();
  int16_t rx = (int16_t)((b[1] << 8) | b[0]);
  int16_t ry = (int16_t)((b[3] << 8) | b[2]);
  int16_t rz = (int16_t)((b[5] << 8) | b[4]);
  gx = rx * L3G_SENS_RAD;
  gy = ry * L3G_SENS_RAD;
  gz = rz * L3G_SENS_RAD;
  return true;
}

// Identifica el chip giroscopio en addr 0x6A/0x6B (L3GD20/H) o 0x69 (L3G4200D).
// WHO_AM_I = registro 0x0F. Valores conocidos:
//   0xD3 -> L3G4200D
//   0xD4 -> L3GD20
//   0xD7 -> L3GD20H
void scanGyroWhoAmI() {
  const uint8_t candidates[] = { 0x6B, 0x6A, 0x69 };
  for (uint8_t a : candidates) {
    int v = readReg8(a, 0x0F);
    if (v < 0) continue;
    Serial.print("Gyro WHO_AM_I @0x");
    if (a < 0x10) Serial.print("0");
    Serial.print(a, HEX);
    Serial.print(" = 0x");
    if (v < 0x10) Serial.print("0");
    Serial.print(v, HEX);
    const char* name =
        (v == 0xD3) ? " (L3G4200D)" :
        (v == 0xD4) ? " (L3GD20)"   :
        (v == 0xD7) ? " (L3GD20H)"  : " (desconocido)";
    Serial.println(name);
  }
}

// LSM303DLHC tiene sensor de temperatura interno expuesto en TEMP_OUT_H/L
// (registros 0x31/0x32 del mag, NOT en el accel). Para habilitarlo hay que
// setear bit 7 de CRA_REG_M (0x00 del mag). La librería Adafruit no toca
// estos registros, así que lo hacemos raw — un solo write al init y reads
// posteriores. 1 LSB ≈ 1/8 °C, offset cero indeterminado (mejor para drift
// relativo que para absoluto).
//
// Dirección I²C del mag: el bloque mag del LSM303DLHC vive en 0x1E (no en
// 0x19/0x18 del accel). Adafruit_LSM303DLH_Mag_Unified ya se conectó a ese
// chip durante setup() pero no enable la temp; le hacemos un write extra.
#define LSM_MAG_ADDR    0x1E
#define LSM_CRA_REG_M   0x00
#define LSM_TEMP_OUT_H  0x31
static bool lsmTempEnabled = false;

float l3gReadTempC() {
  if (!lsmTempEnabled) {
    // Habilitar sensor de temp: bit 7 de CRA_REG_M = 1. Mantener el resto
    // de la config Adafruit dejó (output rate = 75 Hz por defecto → 0x18).
    if (writeReg8(LSM_MAG_ADDR, LSM_CRA_REG_M, 0x98)) lsmTempEnabled = true;
    else return NAN;
    delay(2);
  }
  Wire.beginTransmission((uint8_t)LSM_MAG_ADDR);
  Wire.write(LSM_TEMP_OUT_H);
  if (Wire.endTransmission(false) != 0) return NAN;
  if (Wire.requestFrom((int)LSM_MAG_ADDR, 2) != 2) return NAN;
  uint8_t h = Wire.read();
  uint8_t l = Wire.read();
  // Resultado en 12 bits con signo, alineado a la izquierda (>> 4).
  int16_t raw = (int16_t)(((uint16_t)h << 8) | l);
  raw >>= 4;
  // 1 LSB = 1/8 °C. Offset arbitrario; reportamos lectura relativa con
  // suposición de offset = 20 °C (típico empírico del LSM303DLHC).
  return ((float)raw / 8.0f) + 20.0f;
}
#endif  // SENSOR_DRIVER == L3G_LSM303

// ─────────── Driver ICM-42688 (SIN testear con hardware) ───────────
#if SENSOR_DRIVER == ICM_42688
// Lee N bytes consecutivos a partir de `reg` desde el dispositivo `addr`.
bool icmReadBytes(uint8_t addr, uint8_t reg, uint8_t* out, uint8_t n) {
  Wire.beginTransmission(addr);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((int)addr, (int)n) != n) return false;
  for (uint8_t i = 0; i < n; i++) out[i] = Wire.read();
  return true;
}

bool icmInit() {
  delay(5);
  // Sondear ambas direcciones I2C posibles. La primera que devuelva el
  // WHO_AM_I correcto queda fija en icmAddr para el resto de la sesión.
  const uint8_t candidates[] = { 0x68, 0x69 };
  bool found = false;
  for (uint8_t a : candidates) {
    int v = readReg8(a, ICM_REG_WHO_AM_I);
    if (v == ICM_WHO_AM_I_VAL) { icmAddr = a; found = true; break; }
  }
  if (!found) return false;
  // Bank 0 (registros configurables principales).
  if (!writeReg8(icmAddr, ICM_REG_BANK_SEL, 0x00)) return false;
  // PWR_MGMT0: gyro low-noise + accel low-noise (bits[3:0] = 0x0F).
  if (!writeReg8(icmAddr, ICM_REG_PWR_MGMT0, 0x0F)) return false;
  delay(50); // gyro start-up ≥45 ms
  // GYRO_CONFIG0: FS_SEL=0 (±2000 dps), ODR=0x06 (1 kHz). bits = 000 0 0110.
  if (!writeReg8(icmAddr, ICM_REG_GYRO_CONFIG0, 0x06)) return false;
  // ACCEL_CONFIG0: FS_SEL=0 (±16g), ODR=0x06 (1 kHz). bits = 000 0 0110.
  if (!writeReg8(icmAddr, ICM_REG_ACCEL_CONFIG0, 0x06)) return false;
  return true;
}

// Lee gyro y accel del ICM. gyro en rad/s, accel en m/s². Retorna false en error.
bool icmRead(float& gx, float& gy, float& gz, float& ax, float& ay, float& az) {
  uint8_t b[12];
  // Burst: ACCEL_DATA_X1..ACCEL_DATA_Z0 (6) + GYRO_DATA_X1..Z0 (6) = 12 bytes
  // Direcciones consecutivas: 0x1F..0x2A.
  if (!icmReadBytes(icmAddr, ICM_REG_ACCEL_DATA_X1, b, 12)) return false;
  int16_t rax = (int16_t)((b[0] << 8) | b[1]);
  int16_t ray = (int16_t)((b[2] << 8) | b[3]);
  int16_t raz = (int16_t)((b[4] << 8) | b[5]);
  int16_t rgx = (int16_t)((b[6] << 8) | b[7]);
  int16_t rgy = (int16_t)((b[8] << 8) | b[9]);
  int16_t rgz = (int16_t)((b[10] << 8) | b[11]);
  gx = rgx * ICM_GYRO_SENS_DPS * 0.0174532925f;
  gy = rgy * ICM_GYRO_SENS_DPS * 0.0174532925f;
  gz = rgz * ICM_GYRO_SENS_DPS * 0.0174532925f;
  ax = rax * ICM_ACCEL_SENS_G * 9.80665f;
  ay = ray * ICM_ACCEL_SENS_G * 9.80665f;
  az = raz * ICM_ACCEL_SENS_G * 9.80665f;
  return true;
}

// ICM-42688 TEMP_DATA1/0 en 0x1D/0x1E. Tempc = (raw / 132.48) + 25 (datasheet).
float icmReadTempC() {
  uint8_t b[2];
  if (!icmReadBytes(icmAddr, 0x1D, b, 2)) return NAN;
  int16_t raw = (int16_t)((b[0] << 8) | b[1]);
  return ((float)raw / 132.48f) + 25.0f;
}
#endif  // SENSOR_DRIVER == ICM_42688

// ─────────── Driver MPU-9250 (SIN testear con hardware) ───────────
#if SENSOR_DRIVER == MPU9250
bool mpuReadBytes(uint8_t addr, uint8_t reg, uint8_t* out, uint8_t n) {
  Wire.beginTransmission(addr);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((int)addr, (int)n) != n) return false;
  for (uint8_t i = 0; i < n; i++) out[i] = Wire.read();
  return true;
}

bool mpuInit() {
  delay(50);
  const uint8_t candidates[] = { 0x68, 0x69 };
  bool found = false;
  for (uint8_t a : candidates) {
    int v = readReg8(a, MPU_REG_WHO_AM_I);
    if (v == MPU_WHO_AM_I_VAL) { mpuAddr = a; found = true; break; }
  }
  if (!found) return false;
  // Wake up (PWR_MGMT_1 = 0x00, sale de sleep, clock interno).
  if (!writeReg8(mpuAddr, MPU_REG_PWR_MGMT_1, 0x00)) return false;
  delay(20);
  // PLL on, gyro como ref.
  if (!writeReg8(mpuAddr, MPU_REG_PWR_MGMT_1, 0x01)) return false;
  // Gyro ±2000 dps: FS_SEL=11 → bits[4:3]=11 → 0x18.
  if (!writeReg8(mpuAddr, MPU_REG_GYRO_CONFIG, 0x18)) return false;
  // Accel ±16g: AFS_SEL=11 → bits[4:3]=11 → 0x18.
  if (!writeReg8(mpuAddr, MPU_REG_ACCEL_CONFIG, 0x18)) return false;
  // Bypass para acceder al magnetómetro AK8963 directamente.
  if (!writeReg8(mpuAddr, MPU_REG_USER_CTRL, 0x00)) return false;
  if (!writeReg8(mpuAddr, MPU_REG_INT_PIN_CFG, 0x02)) return false;
  delay(10);
  // AK8963: modo continuous-2 (100 Hz) + 16-bit.
  writeReg8(AK8963_ADDR, AK8963_REG_CNTL1, 0x16);
  delay(10);
  return true;
}

bool mpuRead(float& gx, float& gy, float& gz, float& ax, float& ay, float& az,
             float& mx, float& my, float& mz) {
  uint8_t b[14];
  if (!mpuReadBytes(mpuAddr, MPU_REG_ACCEL_XOUT_H, b, 14)) return false;
  int16_t rax = (int16_t)((b[0] << 8) | b[1]);
  int16_t ray = (int16_t)((b[2] << 8) | b[3]);
  int16_t raz = (int16_t)((b[4] << 8) | b[5]);
  // b[6..7] = temp (ignorada)
  int16_t rgx = (int16_t)((b[8]  << 8) | b[9]);
  int16_t rgy = (int16_t)((b[10] << 8) | b[11]);
  int16_t rgz = (int16_t)((b[12] << 8) | b[13]);
  gx = rgx * MPU_GYRO_SENS_DPS * 0.0174532925f;
  gy = rgy * MPU_GYRO_SENS_DPS * 0.0174532925f;
  gz = rgz * MPU_GYRO_SENS_DPS * 0.0174532925f;
  ax = rax * MPU_ACCEL_SENS_MS2;
  ay = ray * MPU_ACCEL_SENS_MS2;
  az = raz * MPU_ACCEL_SENS_MS2;

  // Magnetómetro AK8963 (separado): leer DATA_X_L..ST2 (7 bytes). ST2 lectura
  // necesaria para liberar el buffer. Si falta, devolver ceros sin error.
  uint8_t m[7];
  if (mpuReadBytes(AK8963_ADDR, AK8963_REG_DATA_X_L, m, 7)) {
    int16_t rmx = (int16_t)((m[1] << 8) | m[0]);
    int16_t rmy = (int16_t)((m[3] << 8) | m[2]);
    int16_t rmz = (int16_t)((m[5] << 8) | m[4]);
    mx = rmx * AK8963_MAG_SENS_UT;
    my = rmy * AK8963_MAG_SENS_UT;
    mz = rmz * AK8963_MAG_SENS_UT;
  } else { mx = my = mz = 0.0f; }
  return true;
}

// MPU-9250 TEMP_OUT_H/L en 0x41/0x42. Tempc = (raw / 333.87) + 21 (datasheet rev 1.1).
float mpuReadTempC() {
  uint8_t b[2];
  if (!mpuReadBytes(mpuAddr, 0x41, b, 2)) return NAN;
  int16_t raw = (int16_t)((b[0] << 8) | b[1]);
  return ((float)raw / 333.87f) + 21.0f;
}
#endif  // SENSOR_DRIVER == MPU9250

// ─────────── Driver BNO055 (SIN testear con hardware) ───────────
#if SENSOR_DRIVER == BNO055
bool bnoReadBytes(uint8_t reg, uint8_t* out, uint8_t n) {
  Wire.beginTransmission(bnoAddr);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((int)bnoAddr, (int)n) != n) return false;
  for (uint8_t i = 0; i < n; i++) out[i] = Wire.read();
  return true;
}

bool bnoInit() {
  delay(700); // POR del BNO055: ~650 ms hasta que responde
  const uint8_t candidates[] = { 0x28, 0x29 };
  bool found = false;
  for (uint8_t a : candidates) {
    int v = readReg8(a, BNO_REG_CHIP_ID);
    if (v == BNO_CHIP_ID_VAL) { bnoAddr = a; found = true; break; }
  }
  if (!found) return false;
  // Forzar config mode antes de cambiar registros.
  writeReg8(bnoAddr, BNO_REG_OPR_MODE, 0x00);
  delay(25);
  writeReg8(bnoAddr, BNO_REG_PAGE_ID, 0x00);
  // UNIT_SEL: m/s² para accel, dps para gyro, °C, ángulos en grados.
  writeReg8(bnoAddr, BNO_REG_UNIT_SEL, 0x00);
  // Pasar a modo NDOF (9-DOF fusion completo con magnetómetro).
  writeReg8(bnoAddr, BNO_REG_OPR_MODE, BNO_OPR_MODE_NDOF);
  delay(25);
  return true;
}

// Lee ángulos Euler (heading=yaw, roll, pitch) + gyro + accel. El BNO055
// hace su propia fusión: usamos sus eulers directamente y bypaseamos Madgwick.
bool bnoRead(float& yaw_deg, float& roll_deg, float& pitch_deg,
             float& gx_rad, float& gy_rad, float& gz_rad,
             float& ax_ms2, float& ay_ms2, float& az_ms2) {
  uint8_t eul[6], gyr[6], acc[6];
  if (!bnoReadBytes(BNO_REG_EUL_DATA, eul, 6)) return false;
  if (!bnoReadBytes(BNO_REG_GYR_DATA, gyr, 6)) return false;
  if (!bnoReadBytes(BNO_REG_ACC_DATA, acc, 6)) return false;
  int16_t h = (int16_t)((eul[1] << 8) | eul[0]);
  int16_t r = (int16_t)((eul[3] << 8) | eul[2]);
  int16_t p = (int16_t)((eul[5] << 8) | eul[4]);
  yaw_deg   = h * BNO_EUL_SENS_DEG;
  roll_deg  = r * BNO_EUL_SENS_DEG;
  pitch_deg = p * BNO_EUL_SENS_DEG;
  int16_t gx = (int16_t)((gyr[1] << 8) | gyr[0]);
  int16_t gy = (int16_t)((gyr[3] << 8) | gyr[2]);
  int16_t gz = (int16_t)((gyr[5] << 8) | gyr[4]);
  gx_rad = gx * BNO_GYR_SENS_DPS * 0.0174532925f;
  gy_rad = gy * BNO_GYR_SENS_DPS * 0.0174532925f;
  gz_rad = gz * BNO_GYR_SENS_DPS * 0.0174532925f;
  int16_t ax = (int16_t)((acc[1] << 8) | acc[0]);
  int16_t ay = (int16_t)((acc[3] << 8) | acc[2]);
  int16_t az = (int16_t)((acc[5] << 8) | acc[4]);
  ax_ms2 = ax * BNO_ACC_SENS_MS2;
  ay_ms2 = ay * BNO_ACC_SENS_MS2;
  az_ms2 = az * BNO_ACC_SENS_MS2;
  return true;
}

// BNO055 TEMP en 0x34, int8_t en °C (datasheet 1.4).
float bnoReadTempC() {
  uint8_t b;
  if (!bnoReadBytes(0x34, &b, 1)) return NAN;
  return (float)((int8_t)b);
}
#endif  // SENSOR_DRIVER == BNO055

// ─────────── Driver MPU-6050 (SIN testear con hardware) ───────────
#if SENSOR_DRIVER == MPU_6050
bool mpu6050ReadBytes(uint8_t reg, uint8_t* out, uint8_t n) {
  Wire.beginTransmission(mpu6050Addr);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((int)mpu6050Addr, (int)n) != n) return false;
  for (uint8_t i = 0; i < n; i++) out[i] = Wire.read();
  return true;
}

bool mpu6050Init() {
  delay(50);
  const uint8_t candidates[] = { 0x68, 0x69 };
  bool found = false;
  for (uint8_t a : candidates) {
    int v = readReg8(a, MPU6050_REG_WHO_AM_I);
    if (v == MPU6050_WHO_AM_I_VAL) { mpu6050Addr = a; found = true; break; }
  }
  if (!found) return false;
  // Wake from sleep + clock = PLL X-gyro (más estable que oscilador interno).
  if (!writeReg8(mpu6050Addr, MPU6050_REG_PWR_MGMT_1, 0x01)) return false;
  delay(20);
  // ±2000 dps (FS_SEL=11 → bits[4:3]).
  if (!writeReg8(mpu6050Addr, MPU6050_REG_GYRO_CONFIG, 0x18)) return false;
  // ±16 g (AFS_SEL=11 → bits[4:3]).
  if (!writeReg8(mpu6050Addr, MPU6050_REG_ACCEL_CONFIG, 0x18)) return false;
  delay(10);
  return true;
}

bool mpu6050Read(float& gx, float& gy, float& gz, float& ax, float& ay, float& az) {
  uint8_t b[14];
  if (!mpu6050ReadBytes(MPU6050_REG_ACCEL_XOUT_H, b, 14)) return false;
  int16_t rax = (int16_t)((b[0] << 8) | b[1]);
  int16_t ray = (int16_t)((b[2] << 8) | b[3]);
  int16_t raz = (int16_t)((b[4] << 8) | b[5]);
  // b[6..7] = temp (ignorada en read, leída por separado)
  int16_t rgx = (int16_t)((b[8]  << 8) | b[9]);
  int16_t rgy = (int16_t)((b[10] << 8) | b[11]);
  int16_t rgz = (int16_t)((b[12] << 8) | b[13]);
  gx = rgx * MPU6050_GYRO_SENS_DPS * 0.0174532925f;
  gy = rgy * MPU6050_GYRO_SENS_DPS * 0.0174532925f;
  gz = rgz * MPU6050_GYRO_SENS_DPS * 0.0174532925f;
  ax = rax * MPU6050_ACCEL_SENS_MS2;
  ay = ray * MPU6050_ACCEL_SENS_MS2;
  az = raz * MPU6050_ACCEL_SENS_MS2;
  return true;
}

// MPU-6050 TEMP_OUT_H/L en 0x41/0x42. Tempc = (raw / 340) + 36.53 (datasheet).
float mpu6050ReadTempC() {
  uint8_t b[2];
  if (!mpu6050ReadBytes(MPU6050_REG_TEMP_OUT_H, b, 2)) return NAN;
  int16_t raw = (int16_t)((b[0] << 8) | b[1]);
  return ((float)raw / 340.0f) + 36.53f;
}
#endif  // SENSOR_DRIVER == MPU_6050

// ─────────── Driver HW-579 = ITG-3205 + ADXL345 + HMC5883L (SIN testear) ───────────
#if SENSOR_DRIVER == ITG_ADXL_HMC
bool itgReadBytes(uint8_t reg, uint8_t* out, uint8_t n) {
  Wire.beginTransmission(itgAddr);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((int)itgAddr, (int)n) != n) return false;
  for (uint8_t i = 0; i < n; i++) out[i] = Wire.read();
  return true;
}

bool adxlReadBytes(uint8_t reg, uint8_t* out, uint8_t n) {
  Wire.beginTransmission((uint8_t)ADXL_ADDR);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((int)ADXL_ADDR, (int)n) != n) return false;
  for (uint8_t i = 0; i < n; i++) out[i] = Wire.read();
  return true;
}

bool hmcReadBytes(uint8_t reg, uint8_t* out, uint8_t n) {
  Wire.beginTransmission((uint8_t)HMC_ADDR);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((int)HMC_ADDR, (int)n) != n) return false;
  for (uint8_t i = 0; i < n; i++) out[i] = Wire.read();
  return true;
}

bool itgAdxlHmcInit() {
  delay(20);
  // ITG-3205: probar 0x68 y 0x69. WHO_AM_I devuelve su propia addr.
  const uint8_t cand[] = { 0x68, 0x69 };
  bool itg_found = false;
  for (uint8_t a : cand) {
    int v = readReg8(a, ITG_REG_WHO_AM_I);
    if (v == a) { itgAddr = a; itg_found = true; break; }
  }
  if (!itg_found) return false;
  // PWR_MGM: clock = PLL X-gyro.
  if (!writeReg8(itgAddr, ITG_REG_PWR_MGM, 0x01)) return false;
  // DLPF_FS: ±2000 dps (FS_SEL=3 → bits[4:3]=11) + DLPF 42 Hz (bits[2:0]=011).
  if (!writeReg8(itgAddr, ITG_REG_DLPF_FS, 0x1B)) return false;
  // Sample rate divider: con DLPF habilitado, fs_int=1 kHz. Div=4 → 200 Hz.
  if (!writeReg8(itgAddr, ITG_REG_SMPLRT_DIV, 4)) return false;
  delay(10);

  // ADXL345: identificar y configurar full-res ±16 g a 400 Hz.
  int devid = readReg8(ADXL_ADDR, ADXL_REG_DEVID);
  if (devid != ADXL_DEVID_VAL) return false;
  if (!writeReg8(ADXL_ADDR, ADXL_REG_BW_RATE, 0x0C)) return false;     // 400 Hz
  if (!writeReg8(ADXL_ADDR, ADXL_REG_DATA_FORMAT, 0x0B)) return false; // full-res ±16g
  if (!writeReg8(ADXL_ADDR, ADXL_REG_POWER_CTL, 0x08)) return false;   // measure mode
  delay(5);

  // HMC5883L: gain default ±1.3 G, 8 promedios, modo continuo.
  // QMC5883L tiene mapping distinto — si HMC falla, el flujo sigue sin mag.
  int hmc_id = readReg8(HMC_ADDR, HMC_REG_ID_A);
  if (hmc_id == HMC_ID_A_VAL) {
    writeReg8(HMC_ADDR, HMC_REG_CONFIG_A, 0x70); // 8-avg, 15 Hz, normal
    writeReg8(HMC_ADDR, HMC_REG_CONFIG_B, 0x20); // ±1.3 G
    writeReg8(HMC_ADDR, HMC_REG_MODE, 0x00);     // continuous
    delay(10);
  }
  // El ITG es el chip indispensable; si HMC no responde, igual seguimos
  // (driver entrega mag NaN y la fusión cae a 6-DOF automáticamente).
  return true;
}

bool itgRead(float& gx, float& gy, float& gz) {
  uint8_t b[8];
  if (!itgReadBytes(ITG_REG_GYRO_XOUT_H, b, 8)) return false;
  // b[0..1] = TEMP (ignorada en read, leída por separado)
  int16_t rgx = (int16_t)((b[2] << 8) | b[3]);
  int16_t rgy = (int16_t)((b[4] << 8) | b[5]);
  int16_t rgz = (int16_t)((b[6] << 8) | b[7]);
  gx = rgx * ITG_GYRO_SENS_DPS * 0.0174532925f;
  gy = rgy * ITG_GYRO_SENS_DPS * 0.0174532925f;
  gz = rgz * ITG_GYRO_SENS_DPS * 0.0174532925f;
  return true;
}

bool adxlReadAccel(float& ax, float& ay, float& az) {
  uint8_t b[6];
  if (!adxlReadBytes(ADXL_REG_DATAX0, b, 6)) return false;
  int16_t rx = (int16_t)((b[1] << 8) | b[0]);
  int16_t ry = (int16_t)((b[3] << 8) | b[2]);
  int16_t rz = (int16_t)((b[5] << 8) | b[4]);
  ax = rx * ADXL_ACCEL_SENS_MS2;
  ay = ry * ADXL_ACCEL_SENS_MS2;
  az = rz * ADXL_ACCEL_SENS_MS2;
  return true;
}

bool hmcReadMag(float& mx, float& my, float& mz) {
  uint8_t b[6];
  if (!hmcReadBytes(HMC_REG_DATA_X_H, b, 6)) return false;
  // HMC entrega los 3 ejes en orden X, Z, Y (sí, raro). Big-endian.
  int16_t rx = (int16_t)((b[0] << 8) | b[1]);
  int16_t rz = (int16_t)((b[2] << 8) | b[3]);
  int16_t ry = (int16_t)((b[4] << 8) | b[5]);
  mx = rx * HMC_MAG_SENS_UT;
  my = ry * HMC_MAG_SENS_UT;
  mz = rz * HMC_MAG_SENS_UT;
  return true;
}

// ITG-3205 TEMP_OUT en 0x1B/0x1C. Tempc = 35 + (raw + 13200) / 280.
float itgReadTempC() {
  uint8_t b[2];
  if (!itgReadBytes(0x1B, b, 2)) return NAN;
  int16_t raw = (int16_t)((b[0] << 8) | b[1]);
  return 35.0f + ((float)raw + 13200.0f) / 280.0f;
}
#endif  // SENSOR_DRIVER == ITG_ADXL_HMC

// ─────────── Driver ICM-20948 (SIN testear con hardware) ───────────
#if SENSOR_DRIVER == ICM_20948
bool icm20ReadBytes(uint8_t addr, uint8_t reg, uint8_t* out, uint8_t n) {
  Wire.beginTransmission(addr);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((int)addr, (int)n) != n) return false;
  for (uint8_t i = 0; i < n; i++) out[i] = Wire.read();
  return true;
}

// Helper: cambiar el banco activo del ICM-20948. Registros distintos viven
// en bancos distintos; hay que conmutar antes de leer/escribir.
bool icm20SetBank(uint8_t bank) {
  return writeReg8(icm20Addr, ICM20_REG_BANK_SEL, (uint8_t)(bank << 4));
}

bool icm20Init() {
  delay(20);
  const uint8_t candidates[] = { 0x68, 0x69 };
  bool found = false;
  for (uint8_t a : candidates) {
    // WHO_AM_I siempre legible desde bank 0; setBank antes para asegurar estado.
    if (!writeReg8(a, ICM20_REG_BANK_SEL, 0x00)) continue;
    int v = readReg8(a, ICM20_REG_WHO_AM_I);
    if (v == ICM20_WHO_AM_I_VAL) { icm20Addr = a; found = true; break; }
  }
  if (!found) return false;

  // Bank 0: salir de sleep, clock auto-select.
  if (!icm20SetBank(0)) return false;
  if (!writeReg8(icm20Addr, ICM20_REG_PWR_MGMT_1, 0x01)) return false; // wake + auto-clock
  delay(20);
  // PWR_MGMT_2 = 0x00: enable gyro + accel todos los ejes.
  if (!writeReg8(icm20Addr, ICM20_REG_PWR_MGMT_2, 0x00)) return false;

  // Habilitar bypass I²C para que el AK09916 sea direccionable directo en 0x0C.
  if (!writeReg8(icm20Addr, ICM20_REG_INT_PIN_CFG, 0x02)) return false;
  if (!writeReg8(icm20Addr, ICM20_REG_USER_CTRL, 0x00)) return false; // master I²C OFF

  // Bank 2: configurar escala.
  if (!icm20SetBank(2)) return false;
  // GYRO_CONFIG_1: FS_SEL=3 (±2000 dps) bits[2:1]=11, DLPF=0, enable=1.
  if (!writeReg8(icm20Addr, ICM20_REG_GYRO_CONFIG_1, 0x07)) return false;
  // ACCEL_CONFIG: FS=3 (±16g) bits[2:1]=11, DLPF=0, enable=1.
  if (!writeReg8(icm20Addr, ICM20_REG_ACCEL_CONFIG, 0x07)) return false;
  // Volver a bank 0 para las lecturas de datos.
  if (!icm20SetBank(0)) return false;
  delay(10);

  // AK09916: modo continuo 100 Hz (CNTL2 = 0x08). WIA2 sanity check.
  int wia2 = readReg8(AK09916_ADDR, AK09916_REG_WIA2);
  if (wia2 == AK09916_WIA2_VAL) {
    writeReg8(AK09916_ADDR, AK09916_REG_CNTL2, 0x08);
    delay(10);
  }
  return true;
}

bool icm20Read(float& gx, float& gy, float& gz,
               float& ax, float& ay, float& az,
               float& mx, float& my, float& mz) {
  uint8_t a[6], g[6];
  if (!icm20ReadBytes(icm20Addr, ICM20_REG_ACCEL_XOUT_H, a, 6)) return false;
  if (!icm20ReadBytes(icm20Addr, ICM20_REG_GYRO_XOUT_H, g, 6)) return false;
  int16_t rax = (int16_t)((a[0] << 8) | a[1]);
  int16_t ray = (int16_t)((a[2] << 8) | a[3]);
  int16_t raz = (int16_t)((a[4] << 8) | a[5]);
  int16_t rgx = (int16_t)((g[0] << 8) | g[1]);
  int16_t rgy = (int16_t)((g[2] << 8) | g[3]);
  int16_t rgz = (int16_t)((g[4] << 8) | g[5]);
  gx = rgx * ICM20_GYRO_SENS_DPS * 0.0174532925f;
  gy = rgy * ICM20_GYRO_SENS_DPS * 0.0174532925f;
  gz = rgz * ICM20_GYRO_SENS_DPS * 0.0174532925f;
  ax = rax * ICM20_ACCEL_SENS_MS2;
  ay = ray * ICM20_ACCEL_SENS_MS2;
  az = raz * ICM20_ACCEL_SENS_MS2;

  // AK09916 via bypass. Mantener orden: HXL..HZH (little-endian) + ST2 para
  // liberar buffer. Si la lectura falla, devolver NaN — fusión cae a 6-DOF.
  uint8_t m[7];
  if (icm20ReadBytes(AK09916_ADDR, AK09916_REG_HXL, m, 7)) {
    int16_t rmx = (int16_t)((m[1] << 8) | m[0]);
    int16_t rmy = (int16_t)((m[3] << 8) | m[2]);
    int16_t rmz = (int16_t)((m[5] << 8) | m[4]);
    mx = rmx * AK09916_MAG_SENS_UT;
    my = rmy * AK09916_MAG_SENS_UT;
    mz = rmz * AK09916_MAG_SENS_UT;
  } else { mx = my = mz = NAN; }
  return true;
}

// ICM-20948 TEMP_OUT_H/L en 0x39/0x3A (bank 0). Tempc = (raw - 21) / 333.87 + 21.
float icm20ReadTempC() {
  uint8_t b[2];
  if (!icm20ReadBytes(icm20Addr, ICM20_REG_TEMP_OUT_H, b, 2)) return NAN;
  int16_t raw = (int16_t)((b[0] << 8) | b[1]);
  return ((float)raw - 21.0f) / 333.87f + 21.0f;
}
#endif  // SENSOR_DRIVER == ICM_20948

void setup() {
  Serial.begin(SERIAL_BAUD_RATE);
  delay(100);
  Serial.println("SimHit configure");
  // Banner de versión: el cliente lo captura como serial.firmwareVersionString
  // y lo compara contra firmware/manifest.json para detectar actualizaciones.
  Serial.print("SimHit FW ");
  Serial.println(FW_VERSION_STRING);
  // MAC del ESP32 (chip-id). El cliente lo captura como serial.espMacAddress y
  // lo incluye en sensor_profile.json para trazabilidad device-perfil.
  {
    uint8_t mac[6];
    if (esp_efuse_mac_get_default(mac) == ESP_OK) {
      char buf[24];
      snprintf(buf, sizeof(buf), "SimHit MAC %02X:%02X:%02X:%02X:%02X:%02X",
               mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
      Serial.println(buf);
    }
  }

  pinMode(LASER_PIN, OUTPUT);
  digitalWrite(LASER_PIN, LOW);

  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN, 400000);

#if SENSOR_DRIVER == L3G_LSM303
  scanGyroWhoAmI();

  Serial.println("Initializing L3G4200D...");
  if (!l3gInit()) {
    Serial.println("No L3G4200D detected");
    while (1) delay(10);
  }

  Serial.println("Initializing LSM303 accel...");
  if (!accelSensor.begin()) {
    Serial.println("No LSM303 accel detected");
    while (1) delay(10);
  }

  Serial.println("Initializing LSM303 mag...");
  if (!magSensor.begin()) {
    Serial.println("No LSM303 mag detected");
    while (1) delay(10);
  }
  // Por defecto el LSM303 va a ±1.3 gauss; con offset hard-iron alto el eje Z
  // satura en -418 μT (0xF000 overflow). Subir el rango evita la saturación.
  magSensor.setMagGain(LSM303_MAGGAIN_8_1);
  Serial.println("Mag gain set to ±8.1 gauss");
#elif SENSOR_DRIVER == ICM_42688
  // El banner mantiene formato 'Gyro WHO_AM_I @0xXX = 0xYY (...)' para que el
  // cliente serial.svelte.ts identifique el sensor sin cambios.
  {
    int who = readReg8(icmAddr, ICM_REG_WHO_AM_I);
    Serial.print("Gyro WHO_AM_I @0x"); Serial.print(icmAddr, HEX);
    Serial.print(" = 0x"); if (who < 0x10) Serial.print("0");
    Serial.print(who, HEX); Serial.println(" (ICM-42688)");
  }
  Serial.println("Initializing ICM-42688...");
  if (!icmInit()) {
    Serial.println("No ICM-42688 detected");
    while (1) delay(10);
  }
#elif SENSOR_DRIVER == MPU9250
  {
    int who = readReg8(mpuAddr, MPU_REG_WHO_AM_I);
    Serial.print("Gyro WHO_AM_I @0x"); Serial.print(mpuAddr, HEX);
    Serial.print(" = 0x"); if (who < 0x10) Serial.print("0");
    Serial.print(who, HEX); Serial.println(" (MPU9250)");
  }
  Serial.println("Initializing MPU-9250...");
  if (!mpuInit()) {
    Serial.println("No MPU-9250 detected");
    while (1) delay(10);
  }
#elif SENSOR_DRIVER == BNO055
  {
    int who = readReg8(bnoAddr, BNO_REG_CHIP_ID);
    Serial.print("Gyro WHO_AM_I @0x"); Serial.print(bnoAddr, HEX);
    Serial.print(" = 0x"); if (who < 0x10) Serial.print("0");
    Serial.print(who, HEX); Serial.println(" (BNO055)");
  }
  Serial.println("Initializing BNO055...");
  if (!bnoInit()) {
    Serial.println("No BNO055 detected");
    while (1) delay(10);
  }
#elif SENSOR_DRIVER == MPU_6050
  {
    int who = readReg8(mpu6050Addr, MPU6050_REG_WHO_AM_I);
    Serial.print("Gyro WHO_AM_I @0x"); Serial.print(mpu6050Addr, HEX);
    Serial.print(" = 0x"); if (who < 0x10) Serial.print("0");
    Serial.print(who, HEX); Serial.println(" (MPU-6050)");
  }
  Serial.println("Initializing MPU-6050...");
  if (!mpu6050Init()) {
    Serial.println("No MPU-6050 detected");
    while (1) delay(10);
  }
#elif SENSOR_DRIVER == ITG_ADXL_HMC
  {
    int who = readReg8(itgAddr, ITG_REG_WHO_AM_I);
    Serial.print("Gyro WHO_AM_I @0x"); Serial.print(itgAddr, HEX);
    Serial.print(" = 0x"); if (who < 0x10) Serial.print("0");
    Serial.print(who, HEX); Serial.println(" (ITG-3205)");
  }
  Serial.println("Initializing HW-579 (ITG-3205 + ADXL345 + HMC5883L)...");
  if (!itgAdxlHmcInit()) {
    Serial.println("No HW-579 detected (revisar ITG y ADXL al menos)");
    while (1) delay(10);
  }
#elif SENSOR_DRIVER == ICM_20948
  {
    if (writeReg8(icm20Addr, ICM20_REG_BANK_SEL, 0x00)) {
      int who = readReg8(icm20Addr, ICM20_REG_WHO_AM_I);
      Serial.print("Gyro WHO_AM_I @0x"); Serial.print(icm20Addr, HEX);
      Serial.print(" = 0x"); if (who < 0x10) Serial.print("0");
      Serial.print(who, HEX); Serial.println(" (ICM-20948)");
    }
  }
  Serial.println("Initializing ICM-20948...");
  if (!icm20Init()) {
    Serial.println("No ICM-20948 detected");
    while (1) delay(10);
  }
#endif

  filter.begin(SAMPLE_RATE_HZ);

  // Cargar última CAL persistida en NVS (si existe y es coherente con el
  // firmware/driver actual). Mantiene la trazabilidad entre power-cycles.
  loadCalState();
  loadMagCal();
  loadAccelFilter();
  Serial.print("Accel filter = ");
  Serial.println(accelFilterName(accelFilter));

  // Mapeo de ejes persistido — el cliente lo lee del banner para evitar un
  // round-trip con "AXES GET" al conectar.
  loadAxes();
  printAxesJson();

  lastSampleUs = micros();
  Serial.println("SimHit start");
}

void loop() {
  uint32_t now = micros();
  if ((int32_t)(now - lastSampleUs) >= (int32_t)SAMPLE_PERIOD_US) {
    lastSampleUs += SAMPLE_PERIOD_US;
    sampleAndFuse();
    if (start_imu) emitIMU();
  }

  if (Serial.available()) {
    String command = Serial.readStringUntil('\n');
    handleCommand(command);
  }
}

// Lee los tres sensores y actualiza el filtro. Mantener el filtro
// "caliente" aunque IMU OFF para evitar transitorios al activar.
//
// Política: el firmware reporta lo que físicamente puede leer. Cualquier eje
// no soportado por el chip (o ilegible) queda como NaN. La decisión de
// "fusión 6-DOF vs 9-DOF" es runtime — depende de si los 3 ejes de mag son
// finitos en este tick. Sin compile-time policy por sensor. Esto deja que
// el software decida cómo interpretar el dataset.
void sampleAndFuse() {
  // Locales en unidades canónicas (rad/s, m/s², µT, °C). Default NaN.
  float gx_rad = NAN, gy_rad = NAN, gz_rad = NAN;
  float ax_ms2 = NAN, ay_ms2 = NAN, az_ms2 = NAN;
  float mx_uT  = NAN, my_uT  = NAN, mz_uT  = NAN;

  // Refresh decimado de temperatura: ~1 Hz (cada TEMP_REFRESH_TICKS muestras).
  // En el tick correspondiente se llama al ReadTempC del driver activo y se
  // cachea; el resto de los ticks reemiten el último valor conocido. Esto
  // permite registrar temperatura por muestra en el CSV de la captura
  // estática (clave para Allan-variance largo) sin agregar overhead I²C.
  if (++tempTickCounter >= TEMP_REFRESH_TICKS) {
    tempTickCounter = 0;
#if SENSOR_DRIVER == L3G_LSM303
    cachedTempC = l3gReadTempC();
#elif SENSOR_DRIVER == ICM_42688
    cachedTempC = icmReadTempC();
#elif SENSOR_DRIVER == MPU9250
    cachedTempC = mpuReadTempC();
#elif SENSOR_DRIVER == BNO055
    cachedTempC = bnoReadTempC();
#elif SENSOR_DRIVER == MPU_6050
    cachedTempC = mpu6050ReadTempC();
#elif SENSOR_DRIVER == ITG_ADXL_HMC
    cachedTempC = itgReadTempC();
#elif SENSOR_DRIVER == ICM_20948
    cachedTempC = icm20ReadTempC();
#endif
  }
  float tempC = cachedTempC;
  // Solo el BNO055 expone Eulers ya fusionados.
  float bno_yaw = NAN, bno_pitch = NAN, bno_roll = NAN;

#if SENSOR_DRIVER == L3G_LSM303
  sensors_event_t ae, me;
  l3gRead(gx_rad, gy_rad, gz_rad);
  accelSensor.getEvent(&ae);
  magSensor.getEvent(&me);
  ax_ms2 = ae.acceleration.x; ay_ms2 = ae.acceleration.y; az_ms2 = ae.acceleration.z;
  mx_uT = me.magnetic.x; my_uT = me.magnetic.y; mz_uT = me.magnetic.z;

#elif SENSOR_DRIVER == ICM_42688
  icmRead(gx_rad, gy_rad, gz_rad, ax_ms2, ay_ms2, az_ms2);
  // Sin magnetómetro físico; los ejes mag quedan NaN.

#elif SENSOR_DRIVER == MPU9250
  mpuRead(gx_rad, gy_rad, gz_rad, ax_ms2, ay_ms2, az_ms2, mx_uT, my_uT, mz_uT);

#elif SENSOR_DRIVER == BNO055
  bnoRead(bno_yaw, bno_roll, bno_pitch, gx_rad, gy_rad, gz_rad, ax_ms2, ay_ms2, az_ms2);
  // El BNO055 tiene mag interno pero la fusión Bosch ya lo usó. No lo
  // exponemos crudo para no sumar lecturas I2C (pendiente si se necesita).

#elif SENSOR_DRIVER == MPU_6050
  mpu6050Read(gx_rad, gy_rad, gz_rad, ax_ms2, ay_ms2, az_ms2);
  // MPU-6050 sin magnetómetro; mag_uT queda NaN.

#elif SENSOR_DRIVER == ITG_ADXL_HMC
  itgRead(gx_rad, gy_rad, gz_rad);
  adxlReadAccel(ax_ms2, ay_ms2, az_ms2);
  // Si HMC no respondió al init, hmcReadMag falla → mag queda NaN y la
  // fusión cae a 6-DOF automáticamente.
  if (!hmcReadMag(mx_uT, my_uT, mz_uT)) { mx_uT = my_uT = mz_uT = NAN; }

#elif SENSOR_DRIVER == ICM_20948
  icm20Read(gx_rad, gy_rad, gz_rad, ax_ms2, ay_ms2, az_ms2, mx_uT, my_uT, mz_uT);
#endif

  // Bias + conversión a °/s
  float gx_dps = radToDeg(gx_rad - gx_bias);
  float gy_dps = radToDeg(gy_rad - gy_bias);
  float gz_dps = radToDeg(gz_rad - gz_bias);

  computeAngularAccel(gx_dps, gy_dps, gz_dps, 1.0f / SAMPLE_RATE_HZ);

  // Estado global expuesto a emitIMU(): los NaN se serializan tal cual.
  lastGyroDpsX = gx_dps; lastGyroDpsY = gy_dps; lastGyroDpsZ = gz_dps;
  linAccX = ax_ms2; linAccY = ay_ms2; linAccZ = az_ms2;
  lastMagX = mx_uT;  lastMagY = my_uT;  lastMagZ = mz_uT;
  lastTempC = tempC;

  // Fusión genérica: 9-DOF si los 3 ejes mag son finitos, 6-DOF si alguno
  // es NaN. La calibración hard/soft-iron se aplica solo cuando hay datos.
  bool mag_ok = isfinite(mx_uT) && isfinite(my_uT) && isfinite(mz_uT);
  if (mag_ok) {
    float mxc = (mx_uT - mx_off) * mx_scl;
    float myc = (my_uT - my_off) * my_scl;
    float mzc = (mz_uT - mz_off) * mz_scl;
    filter.update(gx_dps, gy_dps, gz_dps, ax_ms2, ay_ms2, az_ms2, mxc, myc, mzc);
  } else {
    filter.updateIMU(gx_dps, gy_dps, gz_dps, ax_ms2, ay_ms2, az_ms2);
  }

#if SENSOR_DRIVER == BNO055
  // El BNO055 fusionó por su cuenta. Sincronizamos los offsets para que
  // filter.getYaw/Pitch/Roll - off devuelva los eulers internos del chip,
  // que son más precisos que Madgwick sobre los crudos. La llamada a
  // filter.updateIMU/update de arriba mantiene el estado interno coherente.
  if (bno_yaw > 180.0f) bno_yaw -= 360.0f;
  yaw_off   = filter.getYaw()   - bno_yaw;
  pitch_off = filter.getPitch() - bno_pitch;
  roll_off  = filter.getRoll()  - bno_roll;
#endif
}

void emitIMU() {
  // Usar la última lectura de gyro y aceleración hechas en sampleAndFuse():
  // así emit y derivada son coherentes (misma muestra) y se evita una
  // lectura I2C adicional por tick.
  float gx_dps = lastGyroDpsX;
  float gy_dps = lastGyroDpsY;
  float gz_dps = lastGyroDpsZ;

  float yaw   = filter.getYaw()   - yaw_off;
  float pitch = filter.getPitch() - pitch_off;
  float roll  = filter.getRoll()  - roll_off;

  float adjustedAngleX = adjustDiscontinuity(yaw,   prevAngleX, offsetX);
  float adjustedAngleY = adjustDiscontinuity(pitch, prevAngleY, offsetY);
  float adjustedAngleZ = adjustDiscontinuity(roll,  prevAngleZ, offsetZ);

  prevAngleX = yaw;
  prevAngleY = pitch;
  prevAngleZ = roll;

  uint32_t now_ms = millis();

  // Armar payload completo (sin CRC) en un buffer para calcular CRC-16 sobre
  // el mismo bytestream que el cliente verá. Formato v1.1 (18 campos): se
  // agregaron magX/Y/Z (µT) y tempC (°C) antes del timestamp. NaN cuando el
  // sensor no los provee; snprintf("%.2f", NAN) imprime "nan" y el cliente
  // lo acepta como Number.NaN al parsear.
  char line[224];
  int n = snprintf(line, sizeof(line),
    "%.2f;%.2f;%.2f;%.2f;%.2f;%.2f;%.2f;%.2f;%.2f;%.2f;%.2f;%.2f;%.2f;%.2f;%.2f;%.2f;%lu",
    adjustedAngleX, adjustedAngleY, adjustedAngleZ,
    gx_dps, gy_dps, gz_dps,
    angAccX, angAccY, angAccZ,
    linAccX, linAccY, linAccZ,
    lastMagX, lastMagY, lastMagZ, lastTempC,
    (unsigned long)now_ms);
  if (n < 0 || n >= (int)sizeof(line)) {
    // Truncamiento improbable: descartar la línea para no enviar CRC mal calculado.
    return;
  }
  uint16_t crc = crc16_ccitt(line, (size_t)n);

  // Emitir todo en una sola línea, sin flush intermedio.
  Serial.print(line);
  Serial.print(';');
  // Imprimir CRC como hex de 4 dígitos en mayúsculas, padding con ceros.
  if (crc < 0x1000) Serial.print('0');
  if (crc < 0x0100) Serial.print('0');
  if (crc < 0x0010) Serial.print('0');
  Serial.println(crc, HEX);
}

float adjustDiscontinuity(float currentAngle, float prevAngle, float &offset) {
  float adjustedAngle = currentAngle + offset;
  float diff = currentAngle - prevAngle;
  if (fabsf(diff) > wrap_threshold) {
    if (diff > 0) offset -= 360.0f;
    else          offset += 360.0f;
    adjustedAngle = currentAngle + offset;
  }
  return adjustedAngle;
}

void handleCommand(String command) {
  command.trim();
  if (command == "IMU ON") {
    start_imu = true;
  } else if (command == "IMU OFF") {
    start_imu = false;
  } else if (command == "IMU CAL") {
    calibrateIMU(false);
  } else if (command == "IMU CAL FORCE") {
    calibrateIMU(true);
  } else if (command == "IMU CLR") {
    clearImuCal();
  } else if (command == "IMU STATUS") {
    printImuStatus();
  } else if (command == "MAG CAL") {
    calibrateMag();
  } else if (command == "MAG CLR") {
    clearMagCal();
  } else if (command == "MAG STATUS") {
    printMagStatus();
  } else if (command == "LASER ON") {
    laser_on = true;
    digitalWrite(LASER_PIN, HIGH);
    Serial.println("LASER ON");
  } else if (command == "LASER OFF") {
    laser_on = false;
    digitalWrite(LASER_PIN, LOW);
    Serial.println("LASER OFF");
  } else if (command == "LASER STATUS") {
    Serial.print("LASER STATUS ");
    Serial.println(laser_on ? "ON" : "OFF");
  } else if (command == "FILTER SG") {
    accelFilter = ACCEL_FILT_SG;
    prevGyroValid = false;
    angAccIirX = angAccIirY = angAccIirZ = 0.0f;
    saveAccelFilter();
    Serial.println("FILTER SG");
  } else if (command == "FILTER IIR") {
    accelFilter = ACCEL_FILT_IIR;
    prevGyroValid = false;
    angAccIirX = angAccIirY = angAccIirZ = 0.0f;
    saveAccelFilter();
    Serial.println("FILTER IIR");
  } else if (command == "FILTER NONE") {
    accelFilter = ACCEL_FILT_NONE;
    prevGyroValid = false;
    saveAccelFilter();
    Serial.println("FILTER NONE");
  } else if (command == "FILTER STATUS") {
    Serial.print("FILTER STATUS ");
    Serial.println(accelFilterName(accelFilter));
  } else if (command == "AXES GET") {
    printAxesJson();
  } else if (command.startsWith("AXES SET ")) {
    String payload = command.substring(9);
    payload.trim();
    AxesConfigFW parsed;
    if (parseAxes12(payload, &parsed)) {
      axesConfig = parsed;
      saveAxes();
      printAxesJson();
    } else {
      Serial.println("AXES SET fail invalid_format");
    }
  } else if (command == "AXES RESET") {
    resetAxes();
    printAxesJson();
  } else if (command == "HELLO") {
    Serial.println("HELLO");
  } else if (command == "VERSION") {
    // Respuesta de query explícita. Útil para clientes que se conectan a un
    // firmware ya inicializado (perdieron el banner de boot).
    Serial.print("VERSION ");
    Serial.println(FW_VERSION_STRING);
  } else if (command == "SENSOR") {
    // Re-emite el banner Gyro WHO_AM_I para clientes que perdieron el del boot.
#if SENSOR_DRIVER == L3G_LSM303
    scanGyroWhoAmI();
#elif SENSOR_DRIVER == ICM_42688
    int who = readReg8(icmAddr, ICM_REG_WHO_AM_I);
    Serial.print("Gyro WHO_AM_I @0x"); Serial.print(icmAddr, HEX);
    Serial.print(" = 0x"); if (who < 0x10) Serial.print("0");
    Serial.print(who, HEX); Serial.println(" (ICM-42688)");
#elif SENSOR_DRIVER == MPU9250
    int who = readReg8(mpuAddr, MPU_REG_WHO_AM_I);
    Serial.print("Gyro WHO_AM_I @0x"); Serial.print(mpuAddr, HEX);
    Serial.print(" = 0x"); if (who < 0x10) Serial.print("0");
    Serial.print(who, HEX); Serial.println(" (MPU9250)");
#elif SENSOR_DRIVER == BNO055
    int who = readReg8(bnoAddr, BNO_REG_CHIP_ID);
    Serial.print("Gyro WHO_AM_I @0x"); Serial.print(bnoAddr, HEX);
    Serial.print(" = 0x"); if (who < 0x10) Serial.print("0");
    Serial.print(who, HEX); Serial.println(" (BNO055)");
#elif SENSOR_DRIVER == MPU_6050
    int who = readReg8(mpu6050Addr, MPU6050_REG_WHO_AM_I);
    Serial.print("Gyro WHO_AM_I @0x"); Serial.print(mpu6050Addr, HEX);
    Serial.print(" = 0x"); if (who < 0x10) Serial.print("0");
    Serial.print(who, HEX); Serial.println(" (MPU-6050)");
#elif SENSOR_DRIVER == ITG_ADXL_HMC
    int who = readReg8(itgAddr, ITG_REG_WHO_AM_I);
    Serial.print("Gyro WHO_AM_I @0x"); Serial.print(itgAddr, HEX);
    Serial.print(" = 0x"); if (who < 0x10) Serial.print("0");
    Serial.print(who, HEX); Serial.println(" (ITG-3205)");
#elif SENSOR_DRIVER == ICM_20948
    if (writeReg8(icm20Addr, ICM20_REG_BANK_SEL, 0x00)) {
      int who = readReg8(icm20Addr, ICM20_REG_WHO_AM_I);
      Serial.print("Gyro WHO_AM_I @0x"); Serial.print(icm20Addr, HEX);
      Serial.print(" = 0x"); if (who < 0x10) Serial.print("0");
      Serial.print(who, HEX); Serial.println(" (ICM-20948)");
    }
#endif
  } else if (command == "RESET") {
    Serial.println("Reiniciando...");
    delay(10);
    ESP.restart();
  }
  // OLED/LED bar retirados; comandos O*/BAR* se ignoran.
}

// Umbral de movimiento permitido durante CAL, en °/s, según el ruido típico
// del sensor. Pasar el umbral significa "está moviendo el sensor, repetir CAL".
//   L3G:         ruido ~0.5-1 °/s → umbral 3 dps (margen ×3-6).
//   ICM-42688:   ruido <0.1 °/s   → umbral 0.5 dps (sobra margen).
//   MPU9250:     ruido ~0.2 °/s   → umbral 0.8 dps.
//   BNO055:      bypass (no aplicamos bias propio; reportamos sd a título informativo).
#if SENSOR_DRIVER == L3G_LSM303
  static const float CAL_MOTION_LIMIT_DPS = 3.0f;
  static const uint32_t CAL_SAMPLE_DELAY_MS = 5;   // 200 Hz → coincide con ODR
#elif SENSOR_DRIVER == ICM_42688
  static const float CAL_MOTION_LIMIT_DPS = 0.5f;
  static const uint32_t CAL_SAMPLE_DELAY_MS = 5;   // ICM corre a 1 kHz → 200 Hz CAL OK
#elif SENSOR_DRIVER == MPU9250
  static const float CAL_MOTION_LIMIT_DPS = 0.8f;
  static const uint32_t CAL_SAMPLE_DELAY_MS = 5;
#elif SENSOR_DRIVER == BNO055
  static const float CAL_MOTION_LIMIT_DPS = 1.5f;  // solo informativo
  static const uint32_t CAL_SAMPLE_DELAY_MS = 10;  // BNO en NDOF corre a 100 Hz
#elif SENSOR_DRIVER == MPU_6050
  static const float CAL_MOTION_LIMIT_DPS = 1.0f;  // ruido típico 0.3 °/s
  static const uint32_t CAL_SAMPLE_DELAY_MS = 5;
#elif SENSOR_DRIVER == ITG_ADXL_HMC
  static const float CAL_MOTION_LIMIT_DPS = 1.5f;  // ITG-3205, ruido ~0.5 °/s
  static const uint32_t CAL_SAMPLE_DELAY_MS = 5;
#elif SENSOR_DRIVER == ICM_20948
  static const float CAL_MOTION_LIMIT_DPS = 0.6f;  // gyro de la familia ICM, ruido bajo
  static const uint32_t CAL_SAMPLE_DELAY_MS = 5;
#endif

// Validaciones aceptables del accel durante el segundo de quietud:
//   - Módulo medio ≈ 9.80 m/s² (gravedad). Permite ±0.5 (sensor inclinado OK).
//   - σ del módulo < 0.10 m/s² → si la mano tiembla, el módulo varía.
static const float CAL_ACCEL_NOMINAL_MS2 = 9.80665f;
static const float CAL_ACCEL_TOL_MS2     = 0.5f;
static const float CAL_ACCEL_SD_LIMIT    = 0.10f;

void calibrateIMU(bool force) {
  // Pre-warm-up: el gyro auto-calienta y el bias deriva en el primer minuto.
  // CAL prematura captura un bias que cambiará. force=true bypasea (debug).
  uint32_t ms_since_boot = millis();
  if (!force && ms_since_boot < CAL_PREHEAT_MS) {
    Serial.print("IMU CAL fail preheat remain_ms=");
    Serial.print((unsigned long)(CAL_PREHEAT_MS - ms_since_boot));
    Serial.print(" (boot_ms=");
    Serial.print((unsigned long)ms_since_boot);
    Serial.println(") - usar IMU CAL FORCE para saltar");
    return;
  }

  // Mantener 1 s de muestreo independiente del ODR del sensor.
  const int numSamples = (int)(1000 / CAL_SAMPLE_DELAY_MS);

  bool prev_start = start_imu;
  start_imu = false;

  Serial.println("IMU CAL start - mantener quieto 1s");

  double sx = 0, sy = 0, sz = 0;
  double sxx = 0, syy = 0, szz = 0;
  // Acumuladores de validación del accel.
  double sa = 0, saa = 0;
  int    accelN = 0;
  // Detector de muestras gyro repetidas bit a bit (ODR sub-stated → varianza falsa).
  int    repeats = 0;
  int16_t prevR[3] = { 0, 0, 0 };
  bool    hasPrevR = false;

  for (int i = 0; i < numSamples; i++) {
    float grx = 0, gry = 0, grz = 0;
    float ax = NAN, ay = NAN, az = NAN;
#if SENSOR_DRIVER == L3G_LSM303
    l3gRead(grx, gry, grz);
    sensors_event_t ae; accelSensor.getEvent(&ae);
    ax = ae.acceleration.x; ay = ae.acceleration.y; az = ae.acceleration.z;
#elif SENSOR_DRIVER == ICM_42688
    icmRead(grx, gry, grz, ax, ay, az);
#elif SENSOR_DRIVER == MPU9250
    float mx_dummy, my_dummy, mz_dummy;
    mpuRead(grx, gry, grz, ax, ay, az, mx_dummy, my_dummy, mz_dummy);
#elif SENSOR_DRIVER == BNO055
    uint8_t b[6];
    if (bnoReadBytes(BNO_REG_GYR_DATA, b, 6)) {
      int16_t rgx = (int16_t)((b[1] << 8) | b[0]);
      int16_t rgy = (int16_t)((b[3] << 8) | b[2]);
      int16_t rgz = (int16_t)((b[5] << 8) | b[4]);
      if (hasPrevR && rgx == prevR[0] && rgy == prevR[1] && rgz == prevR[2]) repeats++;
      prevR[0] = rgx; prevR[1] = rgy; prevR[2] = rgz; hasPrevR = true;
      grx = rgx * BNO_GYR_SENS_DPS * 0.0174532925f;
      gry = rgy * BNO_GYR_SENS_DPS * 0.0174532925f;
      grz = rgz * BNO_GYR_SENS_DPS * 0.0174532925f;
    }
    if (bnoReadBytes(BNO_REG_ACC_DATA, b, 6)) {
      int16_t rx = (int16_t)((b[1] << 8) | b[0]);
      int16_t ry = (int16_t)((b[3] << 8) | b[2]);
      int16_t rz = (int16_t)((b[5] << 8) | b[4]);
      ax = rx * BNO_ACC_SENS_MS2; ay = ry * BNO_ACC_SENS_MS2; az = rz * BNO_ACC_SENS_MS2;
    }
#elif SENSOR_DRIVER == MPU_6050
    mpu6050Read(grx, gry, grz, ax, ay, az);
#elif SENSOR_DRIVER == ITG_ADXL_HMC
    itgRead(grx, gry, grz);
    adxlReadAccel(ax, ay, az);
#elif SENSOR_DRIVER == ICM_20948
    float mx_dummy, my_dummy, mz_dummy;
    icm20Read(grx, gry, grz, ax, ay, az, mx_dummy, my_dummy, mz_dummy);
#endif
    sx += grx; sy += gry; sz += grz;
    sxx += (double)grx * grx;
    syy += (double)gry * gry;
    szz += (double)grz * grz;
    if (isfinite(ax) && isfinite(ay) && isfinite(az)) {
      double mag = sqrt((double)ax*ax + (double)ay*ay + (double)az*az);
      sa += mag; saa += mag * mag; accelN++;
    }
    delay(CAL_SAMPLE_DELAY_MS);
  }

  float bx = (float)(sx / numSamples);
  float by = (float)(sy / numSamples);
  float bz = (float)(sz / numSamples);
  float vx = (float)(sxx / numSamples) - bx * bx;
  float vy = (float)(syy / numSamples) - by * by;
  float vz = (float)(szz / numSamples) - bz * bz;
  if (vx < 0) vx = 0; if (vy < 0) vy = 0; if (vz < 0) vz = 0;
  float sdx = radToDeg(sqrtf(vx));
  float sdy = radToDeg(sqrtf(vy));
  float sdz = radToDeg(sqrtf(vz));
  float sdMax = sdx; if (sdy > sdMax) sdMax = sdy; if (sdz > sdMax) sdMax = sdz;

  // Estadísticos del accel (si hubo lecturas válidas).
  float aMag = 0, aSd = 0;
  if (accelN > 1) {
    aMag = (float)(sa / accelN);
    float aVar = (float)(saa / accelN) - aMag * aMag;
    if (aVar < 0) aVar = 0;
    aSd = sqrtf(aVar);
  }

  // --- Razones de fallo, en orden de prioridad ---

  // (a) ODR mal estimado: el chip no entregó muestras nuevas en cada delay.
  //     Solo BNO055 hace este check explícito (el más expuesto al problema).
  if (repeats * 100 > numSamples * 30) {
    Serial.print("IMU CAL fail repeats="); Serial.print(repeats);
    Serial.print("/"); Serial.print(numSamples);
    Serial.println(" - ODR del chip menor al esperado");
    start_imu = prev_start;
    return;
  }

  // (b) Movimiento durante el segundo de quietud (gyro stddev).
  if (sdMax > CAL_MOTION_LIMIT_DPS) {
    Serial.print("IMU CAL fail motion sd=");
    Serial.print(sdx, 3); Serial.print(",");
    Serial.print(sdy, 3); Serial.print(",");
    Serial.print(sdz, 3);
    Serial.print(" limit="); Serial.print(CAL_MOTION_LIMIT_DPS, 2);
    Serial.println(" dps");
    start_imu = prev_start;
    return;
  }

  // (c) Gravedad anómala: sensor no está soportado por gravedad, está en
  //     caída libre, o el accel está dañado.
  if (accelN > 0 && fabs(aMag - CAL_ACCEL_NOMINAL_MS2) > CAL_ACCEL_TOL_MS2) {
    Serial.print("IMU CAL fail gravity mag="); Serial.print(aMag, 3);
    Serial.print(" expected~"); Serial.print(CAL_ACCEL_NOMINAL_MS2, 2);
    Serial.println(" m/s2");
    start_imu = prev_start;
    return;
  }

  // (d) Accel ruidoso: la mano tiembla aunque el gyro pase. Vibración mecánica.
  if (accelN > 1 && aSd > CAL_ACCEL_SD_LIMIT) {
    Serial.print("IMU CAL fail accel_noise sd=");
    Serial.print(aSd, 4); Serial.print(" limit=");
    Serial.print(CAL_ACCEL_SD_LIMIT, 2); Serial.println(" m/s2");
    start_imu = prev_start;
    return;
  }

  // --- Aplicar resultado ---
#if SENSOR_DRIVER == BNO055
  // BNO055: la fusión Bosch ya descuenta bias. No aplicar el nuestro.
  gx_bias = gy_bias = gz_bias = 0.0f;
#else
  gx_bias = bx;
  gy_bias = by;
  gz_bias = bz;
#endif

  yaw_off   = filter.getYaw();
  pitch_off = filter.getPitch();
  roll_off  = filter.getRoll();

  prevAngleX = prevAngleY = prevAngleZ = 0;
  offsetX = offsetY = offsetZ = 0;

  // Persistir snapshot estructurado para trazabilidad.
  float tempC = NAN;
#if SENSOR_DRIVER == L3G_LSM303
  tempC = l3gReadTempC();
#elif SENSOR_DRIVER == ICM_42688
  tempC = icmReadTempC();
#elif SENSOR_DRIVER == MPU9250
  tempC = mpuReadTempC();
#elif SENSOR_DRIVER == BNO055
  tempC = bnoReadTempC();
#elif SENSOR_DRIVER == MPU_6050
  tempC = mpu6050ReadTempC();
#elif SENSOR_DRIVER == ITG_ADXL_HMC
  tempC = itgReadTempC();
#elif SENSOR_DRIVER == ICM_20948
  tempC = icm20ReadTempC();
#endif
  calState.schema_version = 1;
  calState.bias_xyz[0] = gx_bias;
  calState.bias_xyz[1] = gy_bias;
  calState.bias_xyz[2] = gz_bias;
  calState.sd_dps_xyz[0] = sdx;
  calState.sd_dps_xyz[1] = sdy;
  calState.sd_dps_xyz[2] = sdz;
  calState.accel_mag_ms2 = aMag;
  calState.accel_sd_ms2  = aSd;
  calState.temp_c        = tempC;
  calState.ts_ms         = ms_since_boot;
  calState.fw_hash       = crc16Helper(FW_VERSION_STRING);
  calState.sensor_driver = (uint32_t)SENSOR_DRIVER;
  saveCalState();

  // Reporte textual (compat con clientes existentes).
  Serial.print("IMU CAL done bias=");
  Serial.print(gx_bias, 5); Serial.print(",");
  Serial.print(gy_bias, 5); Serial.print(",");
  Serial.print(gz_bias, 5);
  Serial.print(" sd=");
  Serial.print(sdx, 3); Serial.print(",");
  Serial.print(sdy, 3); Serial.print(",");
  Serial.print(sdz, 3);
  Serial.print(" yawOff=");
  Serial.print(yaw_off, 2); Serial.print(",");
  Serial.print(pitch_off, 2); Serial.print(",");
  Serial.println(roll_off, 2);

  // Reporte JSON estructurado (cliente moderno lo parsea para sensor_profile.json).
  Serial.print("IMU CAL JSON {");
  Serial.print("\"bias_dps\":["); Serial.print(radToDeg(gx_bias), 5); Serial.print(",");
  Serial.print(radToDeg(gy_bias), 5); Serial.print(","); Serial.print(radToDeg(gz_bias), 5); Serial.print("],");
  Serial.print("\"sd_dps\":["); Serial.print(sdx, 3); Serial.print(",");
  Serial.print(sdy, 3); Serial.print(","); Serial.print(sdz, 3); Serial.print("],");
  Serial.print("\"accel_mag_ms2\":"); Serial.print(aMag, 3); Serial.print(",");
  Serial.print("\"accel_sd_ms2\":"); Serial.print(aSd, 4); Serial.print(",");
  Serial.print("\"temp_c\":");
  if (isfinite(tempC)) Serial.print(tempC, 2); else Serial.print("null");
  Serial.print(",\"samples\":"); Serial.print(numSamples);
  Serial.print(",\"ts_ms\":"); Serial.print((unsigned long)ms_since_boot);
  Serial.print(",\"odr_ms\":"); Serial.print((unsigned long)CAL_SAMPLE_DELAY_MS);
  Serial.println("}");

  start_imu = prev_start;
}

void clearImuCal() {
  gx_bias = gy_bias = gz_bias = 0.0f;
  yaw_off = pitch_off = roll_off = 0.0f;
  prevAngleX = prevAngleY = prevAngleZ = 0;
  offsetX = offsetY = offsetZ = 0;
  // Borrar también el snapshot persistido para que un nuevo boot no rehidrate
  // el bias viejo.
  calState = {};
  prefs.begin("simhit", false);
  prefs.remove("cal");
  prefs.end();
  Serial.println("IMU CLR done");
}

void printImuStatus() {
  bool calibrated = (calState.schema_version >= 1);
  Serial.print("IMU STATUS ");
  Serial.print(calibrated ? "calibrated" : "uncalibrated");
  Serial.print(" bias=");
  Serial.print(gx_bias, 5); Serial.print(",");
  Serial.print(gy_bias, 5); Serial.print(",");
  Serial.print(gz_bias, 5);
  Serial.print(" yawOff=");
  Serial.print(yaw_off, 2); Serial.print(",");
  Serial.print(pitch_off, 2); Serial.print(",");
  Serial.print(roll_off, 2);
  Serial.print(" emit=");
  Serial.println(start_imu ? "ON" : "OFF");

  // Reporte JSON de la CAL persistida — fuente de verdad para sensor_profile.json.
  if (calibrated) {
    Serial.print("IMU STATUS JSON {");
    Serial.print("\"bias_dps\":["); Serial.print(radToDeg(calState.bias_xyz[0]), 5); Serial.print(",");
    Serial.print(radToDeg(calState.bias_xyz[1]), 5); Serial.print(","); Serial.print(radToDeg(calState.bias_xyz[2]), 5); Serial.print("],");
    Serial.print("\"sd_dps\":["); Serial.print(calState.sd_dps_xyz[0], 3); Serial.print(",");
    Serial.print(calState.sd_dps_xyz[1], 3); Serial.print(","); Serial.print(calState.sd_dps_xyz[2], 3); Serial.print("],");
    Serial.print("\"accel_mag_ms2\":"); Serial.print(calState.accel_mag_ms2, 3); Serial.print(",");
    Serial.print("\"accel_sd_ms2\":"); Serial.print(calState.accel_sd_ms2, 4); Serial.print(",");
    Serial.print("\"temp_c\":");
    if (isfinite(calState.temp_c)) Serial.print(calState.temp_c, 2); else Serial.print("null");
    Serial.print(",\"cal_ts_ms\":"); Serial.print((unsigned long)calState.ts_ms);
    Serial.print(",\"now_ms\":"); Serial.print((unsigned long)millis());
    Serial.print(",\"fw_hash\":\"0x"); Serial.print(calState.fw_hash, HEX);
    Serial.print("\",\"driver\":"); Serial.print((unsigned long)calState.sensor_driver);
    Serial.println("}");
  }
}


// ----- Calibración del magnetómetro (figura-8) -----
//
// Estrategia:
//  1) Captura a 50 Hz durante un mínimo de MIN_DURATION_MS y hasta
//     MAX_DURATION_MS, descartando si no se cubrieron los 8 octantes
//     del espacio (signos de x,y,z) — fuerza un movimiento real en 3D.
//  2) Hard-iron: centro del bounding box.
//  3) Soft-iron simple: escala por eje al radio promedio.
//  4) Métrica de calidad: tras aplicar la corrección, la magnitud |M|
//     debe ser constante. Reportamos coef. de variación (std/mean).
//     <0.04 → excelente, <0.08 → aceptable, > → reintentar.
//  5) "ABORT" o cualquier comando IMU mientras corre cancela la cal.

#define MAG_BUF_MAX        2000
#define MAG_CAL_PERIOD_MS  20         // 50 Hz
#define MAG_MIN_MS         15000      // 15 s mínimos
#define MAG_MAX_MS         45000      // 45 s tope
#define MAG_QUALITY_GOOD   0.04f
#define MAG_QUALITY_OK     0.08f
// Mínimo rango (μT) por eje para considerar que el sensor se movió de verdad.
// Antes de superar esto, el conteo de octantes es ruido alrededor del centro
// del bounding box y dispara falsos positivos sin movimiento real.
#define MAG_OCT_MIN_RANGE  10.0f

struct MagSample { float x, y, z; };
static MagSample magBuf[MAG_BUF_MAX];

// Lectura genérica del magnetómetro para los flujos auxiliares (MAG CAL,
// diagnóstico). Devuelve true si el driver activo tiene mag y la lectura
// funcionó. NaN-friendly: a diferencia del path principal en sampleAndFuse,
// acá necesitamos valores numéricos para acumular en el bounding box.
//
// Cada driver decide cómo accederlo:
//   - L3G_LSM303: Adafruit_LSM303DLH_Mag_Unified (heredado).
//   - MPU9250: lectura raw del AK8963 vía bypass I²C.
//   - ITG_ADXL_HMC: hmcReadMag() — falla limpio si HMC no respondió al init.
//   - ICM-42688 / MPU-6050: sin mag → return false.
//   - BNO055: el mag interno lo consume la fusión Bosch; no lo exponemos
//     crudo para no agregar overhead I²C. MAG CAL no aplica acá tampoco.
bool readMagRaw(float& mx, float& my, float& mz) {
#if SENSOR_DRIVER == L3G_LSM303
  sensors_event_t me;
  magSensor.getEvent(&me);
  mx = me.magnetic.x; my = me.magnetic.y; mz = me.magnetic.z;
  return true;
#elif SENSOR_DRIVER == MPU9250
  uint8_t m[7];
  if (!mpuReadBytes(AK8963_ADDR, AK8963_REG_DATA_X_L, m, 7)) return false;
  int16_t rmx = (int16_t)((m[1] << 8) | m[0]);
  int16_t rmy = (int16_t)((m[3] << 8) | m[2]);
  int16_t rmz = (int16_t)((m[5] << 8) | m[4]);
  mx = rmx * AK8963_MAG_SENS_UT;
  my = rmy * AK8963_MAG_SENS_UT;
  mz = rmz * AK8963_MAG_SENS_UT;
  return true;
#elif SENSOR_DRIVER == ITG_ADXL_HMC
  return hmcReadMag(mx, my, mz);
#elif SENSOR_DRIVER == ICM_20948
  uint8_t m[7];
  if (!icm20ReadBytes(AK09916_ADDR, AK09916_REG_HXL, m, 7)) return false;
  int16_t rmx = (int16_t)((m[1] << 8) | m[0]);
  int16_t rmy = (int16_t)((m[3] << 8) | m[2]);
  int16_t rmz = (int16_t)((m[5] << 8) | m[4]);
  mx = rmx * AK09916_MAG_SENS_UT;
  my = rmy * AK09916_MAG_SENS_UT;
  mz = rmz * AK09916_MAG_SENS_UT;
  return true;
#else
  // Sin magnetómetro físicamente accesible.
  (void)mx; (void)my; (void)mz;
  return false;
#endif
}

void calibrateMag() {
#if IMU_HAS_MAG == 0
  Serial.println("MAG CAL not supported - sensor sin magnetómetro");
  return;
#else
  // El BNO055 tiene mag físico pero la fusión Bosch hace su propia calibración
  // del mag (CALIB_STAT). Nuestro flujo de bounding-box duplicaría esfuerzo
  // y se pisarían las correcciones del chip — saltar.
#if SENSOR_DRIVER == BNO055
  Serial.println("MAG CAL skip - BNO055 calibra el mag internamente");
  return;
#endif

  bool prev_start = start_imu;
  start_imu = false;

  Serial.println("MAG CAL start - figura-8 cubriendo los 3 ejes");
  Serial.print("MAG CAL min=");
  Serial.print(MAG_MIN_MS / 1000);
  Serial.print("s max=");
  Serial.print(MAG_MAX_MS / 1000);
  Serial.println("s");

  // Primera muestra
  float mx0, my0, mz0;
  if (!readMagRaw(mx0, my0, mz0)) {
    Serial.println("MAG CAL fail - el mag no respondió");
    start_imu = prev_start;
    return;
  }
  float mx_min = mx0, mx_max = mx0;
  float my_min = my0, my_max = my0;
  float mz_min = mz0, mz_max = mz0;

  uint32_t bufCount = 0;
  uint8_t  octantMask = 0; // bit i = octante i visitado (i = sx<<2 | sy<<1 | sz)
  int      lastSec = -1;
  uint32_t t0 = millis();
  uint32_t lastTick = t0;
  bool     aborted = false;

  while (true) {
    uint32_t elapsed = millis() - t0;
    if (elapsed >= MAG_MAX_MS) break;
    if (elapsed >= MAG_MIN_MS && octantMask == 0xFF) break;

    float x, y, z;
    if (!readMagRaw(x, y, z)) {
      // Lectura puntual fallida: saltar este sample, no romper el flujo.
      continue;
    }

    if (x < mx_min) mx_min = x;
    if (x > mx_max) mx_max = x;
    if (y < my_min) my_min = y;
    if (y > my_max) my_max = y;
    if (z < mz_min) mz_min = z;
    if (z > mz_max) mz_max = z;

    if (bufCount < MAG_BUF_MAX) {
      magBuf[bufCount++] = { x, y, z };
    }

    // Octante respecto al centro corriente del bounding box.
    // Solo cuenta cuando el bounding box ya tiene rango significativo en los 3 ejes;
    // si no, el ruido alrededor del centro pinta octantes sin movimiento real.
    float dx_now = mx_max - mx_min;
    float dy_now = my_max - my_min;
    float dz_now = mz_max - mz_min;
    if (dx_now >= MAG_OCT_MIN_RANGE && dy_now >= MAG_OCT_MIN_RANGE && dz_now >= MAG_OCT_MIN_RANGE) {
      float cx = (mx_max + mx_min) * 0.5f;
      float cy = (my_max + my_min) * 0.5f;
      float cz = (mz_max + mz_min) * 0.5f;
      uint8_t oct = ((x > cx) ? 4 : 0) | ((y > cy) ? 2 : 0) | ((z > cz) ? 1 : 0);
      octantMask |= (1 << oct);
    }

    int sec = (int)(elapsed / 1000);
    if (sec != lastSec) {
      lastSec = sec;
      int octCount = __builtin_popcount(octantMask);
      // Log enriquecido para diagnóstico: rangos por eje, sample actual,
      // bounding box completo. Permite saber qué eje no se está moviendo.
      Serial.print("MAG CAL ");
      Serial.print(sec);
      Serial.print("s oct=");
      Serial.print(octCount);
      Serial.print("/8 n=");
      Serial.print(bufCount);
      Serial.print(" rng=");
      Serial.print(mx_max - mx_min, 1); Serial.print(",");
      Serial.print(my_max - my_min, 1); Serial.print(",");
      Serial.print(mz_max - mz_min, 1);
      Serial.print(" mxyz=");
      Serial.print(x, 1); Serial.print(",");
      Serial.print(y, 1); Serial.print(",");
      Serial.print(z, 1);
      Serial.print(" bb=[");
      Serial.print(mx_min, 1); Serial.print("..");
      Serial.print(mx_max, 1); Serial.print("|");
      Serial.print(my_min, 1); Serial.print("..");
      Serial.print(my_max, 1); Serial.print("|");
      Serial.print(mz_min, 1); Serial.print("..");
      Serial.print(mz_max, 1);
      Serial.println("]");
    }

    // Cancelación por serial: cualquier línea aborta
    if (Serial.available()) {
      Serial.readStringUntil('\n');
      aborted = true;
      break;
    }

    while (millis() - lastTick < MAG_CAL_PERIOD_MS) { /* spin */ }
    lastTick += MAG_CAL_PERIOD_MS;
  }

  if (aborted) {
    Serial.println("MAG CAL abort");
    start_imu = prev_start;
    return;
  }

  if (octantMask != 0xFF) {
    Serial.print("MAG CAL fail - octantes incompletos (");
    Serial.print(__builtin_popcount(octantMask));
    Serial.println("/8)");
    start_imu = prev_start;
    return;
  }

  float dx = mx_max - mx_min;
  float dy = my_max - my_min;
  float dz = mz_max - mz_min;
  if (dx < 5.0f || dy < 5.0f || dz < 5.0f) {
    Serial.println("MAG CAL fail - rango insuficiente");
    start_imu = prev_start;
    return;
  }

  // Hard-iron + soft-iron simple
  float new_off_x = (mx_max + mx_min) * 0.5f;
  float new_off_y = (my_max + my_min) * 0.5f;
  float new_off_z = (mz_max + mz_min) * 0.5f;
  float avg = (dx + dy + dz) / 3.0f;
  float new_scl_x = avg / dx;
  float new_scl_y = avg / dy;
  float new_scl_z = avg / dz;

  // Métrica de calidad: coef. de variación de |M| corregido
  double sum = 0.0, sum2 = 0.0;
  for (uint32_t i = 0; i < bufCount; i++) {
    float vx = (magBuf[i].x - new_off_x) * new_scl_x;
    float vy = (magBuf[i].y - new_off_y) * new_scl_y;
    float vz = (magBuf[i].z - new_off_z) * new_scl_z;
    float m = sqrtf(vx*vx + vy*vy + vz*vz);
    sum  += m;
    sum2 += (double)m * m;
  }
  float mean = (float)(sum / bufCount);
  float var  = (float)(sum2 / bufCount - (double)mean * mean);
  if (var < 0) var = 0;
  float stdv = sqrtf(var);
  float cv   = (mean > 0.001f) ? (stdv / mean) : 1.0f;

  const char* grade =
      (cv < MAG_QUALITY_GOOD) ? "good" :
      (cv < MAG_QUALITY_OK)   ? "ok"   : "poor";

  if (cv >= MAG_QUALITY_OK) {
    Serial.print("MAG CAL fail - calidad pobre cv=");
    Serial.println(cv, 4);
    start_imu = prev_start;
    return;
  }

  // Aplicar y persistir
  mx_off = new_off_x; my_off = new_off_y; mz_off = new_off_z;
  mx_scl = new_scl_x; my_scl = new_scl_y; mz_scl = new_scl_z;
  saveMagCal();

  Serial.print("MAG CAL done n=");
  Serial.print(bufCount);
  Serial.print(" cv=");
  Serial.print(cv, 4);
  Serial.print(" (");
  Serial.print(grade);
  Serial.print(") off=");
  Serial.print(mx_off, 2); Serial.print(",");
  Serial.print(my_off, 2); Serial.print(",");
  Serial.print(mz_off, 2);
  Serial.print(" scl=");
  Serial.print(mx_scl, 3); Serial.print(",");
  Serial.print(my_scl, 3); Serial.print(",");
  Serial.println(mz_scl, 3);

  start_imu = prev_start;
#endif  // IMU_HAS_MAG
}

void clearMagCal() {
  mx_off = my_off = mz_off = 0.0f;
  mx_scl = my_scl = mz_scl = 1.0f;
  prefs.begin("simhit", false);
  prefs.remove("mx_off"); prefs.remove("my_off"); prefs.remove("mz_off");
  prefs.remove("mx_scl"); prefs.remove("my_scl"); prefs.remove("mz_scl");
  prefs.end();
  Serial.println("MAG CLR done");
}

void printMagStatus() {
  bool calibrated = (mx_off != 0.0f || my_off != 0.0f || mz_off != 0.0f
                  || mx_scl != 1.0f || my_scl != 1.0f || mz_scl != 1.0f);
  Serial.print("MAG STATUS ");
  Serial.print(calibrated ? "calibrated" : "uncalibrated");
  Serial.print(" off=");
  Serial.print(mx_off, 2); Serial.print(",");
  Serial.print(my_off, 2); Serial.print(",");
  Serial.print(mz_off, 2);
  Serial.print(" scl=");
  Serial.print(mx_scl, 3); Serial.print(",");
  Serial.print(my_scl, 3); Serial.print(",");
  Serial.println(mz_scl, 3);
}

void saveMagCal() {
  prefs.begin("simhit", false);
  prefs.putFloat("mx_off", mx_off);
  prefs.putFloat("my_off", my_off);
  prefs.putFloat("mz_off", mz_off);
  prefs.putFloat("mx_scl", mx_scl);
  prefs.putFloat("my_scl", my_scl);
  prefs.putFloat("mz_scl", mz_scl);
  prefs.end();
}

void loadMagCal() {
  prefs.begin("simhit", true);
  mx_off = prefs.getFloat("mx_off", 0.0f);
  my_off = prefs.getFloat("my_off", 0.0f);
  mz_off = prefs.getFloat("mz_off", 0.0f);
  mx_scl = prefs.getFloat("mx_scl", 1.0f);
  my_scl = prefs.getFloat("my_scl", 1.0f);
  mz_scl = prefs.getFloat("mz_scl", 1.0f);
  prefs.end();
  Serial.print("Mag cal loaded off=");
  Serial.print(mx_off, 2); Serial.print(",");
  Serial.print(my_off, 2); Serial.print(",");
  Serial.print(mz_off, 2);
  Serial.print(" scl=");
  Serial.print(mx_scl, 3); Serial.print(",");
  Serial.print(my_scl, 3); Serial.print(",");
  Serial.println(mz_scl, 3);
}
