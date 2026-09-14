# Protocolo serial — firmware SimHIT

Extraído de `firmware/simhit/simhit.ino`. Mantener este documento sincronizado con el firmware en cada release.

## Conexión

- USB-C nativo (ESP32-C3 SuperMini, CDC ACM).
- Baud rate: **460 800**.
- Fin de línea: `\n`.

## Salida — formato extendido (actual)

```
angX;angY;angZ;gyroX;gyroY;gyroZ;angAccX;angAccY;angAccZ;linAccX;linAccY;linAccZ;tsMs;crc\n
```

12 floats + timestamp + CRC:

| Campo | Unidad | Origen |
|---|---|---|
| `angX angY angZ` | ° (yaw/pitch/roll) | Fusión Madgwick |
| `gyroX gyroY gyroZ` | °/s | L3G4200D |
| `angAccX angAccY angAccZ` | °/s² | Derivada filtrada del gyro (SG, IIR, NONE) |
| `linAccX linAccY linAccZ` | m/s² | LSM303DLHC (sin compensación de gravedad) |
| `tsMs` | ms (uint32) | `millis()` desde boot |
| `crc` | hex | CRC-16 CCITT 0x1021, init 0xFFFF, sobre el payload previo al `;crc\n` |

## Salida — formato legacy

Versiones anteriores emitían solo los 6 primeros floats (`ang*;gyro*`). El parser de la app tolera ambos.

## Tasa

200 Hz (`SAMPLE_RATE_HZ = 200`). Período = 5 000 µs.

## Entrada — comandos

| Comando | Acción |
|---|---|
| `IMU ON` | Inicia emisión de tramas. |
| `IMU OFF` | Detiene emisión. |
| `IMU CAL` | Calibra bias del giroscopio (cabezal quieto, ~2 s). Persiste en NVS. |
| `IMU CLR` | Borra calibración del giroscopio. |
| `IMU STATUS` | Reporta bias actual, estado. |
| `MAG CAL` | Calibra hard/soft iron del magnetómetro (figura-8, ~20 s). Persiste en NVS. |
| `MAG CLR` | Borra calibración del magnetómetro. |
| `MAG STATUS` | Reporta offsets y escalas magnetómetro. |
| `LASER ON` / `LASER OFF` / `LASER STATUS` | Control del láser (GPIO5 active-high). |
| `FILTER SG` / `FILTER IIR` / `FILTER NONE` | Método para `angAcc*`. Persiste en NVS clave `accelFilt`. Default: SG. |
| `FILTER STATUS` | Reporta filtro activo. |
| `HELLO` | Handshake / banner. |
| `RESET` | Reset del MCU. |

## Pines

| Función | GPIO |
|---|---|
| I²C SDA | 6 |
| I²C SCL | 7 |
| Láser (active-high) | 5 |

## Direcciones I²C

| Dispositivo | Addr |
|---|---|
| L3G4200D (gyro) | `0x69` |
| LSM303DLHC accel | `0x19` (Adafruit driver, por defecto) |
| LSM303DLHC mag | `0x1E` |

## NVS — claves persistidas

| Clave | Contenido |
|---|---|
| Bias gyro | `gx_bias`, `gy_bias`, `gz_bias` (rad/s) |
| Mag hard-iron | `mx_off`, `my_off`, `mz_off` |
| Mag soft-iron | `mx_scl`, `my_scl`, `mz_scl` |
| Filtro angAcc | `accelFilt` (SG / IIR / NONE) |

## CRC

CRC-16 CCITT, polinomio `0x1021`, init `0xFFFF`, sin reflect, sin XOR final. Calculado sobre el payload completo hasta el `;` que precede al campo `crc`. El cliente debe descartar tramas con CRC inválido.
