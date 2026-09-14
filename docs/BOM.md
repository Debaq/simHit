# Bill of Materials — Gafas SimHIT

> **Estado:** borrador. Componentes inferidos del firmware (`firmware/simhit/simhit.ino`) y del PCB (`hardware/simHIT/sinHIT.kicad_*`). **Faltan precios y links de proveedor reales** — completar antes de publicar.

Última actualización: 2026-05-13

## Resumen

| Sección | Costo estimado USD | CLP |
|---|---|---|
| Electrónica | _pendiente_ | _pendiente_ |
| Carcasa (impresión 3D) | _pendiente_ | _pendiente_ |
| Tornillería + cinta | _pendiente_ | _pendiente_ |
| **Total por unidad** | **_pendiente_** | **_pendiente_** |

## Electrónica

| # | Componente | Encapsulado | Cant. | Función | Proveedor sugerido | Link | Precio unit. USD |
|---|---|---|---|---|---|---|---|
| 1 | ESP32-C3 SuperMini | módulo | 1 | MCU principal, USB-C nativo, I²C, NVS | AliExpress / LCSC | _pendiente_ | _pendiente_ |
| 2 | L3G4200D (giroscopio 3 ejes) | LGA-16 / módulo breakout | 1 | Velocidad angular, ±2000 dps, I²C `0x69` | _pendiente_ | _pendiente_ | _pendiente_ |
| 3 | LSM303DLHC (accel + magnetómetro) | LGA / módulo breakout | 1 | Aceleración lineal y campo magnético, I²C | _pendiente_ | _pendiente_ | _pendiente_ |
| 4 | Módulo láser puntero rojo 650 nm | módulo | 1 | Referencia visual de fijación (GPIO5 active-high) | AliExpress | _pendiente_ | _pendiente_ |
| 5 | Resistencia limitadora láser | 0805 / through-hole | 1 | Driver simple del láser (calcular según Vf del módulo) | _pendiente_ | _pendiente_ | _pendiente_ |
| 6 | Condensadores de desacople 100 nF | 0805 | ≥4 | Filtrado de alimentación de los sensores | _pendiente_ | _pendiente_ | _pendiente_ |
| 7 | Resistencias pull-up I²C 4.7 kΩ | 0805 | 2 | SDA/SCL (GPIO6 / GPIO7) | _pendiente_ | _pendiente_ | _pendiente_ |
| 8 | Conector USB-C | — | 1 | Integrado en ESP32-C3 SuperMini | — | — | — |
| 9 | Pin headers / conectores | — | _verificar_ | Para sensores si se usan módulos breakout | _pendiente_ | _pendiente_ | _pendiente_ |

> **Verificar contra KiCad**: abrir `hardware/simHIT/sinHIT.kicad_sch` y exportar BoM desde KiCad (`Tools → BoM`) para cruzar referencias y completar esta tabla con los valores exactos.

## Alternativas funcionalmente equivalentes

| Componente original | Alternativa | Notas |
|---|---|---|
| L3G4200D | L3GD20H, MPU6050 (gyro+accel integrado), BNO055 (fusión interna) | Requiere ajustar firmware (driver, dirección I²C, sensibilidad). |
| LSM303DLHC | LIS3MDL + LSM6DS33, BNO055 | Cambia el cálculo de heading. |
| ESP32-C3 SuperMini | Cualquier ESP32-C3/S2/S3 con USB nativo y ≥2 pines I²C libres | Reasignar `I2C_SDA_PIN`/`I2C_SCL_PIN` y `LASER_PIN`. |

## Carcasa

| # | Item | Material | Cant. | Notas |
|---|---|---|---|---|
| C1 | Carcasa frontal | PLA / PETG | 1 | STL en `hardware/enclosure/stl/` (pendiente). |
| C2 | Carcasa trasera | PLA / PETG | 1 | Idem. |
| C3 | Cinta de ajuste a cabeza | Velcro elástico ~20 mm | ~50 cm | _pendiente confirmar largo_. |

## Tornillería

| # | Tipo | Cant. | Notas |
|---|---|---|---|
| T1 | M2×6 cabeza plana | _pendiente_ | Fijación PCB → carcasa. |
| T2 | M3×8 | _pendiente_ | Cierre de carcasas. |
| T3 | Insertos roscados de calor M2/M3 | _pendiente_ | Opcional, para ciclos de apertura repetida. |

## Tiempo y herramientas

- Impresión 3D: ~_pendiente_ h.
- Soldadura: ~_pendiente_ min (SMD + cabezales).
- Herramientas: estación de soldadura, flux, multímetro, impresora 3D FDM, USB-C, PC con Arduino IDE o `arduino-cli`.

## Notas de seguridad

- Láser clase ≤ 1 / ≤ 1 mW (puntero rojo de baja potencia). **No apuntar a los ojos**. Aunque la fijación es a 1 m mirando una pared, advertir en build guide.
- Equipo **no médico**: el BoM no implica certificación CE / FDA.
