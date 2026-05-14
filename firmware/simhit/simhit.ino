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
//   Entrada: "IMU ON" | "IMU OFF" | "IMU CAL" | "IMU CLR" | "IMU STATUS"
//            "MAG CAL" | "MAG CLR" | "MAG STATUS"
//            "LASER ON" | "LASER OFF" | "LASER STATUS"
//            "FILTER SG" | "FILTER IIR" | "FILTER NONE" | "FILTER STATUS"
//            "HELLO" | "VERSION" | "RESET"
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
#define FW_VERSION_STRING "1.1.0"

// ──────────────────── Selección del driver de sensor ────────────────────
// La CI pasa -DSENSOR_DRIVER=<MACRO> al compilador para producir un .bin por
// IMU. Cuando se compila localmente (Arduino IDE) sin pasar el flag, queda
// el default L3G_LSM303. Para agregar un sensor nuevo:
//   1) Agregar su macro al bloque #define <NEW> N de abajo.
//   2) Implementar las funciones del driver con #if SENSOR_DRIVER == <NEW>
//   3) Agregar la entrada a strategy.matrix.sensor en firmware-release.yml.
#define L3G_LSM303 1
#define ICM_42688  2
#define MPU9250    3
#define BNO055     4

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
#else
  #error "SENSOR_DRIVER no reconocido. Valores válidos: L3G_LSM303 | ICM_42688 | MPU9250 | BNO055"
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
// Datasheet rev 1.6. SIN testear con hardware; revisar antes del primer flash.
#define ICM_ADDR             0x68
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
// AK8963 magnetómetro en 0x0C (accesible vía bypass). SIN testear con hardware.
#define MPU_ADDR             0x68
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
// Fusión interna (NDOF) — no requiere Madgwick. Le pedimos al chip directamente
// los Euler angles y la velocidad angular. SIN testear con hardware.
#define BNO_ADDR             0x28
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
  int who = readReg8(ICM_ADDR, ICM_REG_WHO_AM_I);
  if (who != ICM_WHO_AM_I_VAL) return false;
  // Bank 0 (registros configurables principales).
  if (!writeReg8(ICM_ADDR, ICM_REG_BANK_SEL, 0x00)) return false;
  // PWR_MGMT0: gyro low-noise + accel low-noise (bits[3:0] = 0x0F).
  if (!writeReg8(ICM_ADDR, ICM_REG_PWR_MGMT0, 0x0F)) return false;
  delay(50); // gyro start-up ≥45 ms
  // GYRO_CONFIG0: FS_SEL=0 (±2000 dps), ODR=0x06 (1 kHz). bits = 000 0 0110.
  if (!writeReg8(ICM_ADDR, ICM_REG_GYRO_CONFIG0, 0x06)) return false;
  // ACCEL_CONFIG0: FS_SEL=0 (±16g), ODR=0x06 (1 kHz). bits = 000 0 0110.
  if (!writeReg8(ICM_ADDR, ICM_REG_ACCEL_CONFIG0, 0x06)) return false;
  return true;
}

