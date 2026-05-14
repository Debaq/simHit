# TODO — drivers del firmware SimHIT

Notas vivas sobre cada driver de sensor implementado en `simhit/simhit.ino`,
limitaciones conocidas y trabajo pendiente. Actualizar cada vez que se valide
con hardware o se cambie el código.

## Drivers actuales

### `L3G_LSM303` (default) — L3G + LSM303

- **Estado**: validado con hardware (placa SimHIT actual).
- **Dependencias externas**: `Adafruit_LSM303_Accel_Unified`,
  `Adafruit_LSM303DLH_Mag_Unified`, `Adafruit_Sensor`, `Adafruit_AHRS`. No
  están pineadas a una versión específica en el workflow CI.
- **TODO**:
  - [ ] Pinear versiones exactas en `firmware-release.yml` para builds
        reproducibles bit a bit.
  - [ ] Reescribir el driver en raw I²C (eliminar las 3 libs LSM303) y
        validar contra resultados pre-refactor.
  - [ ] El módulo LSM303 actual tiene el eje Z del magnetómetro saturado
        (lectura clampeada en hardware, probablemente IC dañado). Verificar
        si afecta a otras placas que repliquen este combo.

### `ICM_42688`

- **Estado**: implementado en raw I²C, **sin validar con hardware**.
- **Dependencias externas**: solo `Adafruit_AHRS` (Madgwick, compartido).
- **TODO**:
  - [ ] Validar con módulo físico (escala 16.4 LSB/dps, registros 0x1F+).
  - [ ] Considerar bank-select para acceder a los registros de calibración
        de fábrica (offset trim) si el bias residual post-CAL es alto.
  - [ ] Sumar lectura de FIFO mode si se requiere ODR > 1 kHz.
  - [ ] Soporte SPI (más rápido que I²C, especialmente para vHIT) si el
        módulo lo soporta.

### `MPU9250` + AK8963

- **Estado**: implementado en raw I²C, **sin validar con hardware**.
- **Disponibilidad**: chip discontinuado por InvenSense (TDK). Stock variable.
- **TODO**:
  - [ ] Validar con módulo físico.
  - [ ] El bypass del AK8963 requiere que el master I²C del MPU esté
        deshabilitado (USER_CTRL bit I2C_MST_EN = 0). Verificar que no
        choque con sample rate alto.
  - [ ] La calibración del AK8963 (factory adjustment values en ROM @
        0x10-0x12) hoy se ignora; aplicarla mejora ±10% la precisión del
        mag.
  - [ ] Considerar drop del catálogo cuando se descontinúe del market.

### `BNO055`

- **Estado**: implementado en raw I²C, **sin validar con hardware**.
- **Historia legal**: el firmware interno de fusión (SH-1) lo desarrolló
  Hillcrest Labs (hoy CEVA). Tras disputa Bosch tuvo que sacarlo y nació
  el BNO080/BNO085 con SH-2 en otra arquitectura. **Nuestro uso es legal**:
  solo leemos registros públicos del chip (CHIP_ID, EUL_DATA, etc.); no
  copiamos firmware disputado. Disponibilidad incierta: algunos lotes
  recientes vienen con firmware tweakeado.
- **TODO**:
  - [ ] Validar con módulo físico.
  - [ ] Implementar driver BNO080/BNO085 (protocolo SHTP, no I²C plano —
        más complejo). Solo si se consigue hardware.
  - [ ] El bypass del bias-removal asume que la fusión Bosch ya descuenta.
        Si en algún lote esa convención cambia, revisar.

### `MPU_6050`

- **Estado**: a implementar.
- **TODO**:
  - [ ] Implementar driver raw I²C (clon del MPU-9250 sin el AK8963).
  - [ ] Validar con módulo GY-521 o similar.

### `ITG_ADXL_HMC` (HW-579)

- **Estado**: a implementar.
- **Composición**: ITG-3205 (gyro 0x68/0x69) + ADXL345 (accel 0x53)
  + HMC5883L (mag 0x1E).
- **Riesgo de clones**: los módulos HW-579 modernos a veces traen
  **QMC5883L** (clon Chinese) en lugar de HMC5883L. La dirección
  cambia (0x0D vs 0x1E) y el mapping de registros es totalmente
  distinto. Probar HMC primero; si falla, probar QMC.
