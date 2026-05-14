# Plan — Configuración pesada del sensor, validación de clones y mapeo de ejes

Tres áreas independientes que comparten lugar en la UI (paso 2 — Sensor)
y agregan robustez al setup de SimHIT antes del examen vHIT.

---

## 1. Configuración pesada del sensor

### Problema

Hoy los parámetros de bajo nivel del chip están **hardcodeados en cada `xInit()`** del firmware:

- Rango full-scale gyro: ±2000 dps (todos los drivers)
- Rango full-scale accel: ±16 g
- ODR efectivo: 200 Hz (limitado por `SAMPLE_RATE_HZ`)
- DLPF cutoff: variable por chip, no expuesto
- Power mode: low-noise (donde aplica)

Si el usuario quiere experimentar (p.ej. para Allan variance fina a τ chico necesita ODR > 1 kHz, o para test de saturación quiere bajar a ±500 dps), no puede sin reflashear con macros distintas.

### Diseño propuesto

**Firmware:**

- Struct global `SensorConfig` persistida en NVS:
  ```c
  struct SensorConfig {
    uint16_t gyro_fs_dps;       // 250 / 500 / 1000 / 2000 / 4000 (según chip)
    uint8_t  accel_fs_g;        // 2 / 4 / 8 / 16
    uint16_t odr_hz;            // 100 / 200 / 500 / 1000 (según chip)
    uint16_t dlpf_cutoff_hz;    // 0 = sin filtro, sino LPF cutoff
    uint8_t  power_mode;        // 0 = low-power, 1 = low-noise
  };
  ```
- Cada `xInit()` recibe `SensorConfig` y mapea a registros propios del chip. Validar al inicio: si la combinación no es soportada, fallar con mensaje claro (`CONFIG fail unsupported gyro_fs=4000 driver=L3G`).
- Nuevos comandos serial:
  - `CONFIG GET` → JSON con valores actuales
  - `CONFIG SET gyro_fs=2000 accel_fs=16 odr=200 dlpf=50 power=1` → aplica, persiste en NVS, requiere reset
  - `CONFIG RESET` → defaults

**Cliente:**

- Nueva tarjeta "Configuración avanzada" en `/metricas` paso 2, plegable (cerrada por defecto).
- Form con los 5 campos. Dropdowns con los valores válidos del driver detectado (no hardcoded — el firmware reporta capacidades vía `CONFIG GET` o un nuevo `CONFIG CAPS`).
- Botón "Aplicar y reiniciar SimHIT" → manda `CONFIG SET` + `RESET`, espera reconnect.

### Esfuerzo estimado

- Firmware: ~150 líneas. Tabla de capacidades por driver, mapeo a registros, persistencia.
- Cliente: ~100 líneas. UI form + invoke + reconnect handling.
- Tests: agregar al CI un test que verifique que cada driver acepta su SensorConfig por defecto y rechaza valores fuera de rango.

---

## 2. Detección de sensores piratas / clones

### Problema

Los módulos chinos baratos a veces:

- Llevan stickers que mienten (MPU-6050 vendido como MPU-9250).
- Falsifican WHO_AM_I (devuelven el ID esperado pero el chip interno es distinto).
- Tienen el silicio dañado y reportan datos con ruido fuera de spec.
- Vienen con bias gigante imposible de calibrar.
- ADXL345B (chinos) tienen ruido 5× peor que el original.
- HMC5883L que en realidad es QMC5883L (mismo módulo HW-579).

Si entras al paper sin detectar esto, los resultados son irreproducibles.

### Diseño propuesto — suite de validación de hardware

Una nueva tarjeta **"Validación de hardware"** en paso 2 que corre 5 pruebas y emite veredicto pass/marginal/fail por cada una. El usuario presiona "Ejecutar validación" con el sensor inmóvil sobre una superficie estable durante 30 segundos.

| # | Test | Qué mide | Pass criterion |
|---|---|---|---|
| **1** | WHO_AM_I | Identificación básica (ya se hace) | Valor esperado del driver activo |
| **2** | Self-test del MEMS | Aplica fuerza electrostática al gyro/accel y verifica respuesta. Distingue chip real de emulación. Cada chip tiene su rutina (BST_RES en ICM, ST_GYRO/ACCEL en MPU). | Respuesta dentro del rango datasheet (±5-30%) |
| **3** | Gravedad estática | Con sensor quieto en superficie plana, ‖a‖ debería ser 9.80 ± 0.20 m/s². Detecta saturación del accel, eje invertido, o cable malo. | 9.60 ≤ ‖a‖ ≤ 10.00 m/s² |
| **4** | Noise floor del gyro (10 s) | Captura corta con sensor estático, computa ARW e BI por eje. Compara contra datasheet (`SENSOR_REFERENCES`). | ARW < 2× datasheet, BI < 3× datasheet |
| **5** | Cross-axis isolation | Pide al usuario rotar solo en yaw 90°. Integra gyro X/Y/Z. Yaw debería integrar a ~90°, otros ≤ 5°. Detecta ejes mal alineados o cross-talk severo. | yaw ∈ [80°, 100°], otros < 5° |

Las primeras 4 son automáticas (no requieren input del usuario). La 5 requiere guía interactiva.

Reporte estructurado `HW VALIDATION JSON {...}` que el cliente parsea y muestra como tabla con badges. Persistir en `sensor_profile.json` para auditoría.

### Esfuerzo estimado