// Lee gyro y accel del ICM. gyro en rad/s, accel en m/s². Retorna false en error.
bool icmRead(float& gx, float& gy, float& gz, float& ax, float& ay, float& az) {
  uint8_t b[12];
  // Burst: ACCEL_DATA_X1..ACCEL_DATA_Z0 (6) + GYRO_DATA_X1..Z0 (6) = 12 bytes
  // Direcciones consecutivas: 0x1F..0x2A.
  if (!icmReadBytes(ICM_ADDR, ICM_REG_ACCEL_DATA_X1, b, 12)) return false;
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
  int who = readReg8(MPU_ADDR, MPU_REG_WHO_AM_I);
  if (who != MPU_WHO_AM_I_VAL) return false;
  // Wake up (PWR_MGMT_1 = 0x00, sale de sleep, clock interno).
  if (!writeReg8(MPU_ADDR, MPU_REG_PWR_MGMT_1, 0x00)) return false;
  delay(20);
  // PLL on, gyro como ref.
  if (!writeReg8(MPU_ADDR, MPU_REG_PWR_MGMT_1, 0x01)) return false;
  // Gyro ±2000 dps: FS_SEL=11 → bits[4:3]=11 → 0x18.
  if (!writeReg8(MPU_ADDR, MPU_REG_GYRO_CONFIG, 0x18)) return false;
  // Accel ±16g: AFS_SEL=11 → bits[4:3]=11 → 0x18.
  if (!writeReg8(MPU_ADDR, MPU_REG_ACCEL_CONFIG, 0x18)) return false;
  // Bypass para acceder al magnetómetro AK8963 directamente.
  if (!writeReg8(MPU_ADDR, MPU_REG_USER_CTRL, 0x00)) return false;
  if (!writeReg8(MPU_ADDR, MPU_REG_INT_PIN_CFG, 0x02)) return false;
  delay(10);
  // AK8963: modo continuous-2 (100 Hz) + 16-bit.
  writeReg8(AK8963_ADDR, AK8963_REG_CNTL1, 0x16);
  delay(10);
  return true;
}

bool mpuRead(float& gx, float& gy, float& gz, float& ax, float& ay, float& az,
             float& mx, float& my, float& mz) {
  uint8_t b[14];
  if (!mpuReadBytes(MPU_ADDR, MPU_REG_ACCEL_XOUT_H, b, 14)) return false;
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
#endif  // SENSOR_DRIVER == MPU9250

// ─────────── Driver BNO055 (SIN testear con hardware) ───────────
#if SENSOR_DRIVER == BNO055
bool bnoReadBytes(uint8_t reg, uint8_t* out, uint8_t n) {
  Wire.beginTransmission(BNO_ADDR);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((int)BNO_ADDR, (int)n) != n) return false;
  for (uint8_t i = 0; i < n; i++) out[i] = Wire.read();
  return true;
}

bool bnoInit() {
  delay(700); // POR del BNO055: ~650 ms hasta que responde
  int who = readReg8(BNO_ADDR, BNO_REG_CHIP_ID);
  if (who != BNO_CHIP_ID_VAL) return false;
  // Forzar config mode antes de cambiar registros.
  writeReg8(BNO_ADDR, BNO_REG_OPR_MODE, 0x00);
  delay(25);
  writeReg8(BNO_ADDR, BNO_REG_PAGE_ID, 0x00);
  // UNIT_SEL: m/s² para accel, dps para gyro, °C, ángulos en grados.
  writeReg8(BNO_ADDR, BNO_REG_UNIT_SEL, 0x00);
  // Pasar a modo NDOF (9-DOF fusion completo con magnetómetro).
  writeReg8(BNO_ADDR, BNO_REG_OPR_MODE, BNO_OPR_MODE_NDOF);
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
#endif  // SENSOR_DRIVER == BNO055

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
    int who = readReg8(ICM_ADDR, ICM_REG_WHO_AM_I);
    Serial.print("Gyro WHO_AM_I @0x"); Serial.print(ICM_ADDR, HEX);
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
    int who = readReg8(MPU_ADDR, MPU_REG_WHO_AM_I);
    Serial.print("Gyro WHO_AM_I @0x"); Serial.print(MPU_ADDR, HEX);
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
    int who = readReg8(BNO_ADDR, BNO_REG_CHIP_ID);
    Serial.print("Gyro WHO_AM_I @0x"); Serial.print(BNO_ADDR, HEX);
    Serial.print(" = 0x"); if (who < 0x10) Serial.print("0");
    Serial.print(who, HEX); Serial.println(" (BNO055)");
  }
  Serial.println("Initializing BNO055...");
  if (!bnoInit()) {
    Serial.println("No BNO055 detected");
    while (1) delay(10);
  }