- **TODO**:
  - [ ] Implementar driver raw I²C de los 3 chips.
  - [ ] Fallback runtime HMC5883L → QMC5883L.
  - [ ] Validar con la placa física.
  - [ ] El ITG-3205 tiene el mismo WHO_AM_I que MPU-6050 (0x68 = su
        propia dirección I²C). Si por alguna razón el SENSOR_DRIVER
        está mal seleccionado, podríamos creer que es lo opuesto.

## Pendientes transversales

### Calibración

- [ ] **MAG CAL multi-driver**: hoy solo soportado en `L3G_LSM303`. Para
      MPU-9250 y HW-579 (mag separado) el flujo necesita refactor: en
      lugar de `magSensor.getEvent()` usar los reads raw del driver.
- [ ] **Temperatura del LSM303**: el chip la expone en `OUT_TEMP_H/L`
      (0x05/0x06) pero la API Adafruit no la mapea. Leer raw si se
      necesita.
- [ ] **Pre-warm-up por sensor**: hoy 60 s para todos. El BNO055
      podría tener un valor menor por su fusión interna; el ICM tiene
      especificación de "gyro startup" mucho más corta (~45 ms).
- [ ] **Validación de ortogonalidad de ejes**: requiere giro conocido
      en cada eje — procedimiento separado, no el segundo de quietud
      del IMU CAL actual.

### Fusión

- [ ] **Vendorear Madgwick**: `Adafruit_AHRS` es la única dep cruzada
      entre drivers. ~200 líneas dominio público de Sebastian Madgwick.
      Eliminarla nos da builds 100% repo-only para todos los drivers
      menos `L3G_LSM303` (que también necesita raw I²C).
- [ ] **Mahony alternativo**: para sensores de muy bajo ruido (ICM),
      Mahony puede converger más rápido que Madgwick. Evaluar.

### Hardware

- [ ] **I²C pins hardcodeados** (`I2C_SDA_PIN=6`, `I2C_SCL_PIN=7`) —
      asume ESP32-C3 SuperMini. Si cambia el board, parametrizar.
- [ ] **LASER pin** = GPIO 5, también hardcodeado al pinout SuperMini.

### Bus de comunicación

Hoy **todos los drivers usan I²C** porque a 200 Hz × ~24 B/sample =
4.8 KB/s, I²C @ 400 kHz entrega ~50 KB/s útiles — sobra 10×.

Casos en los que valdría la pena agregar otros buses:

- [ ] **SPI para ICM-42688** si se requiere ODR > 1 kHz (investigación
      Allan-variance fina, o experimentos de bandwidth analysis). SPI
      del ICM llega a 24 MHz. Cambia `Wire.*` por `SPI.*` en `icmInit/Read`
      + un CS pin dedicado.
- [ ] **SPI para MPU-9250** si I²C se vuelve cuello de botella con
      múltiples sensores en el mismo bus. SPI hasta 20 MHz.
- [ ] **UART para BNO055** como fallback si el I²C tiene problemas de
      ruido EM o conflictos de address en producción. El BNO expone
      UART nativo (no SPI). Consume TX/RX adicionales del ESP32.

Refactor necesario para soportar esto: abstraer `readReg8/writeReg8` a
una capa que despache por tipo de bus (I²C/SPI/UART). Hoy esa abstracción
no existe y cada driver llama `Wire.*` directamente. **Posponer** hasta
que haya un caso de uso real que lo justifique.

### Para uso clínico (referencia de selección)

Si en el futuro se busca certificación clínica (FDA / CE marca), la
elección de sensor + protocolo no es trivial. Notas para esa decisión:

- **Sensor recomendado**: ICM-42688-P o ISM330DHCX (ambos industriales,
  ARW ≈ 0.3 °/√h, BI < 30 °/h, rango temp -40/+85 °C, supply chain
  garantizado por TDK/ST).
- **Bus**: SPI obligatorio. Entornos clínicos tienen EMI fuerte de
  otros equipos; la integridad de señal de SPI con CS dedicado es
  superior a I²C en cables largos.
- **MCU**: ESP32-S3 o STM32 antes que ESP32-C3 (más periféricos
  industriales, mejor disponibilidad de toolchain certificable).
- **6-DOF es suficiente** para vHIT (la sesión es corta, drift de yaw
  irrelevante con CAL al inicio). 9-DOF agrega complejidad sin
  beneficio clínico claro.
- **Evitar**: BNO055 (EOL probable, historia legal Hillcrest), MPU-9250
  (discontinued), ITG-3205/MPU-6050 (consumer-grade, ruido alto).