- Firmware: ~250 líneas. Self-test register sequences por driver, helpers de integración, comando `VALIDATE`.
- Cliente: ~150 líneas. UI con paso interactivo para test 5, parsing del reporte, tabla con badges.
- Tests Rust: si las pruebas 4-5 producen métricas, agregar fixture CSVs.

---

## 3. Configuración de ejes — wizard automático

### Problema actual

`serial.svelte.ts` tiene un `AxesConfig` con dos sub-objetos (`pose` y `gyro`), cada uno con `yaw/pitch/roll` que se mapean a `{axis: 'x'|'y'|'z', sign: 1|-1}`. Total: 12 dimensiones de configuración por axis con 6 combinaciones cada una → cientos de combinaciones posibles.

Hoy el usuario edita esto manualmente (no recuerdo en qué pantalla — modal docente o algún form). Es propenso a error:

- Diferencia entre "yaw del sensor" y "yaw del paciente" no es intuitiva.
- Pose vs gyro deben ser distintos (pose es orientación absoluta, gyro es velocidad angular instantánea), y eso confunde al usuario.
- Sin visualización no podés saber si el mapeo está bien hasta que rompes el examen.

### Diseño propuesto — wizard 4 pasos

Nuevo modal "Asistente de ejes" lanzable desde paso 2.

**Paso A. Detección de placa**

Si el driver detectado es uno conocido (l3g-lsm303, icm-42688, bno055, etc.), proponer el mapeo default conocido (presets vendidos con SimHIT). Usuario puede confirmar y saltar el wizard, o seguir si tiene un montaje no-estándar.

**Paso B. Calibrar pose neutra**

Pedirle al usuario que sostenga la gafa **horizontal, mirando al frente** y presione "Capturar pose neutra". El firmware reporta `(ax, ay, az)` raw → calculamos el vector gravedad en el frame del sensor. Eso fija qué eje del sensor es "pitch" (apunta perpendicular al piso).

**Paso C. Test de yaw**

"Girá la cabeza a la derecha **45°**". Detectamos qué eje del gyro incrementó. Si el sensor está montado al revés, el incremento es negativo — fijamos el sign automáticamente.

**Paso D. Test de pitch**

"Inclinás la cabeza hacia adelante". Mismo principio para el eje pitch.

Roll queda determinado por los otros dos (producto vectorial).

Resultado: `AxesConfig` completo auto-determinado. Mostramos visualización 3D del frame del sensor con flechas etiquetadas "yaw paciente", "pitch paciente", "roll paciente" en colores. Usuario puede repetir el wizard si visualmente se ve mal.

### UX adicional

- **Validación live post-wizard**: ventana pequeña con lecturas en tiempo real. Si girás la cabeza, el indicador "yaw" debería crecer en el signo correcto.
- **Persistencia en NVS del firmware**, no solo localStorage del cliente: así un equipo SimHIT compartido entre varios pacientes mantiene su mapeo aunque cambien de PC.
- **Reset a defaults del driver** disponible siempre.

### Esfuerzo estimado

- Firmware: ~80 líneas. Persistir `AxesConfig` en NVS, comando `AXES GET/SET`, broadcast en banner de boot.
- Cliente: ~300 líneas. Modal wizard 4 pasos, visualización 3D simple (SVG 3D o threlte/three.js), live preview, lógica de auto-detección.

---

## Orden de implementación recomendado

1. **(3) Wizard de ejes primero** — desbloquea uso real con sensores nuevos. Es la fricción más alta hoy.
2. **(2) Suite de validación de hardware** — antes de empezar a creer en los datos, validamos que el silicio es real.
3. **(1) Configuración pesada** — ya con (1) y (2) atados, podemos jugar con parámetros sin perder la coherencia del setup.

## Dependencias entre los tres

- (1) y (3) requieren ambos extender el `BOOT JSON` o agregar comandos `CONFIG GET`/`AXES GET` para sincronizar estado entre firmware y cliente.
- (2) test 4 (noise floor) reusa la infraestructura del Allan corto in-situ que ya tenemos en `allan-inplace.svelte.ts`.
- (2) test 5 (cross-axis) requiere el mapeo de ejes ya configurado — por eso (3) va antes.

## Bump de firmware al cerrar todo

Cada uno suma un campo en `IMU STATUS JSON` y unos comandos:

| Fase | FW version | Nuevos comandos | Cambio en STATUS JSON |
|---|---|---|---|
| Después de (3) | 1.4.0 | `AXES GET`, `AXES SET`, `AXES RESET`, `AXES WIZARD` | `axes: {...}` |
| Después de (2) | 1.5.0 | `VALIDATE` | `hw_validation: {...}` |
| Después de (1) | 1.6.0 | `CONFIG GET`, `CONFIG SET`, `CONFIG CAPS`, `CONFIG RESET` | `config: {...}` |

## Total estimado

- ~480 líneas de firmware + tests
- ~550 líneas de frontend
- ~3 sesiones de trabajo (una por área) si vamos limpio

## Riesgos

- Self-test de cada chip tiene quirks distintos; la implementación está bien documentada en cada datasheet pero requiere bench testing.
- Wizard 3D: si usamos threlte/three.js suma dep grande al bundle. Alternativa: SVG isométrico simple, más liviano y suficiente para visualizar el frame.
- Sensores piratas que pasan WHO_AM_I y self-test pero fallan noise floor — el reporte debe ser graduado (no boolean), porque la línea de qué es "malo" es subjetiva.