#endif

  filter.begin(SAMPLE_RATE_HZ);

  // Bias gyro y orientación: session-only, requiere "IMU CAL" tras conectar.
  loadMagCal();
  loadAccelFilter();
  Serial.print("Accel filter = ");
  Serial.println(accelFilterName(accelFilter));

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
void sampleAndFuse() {
#if SENSOR_DRIVER == L3G_LSM303
  sensors_event_t ae, me;
  float grx, gry, grz;
  l3gRead(grx, gry, grz);
  accelSensor.getEvent(&ae);
  magSensor.getEvent(&me);

  float gx_dps = radToDeg(grx - gx_bias);
  float gy_dps = radToDeg(gry - gy_bias);
  float gz_dps = radToDeg(grz - gz_bias);

  computeAngularAccel(gx_dps, gy_dps, gz_dps, 1.0f / SAMPLE_RATE_HZ);
  lastGyroDpsX = gx_dps; lastGyroDpsY = gy_dps; lastGyroDpsZ = gz_dps;
  linAccX = ae.acceleration.x; linAccY = ae.acceleration.y; linAccZ = ae.acceleration.z;
  // Mag crudo (sin calibración hard/soft-iron) para que el CSV preserve los
  // datos sin pérdida. La fusión usa los calibrados por separado.
  lastMagX = me.magnetic.x; lastMagY = me.magnetic.y; lastMagZ = me.magnetic.z;
  lastTempC = 0.0f / 0.0f;  // LSM303 no expone temperatura por API Adafruit

  float mx = (me.magnetic.x - mx_off) * mx_scl;
  float my = (me.magnetic.y - my_off) * my_scl;
  float mz = (me.magnetic.z - mz_off) * mz_scl;
  (void)mx; (void)my; (void)mz;
  // 6DOF (sin mag): este módulo LSM303DLHC tiene el eje Z saturado; usar IMU.
  filter.updateIMU(gx_dps, gy_dps, gz_dps,
                   ae.acceleration.x, ae.acceleration.y, ae.acceleration.z);

#elif SENSOR_DRIVER == ICM_42688
  float grx=0, gry=0, grz=0, ax=0, ay=0, az=0;
  icmRead(grx, gry, grz, ax, ay, az);
  float gx_dps = radToDeg(grx - gx_bias);
  float gy_dps = radToDeg(gry - gy_bias);
  float gz_dps = radToDeg(grz - gz_bias);
  computeAngularAccel(gx_dps, gy_dps, gz_dps, 1.0f / SAMPLE_RATE_HZ);
  lastGyroDpsX = gx_dps; lastGyroDpsY = gy_dps; lastGyroDpsZ = gz_dps;
  linAccX = ax; linAccY = ay; linAccZ = az;
  lastMagX = lastMagY = lastMagZ = 0.0f / 0.0f;  // ICM-42688 no tiene mag
  lastTempC = 0.0f / 0.0f;
  filter.updateIMU(gx_dps, gy_dps, gz_dps, ax, ay, az);

#elif SENSOR_DRIVER == MPU9250
  float grx=0, gry=0, grz=0, ax=0, ay=0, az=0, mx=0, my=0, mz=0;
  mpuRead(grx, gry, grz, ax, ay, az, mx, my, mz);
  float gx_dps = radToDeg(grx - gx_bias);
  float gy_dps = radToDeg(gry - gy_bias);
  float gz_dps = radToDeg(grz - gz_bias);
  computeAngularAccel(gx_dps, gy_dps, gz_dps, 1.0f / SAMPLE_RATE_HZ);
  lastGyroDpsX = gx_dps; lastGyroDpsY = gy_dps; lastGyroDpsZ = gz_dps;
  linAccX = ax; linAccY = ay; linAccZ = az;
  lastMagX = mx; lastMagY = my; lastMagZ = mz;  // AK8963 raw (µT)
  lastTempC = 0.0f / 0.0f;
  // Magnetómetro disponible: usar fusión 9-DOF si la calibración del MAG está hecha.
  float mxc = (mx - mx_off) * mx_scl;
  float myc = (my - my_off) * my_scl;
  float mzc = (mz - mz_off) * mz_scl;
  filter.update(gx_dps, gy_dps, gz_dps, ax, ay, az, mxc, myc, mzc);

#elif SENSOR_DRIVER == BNO055
  // BNO055 hace su propia fusión: leemos eulers directamente y no usamos
  // Madgwick. Forzamos los offsets de orientación a través de los eulers ya
  // calculados por el BNO. El campo gyro_dps sigue siendo crudo (post-bias).
  float yaw_d=0, roll_d=0, pitch_d=0;
  float grx=0, gry=0, grz=0, ax=0, ay=0, az=0;
  bnoRead(yaw_d, roll_d, pitch_d, grx, gry, grz, ax, ay, az);
  float gx_dps = radToDeg(grx - gx_bias);
  float gy_dps = radToDeg(gry - gy_bias);
  float gz_dps = radToDeg(grz - gz_bias);
  computeAngularAccel(gx_dps, gy_dps, gz_dps, 1.0f / SAMPLE_RATE_HZ);
  lastGyroDpsX = gx_dps; lastGyroDpsY = gy_dps; lastGyroDpsZ = gz_dps;
  linAccX = ax; linAccY = ay; linAccZ = az;
  // El BNO055 tiene mag interno y la fusión ya lo usa; aún no lo exponemos
  // crudo para evitar lecturas I2C extra. Pendiente si se necesita en el CSV.
  lastMagX = lastMagY = lastMagZ = 0.0f / 0.0f;
  lastTempC = 0.0f / 0.0f;
  // El BNO055 reporta heading [0,360); convertimos a [-180,180] para mantener
  // la convención de Madgwick del resto del firmware.
  if (yaw_d > 180.0f) yaw_d -= 360.0f;
  // Truqueamos Madgwick para reportar estos eulers sin volver a fusionar:
  // emitIMU() lee filter.getYaw/Pitch/Roll, así que feedeamos una rotación
  // congruente. Para no reimplementar todo el pipeline, hacemos un init/skip:
  // efectivamente usamos los eulers del BNO sobrescribiendo offsets.
  yaw_off   = filter.getYaw()   - yaw_d;
  pitch_off = filter.getPitch() - pitch_d;
  roll_off  = filter.getRoll()  - roll_d;
  // Igual alimentamos Madgwick para mantener la API. La precisión real viene
  // de los offsets que acabamos de sincronizar contra los eulers del BNO.
  filter.updateIMU(gx_dps, gy_dps, gz_dps, ax, ay, az);
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
    calibrateIMU();
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
  } else if (command == "HELLO") {
    Serial.println("HELLO");
  } else if (command == "VERSION") {
    // Respuesta de query explícita. Útil para clientes que se conectan a un
    // firmware ya inicializado (perdieron el banner de boot).
    Serial.print("VERSION ");
    Serial.println(FW_VERSION_STRING);
  } else if (command == "RESET") {
    Serial.println("Reiniciando...");
    delay(10);
    ESP.restart();
  }
  // OLED/LED bar retirados; comandos O*/BAR* se ignoran.
}

