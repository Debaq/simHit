# Build Guide — Gafas SimHIT

> **Estado:** borrador. Faltan fotos por paso. Texto basado en el firmware y BoM actuales.

Tiempo estimado total: **~3–4 h** (sin contar impresión 3D, que va en paralelo).

## 0. Antes de empezar

- [ ] Revisar [`BOM.md`](BOM.md) y tener todos los componentes.
- [ ] Imprimir las piezas STL (`hardware/enclosure/stl/`, pendiente). Recomendación: PLA, capa 0.2 mm, relleno 30 %, sin soportes salvo en encastres.
- [ ] Tener instalada la toolchain del firmware: Arduino IDE 2.x **o** `arduino-cli`, con board ESP32-C3 y librerías `Adafruit_Sensor`, `Adafruit_LSM303_Accel`, `Adafruit_LSM303DLH_Mag`, `Adafruit_AHRS`.
- [ ] Tener la app SimHIT instalada (ver `app/README.md`).

---

## 1. Verificación de PCB

> _foto pendiente_

1. Inspección visual: que no haya cortocircuitos en pads, que el footprint del ESP32-C3 SuperMini coincida con el módulo real.
2. Multímetro: continuidad GND ↔ pin GND del ESP32; resistencia VCC ↔ GND debe ser **alta** (>1 kΩ). Si está en corto, **no soldar nada más**.

## 2. Soldadura

> _foto pendiente, una por sub-paso_

Orden recomendado (de bajo perfil a alto perfil):

1. Resistencias y condensadores SMD 0805.
2. Pull-ups I²C (4.7 kΩ) en SDA/SCL.
3. IMU L3G4200D (si va SMD directo). Si va por módulo breakout: omitir y dejar para el paso 5.
4. LSM303DLHC (idem).
5. Pin headers para módulos breakout (si aplica).
6. ESP32-C3 SuperMini sobre headers (recomendado, para poder reemplazarlo).
7. Cables del láser y resistencia limitadora.

Limpiar flux con isopropanol al terminar.

## 3. Flasheo del firmware

Conectar la placa por USB-C. Identificar puerto:

```bash
ls /dev/ttyACM* /dev/ttyUSB*
```

Compilar y flashear con `arduino-cli`:

```bash
arduino-cli core install esp32:esp32
arduino-cli lib install "Adafruit Unified Sensor" \
                       "Adafruit LSM303 Accel" \
                       "Adafruit LSM303DLH Mag" \
                       "Adafruit AHRS"
arduino-cli compile --fqbn esp32:esp32:esp32c3 firmware/simhit
arduino-cli upload  --fqbn esp32:esp32:esp32c3 -p /dev/ttyACM0 firmware/simhit
```

> Si el chip no entra en modo bootloader, mantener pulsado **BOOT** y pulsar **RESET** mientras se inicia el upload.

## 4. Verificación funcional (serial)

Abrir monitor serial a **460 800 baud**, fin de línea `\n`:

```bash
# minicom -D /dev/ttyACM0 -b 460800
# o desde la app SimHIT — detecta el equipo automáticamente.
```

Comandos para validar el equipo:

| Comando | Respuesta esperada |
|---|---|
| `HELLO` | Banner / ACK del firmware. |
| `IMU ON` | Empieza a emitir tramas `angX;angY;angZ;...;crc\n` a 200 Hz. |
| `LASER ON` | Enciende el láser (GPIO5). |
| `LASER OFF` | Apaga el láser. |
| `IMU STATUS` | Muestra estado, bias del giroscopio. |
| `MAG STATUS` | Muestra calibración del magnetómetro (hard/soft iron). |

Ver protocolo completo en [`SERIAL-PROTOCOL.md`](SERIAL-PROTOCOL.md).

## 5. Calibración inicial (obligatoria)

> _foto del gesto pendiente_

1. **Giroscopio** (`IMU CAL`): cabezal **completamente quieto** sobre la mesa durante 2 s. Persiste el bias en NVS.
2. **Magnetómetro** (`MAG CAL`): mover el cabezal en figura de 8 lenta durante ~20 s. La app va mostrando los extremos detectados. Persiste hard-iron y soft-iron por eje.
3. Verificar que en reposo `yaw`, `pitch`, `roll` se mantienen estables (< ±0.5°/s de drift en yaw).

> **Cuándo recalibrar:** si se cambia el sensor, si la deriva en reposo supera 1°/s, si la lectura de heading es errática.

## 6. Montaje en carcasa

> _foto pendiente_

1. Apoyar el PCB en la carcasa frontal, alinear el láser con la apertura.
2. Cerrar con la carcasa trasera y fijar con tornillería (ver BoM).
3. Pasar la cinta de ajuste por las ranuras laterales.
4. Probar fit sobre cabeza de prueba: que no quede holgado ni comprima.

## 7. Pruebas con la app

1. Conectar la placa por USB-C al PC con la app SimHIT abierta. Debe detectarse automáticamente.
2. Abrir vista en vivo: comprobar que las tres siluetas (superior, coronal, lateral) responden al movimiento real del cabezal.
3. Cargar caso "normal", hacer 5 impulsos a cada lado. Confirmar veredicto inmediato y registro del impulso en pantalla.

## 8. Troubleshooting

| Síntoma | Causa probable | Acción |
|---|---|---|
| `IMU ON` no emite nada | I²C cortado o IMU mal soldado | Comprobar continuidad SDA/SCL, leer registro `WHO_AM_I` del L3G4200D. |
| Yaw deriva varios °/s en reposo | Calibración perdida | `IMU CAL` con la placa quieta. |
| Heading salta a saltos | Magnetómetro saturado (cerca de metal/imanes) | Alejar de fuentes magnéticas, repetir `MAG CAL`. |
| Pico de velocidad mucho mayor al esperado | CRC corrupto / línea ruidosa | Probar otro cable USB, verificar tierra común. |
| App no detecta el equipo | Driver USB o permisos | En Linux: añadir usuario a `dialout` / `uucp`. |

## 9. Checklist final antes de usar con alumnos

- [ ] Calibración gyro y magnetómetro persistidas.
- [ ] Yaw estable en reposo (deriva < 1°/s).
- [ ] Láser enciende y apaga por comando.
- [ ] La app valida correctamente un impulso de prueba a cada lado.
- [ ] La carcasa no se afloja con movimientos bruscos.
- [ ] Etiquetado del equipo (número de serie interno) para trazabilidad de datasets.
