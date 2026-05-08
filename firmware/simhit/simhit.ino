// SimHIT firmware — ESP32-C3 SuperMini
// IMU: L3G4200D (gyro) + LSM303DLHC (accel + mag) sobre I2C
// Fusión: Madgwick (Adafruit_AHRS) → yaw/pitch/roll
//
// Protocolo serial (invariante respecto a versión BNO055):
//   Salida:  "angX;angY;angZ;gyroX;gyroY;gyroZ\n"  (° y °/s)
//   Entrada: "IMU ON" | "IMU OFF" | "IMU CAL" | "IMU CLR" | "IMU STATUS"
//            "MAG CAL" | "MAG CLR" | "MAG STATUS"
//            "HELLO" | "RESET"

#include <Wire.h>
#include <Preferences.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_LSM303_Accel.h>
#include <Adafruit_LSM303DLH_Mag.h>
#include <Adafruit_AHRS.h>

#define SERIAL_BAUD_RATE 460800

#define I2C_SDA_PIN 6
#define I2C_SCL_PIN 7

// Tasa de muestreo / fusión
#define SAMPLE_RATE_HZ 200.0f
static const uint32_t SAMPLE_PERIOD_US = (uint32_t)(1000000.0f / SAMPLE_RATE_HZ);

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

// Filtro de fusión
Adafruit_Madgwick filter;

// Estado
bool start_imu = false;

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

static inline float radToDeg(float r) { return r * 57.2957795f; }

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

void setup() {
  Serial.begin(SERIAL_BAUD_RATE);
  delay(100);
  Serial.println("SimHit configure");

  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN, 400000);

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

  filter.begin(SAMPLE_RATE_HZ);

  // Bias gyro y orientación: session-only, requiere "IMU CAL" tras conectar.
  loadMagCal();

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
  sensors_event_t ae, me;
  float grx, gry, grz;
  l3gRead(grx, gry, grz);
  accelSensor.getEvent(&ae);
  magSensor.getEvent(&me);

  float gx_dps = radToDeg(grx - gx_bias);
  float gy_dps = radToDeg(gry - gy_bias);
  float gz_dps = radToDeg(grz - gz_bias);

  float mx = (me.magnetic.x - mx_off) * mx_scl;
  float my = (me.magnetic.y - my_off) * my_scl;
  float mz = (me.magnetic.z - mz_off) * mz_scl;

  // 6DOF (sin magnetómetro): este módulo LSM303DLHC tiene el eje Z saturado
  // (>810 μT incluso con gain máximo ±8.1 G), probablemente IC dañado. Yaw
  // deriva con el tiempo pero pitch/roll quedan estabilizados por gravedad.
  // Para vHIT corto + IMU CAL al inicio es suficiente.
  // Si en el futuro se reemplaza el módulo, descomentar el bloque 9DOF y
  // comentar el updateIMU para volver a usar magnetómetro.
  (void)mx; (void)my; (void)mz; // silenciar warnings de variables no usadas
  filter.updateIMU(
    gx_dps, gy_dps, gz_dps,
    ae.acceleration.x, ae.acceleration.y, ae.acceleration.z
  );
  // 9DOF original (con magnetómetro) — restaurar si se cambia el LSM303:
  // filter.update(
  //   gx_dps, gy_dps, gz_dps,
  //   ae.acceleration.x, ae.acceleration.y, ae.acceleration.z,
  //   mx, my, mz
  // );
}

void emitIMU() {
  // Re-leer gyro para emitir velocidad angular instantánea fresca
  float grx, gry, grz;
  l3gRead(grx, gry, grz);
  float gx_dps = radToDeg(grx - gx_bias);
  float gy_dps = radToDeg(gry - gy_bias);
  float gz_dps = radToDeg(grz - gz_bias);

  float yaw   = filter.getYaw()   - yaw_off;
  float pitch = filter.getPitch() - pitch_off;
  float roll  = filter.getRoll()  - roll_off;

  float adjustedAngleX = adjustDiscontinuity(yaw,   prevAngleX, offsetX);
  float adjustedAngleY = adjustDiscontinuity(pitch, prevAngleY, offsetY);
  float adjustedAngleZ = adjustDiscontinuity(roll,  prevAngleZ, offsetZ);

  prevAngleX = yaw;
  prevAngleY = pitch;
  prevAngleZ = roll;

  Serial.print(adjustedAngleX, 2);
  Serial.print(";");
  Serial.print(adjustedAngleY, 2);
  Serial.print(";");
  Serial.print(adjustedAngleZ, 2);
  Serial.print(";");
  Serial.print(gx_dps, 2);
  Serial.print(";");
  Serial.print(gy_dps, 2);
  Serial.print(";");
  Serial.println(gz_dps, 2);
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
  } else if (command == "HELLO") {
    Serial.println("HELLO");
  } else if (command == "RESET") {
    Serial.println("Reiniciando...");
    delay(10);
    ESP.restart();
  }
  // LED/OLED retirados en esta revisión; comandos L*/O*/BAR* se ignoran.
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
    float grx, gry, grz;
    l3gRead(grx, gry, grz);
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