void calibrateIMU() {
  const int numSamples = 200;            // 1 s @ 200 Hz
  const float MOTION_LIMIT_DPS = 3.0f;   // std-dev por eje permitida (°/s)

  bool prev_start = start_imu;
  start_imu = false;

  Serial.println("IMU CAL start - mantener quieto 1s");

  double sx = 0, sy = 0, sz = 0;
  double sxx = 0, syy = 0, szz = 0;

  for (int i = 0; i < numSamples; i++) {
    float grx = 0, gry = 0, grz = 0;
#if SENSOR_DRIVER == L3G_LSM303
    l3gRead(grx, gry, grz);
#elif SENSOR_DRIVER == ICM_42688
    float ax, ay, az; icmRead(grx, gry, grz, ax, ay, az);
#elif SENSOR_DRIVER == MPU9250
    float ax, ay, az, mx, my, mz; mpuRead(grx, gry, grz, ax, ay, az, mx, my, mz);
#elif SENSOR_DRIVER == BNO055
    float yd, rd, pd, ax, ay, az; bnoRead(yd, rd, pd, grx, gry, grz, ax, ay, az);
#endif
    sx  += grx;  sy  += gry;  sz  += grz;
    sxx += (double)grx * grx;
    syy += (double)gry * gry;
    szz += (double)grz * grz;
    delay(5);
  }

  float mx = (float)(sx / numSamples);
  float my = (float)(sy / numSamples);
  float mz = (float)(sz / numSamples);
  float vx = (float)(sxx / numSamples) - mx * mx;
  float vy = (float)(syy / numSamples) - my * my;
  float vz = (float)(szz / numSamples) - mz * mz;
  if (vx < 0) vx = 0; if (vy < 0) vy = 0; if (vz < 0) vz = 0;
  float sdx = radToDeg(sqrtf(vx));
  float sdy = radToDeg(sqrtf(vy));
  float sdz = radToDeg(sqrtf(vz));
  float sdMax = sdx; if (sdy > sdMax) sdMax = sdy; if (sdz > sdMax) sdMax = sdz;

  if (sdMax > MOTION_LIMIT_DPS) {
    Serial.print("IMU CAL fail motion sd=");
    Serial.print(sdx, 3); Serial.print(",");
    Serial.print(sdy, 3); Serial.print(",");
    Serial.print(sdz, 3);
    Serial.println(" dps");
    start_imu = prev_start;
    return;
  }

  gx_bias = mx;
  gy_bias = my;
  gz_bias = mz;

  yaw_off   = filter.getYaw();
  pitch_off = filter.getPitch();
  roll_off  = filter.getRoll();

  prevAngleX = prevAngleY = prevAngleZ = 0;
  offsetX = offsetY = offsetZ = 0;

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

  start_imu = prev_start;
}

void clearImuCal() {
  gx_bias = gy_bias = gz_bias = 0.0f;
  yaw_off = pitch_off = roll_off = 0.0f;
  prevAngleX = prevAngleY = prevAngleZ = 0;
  offsetX = offsetY = offsetZ = 0;
  Serial.println("IMU CLR done");
}

void printImuStatus() {
  bool calibrated = (gx_bias != 0.0f || gy_bias != 0.0f || gz_bias != 0.0f
                  || yaw_off != 0.0f || pitch_off != 0.0f || roll_off != 0.0f);
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

void calibrateMag() {
#if SENSOR_DRIVER != L3G_LSM303
  // MAG CAL solo soportado en L3G_LSM303 (única familia con API Adafruit del
  // magnetómetro). MPU9250 tiene AK8963 pero requiere refactor del flow.
  Serial.println("MAG CAL not supported - skip");
  return;
#else
  bool prev_start = start_imu;
  start_imu = false;

  Serial.println("MAG CAL start - figura-8 cubriendo los 3 ejes");
  Serial.print("MAG CAL min=");
  Serial.print(MAG_MIN_MS / 1000);
  Serial.print("s max=");
  Serial.print(MAG_MAX_MS / 1000);
  Serial.println("s");

  // Primera muestra
  sensors_event_t me;
  magSensor.getEvent(&me);
  float mx_min = me.magnetic.x, mx_max = me.magnetic.x;
  float my_min = me.magnetic.y, my_max = me.magnetic.y;
  float mz_min = me.magnetic.z, mz_max = me.magnetic.z;

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

    magSensor.getEvent(&me);
    float x = me.magnetic.x, y = me.magnetic.y, z = me.magnetic.z;

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
#endif  // SENSOR_DRIVER != L3G_LSM303
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
