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

## 2. Detección de hardware roto / inutilizable

### Problema

No nos importa si el sensor es genuino, clon o pirata. Nos importa **si funciona bien para vHIT**. Un clon que se comporta dentro de spec es perfectamente válido. Un chip "genuino" dañado o ruidoso, no.

Síntomas que sí rompen el examen y queremos detectar:

- Accel saturado, muerto o con eje invertido (gravedad fuera de rango).
- Cable malo / soldadura fría → lecturas erráticas.
- Silicio dañado con ruido muy por encima del umbral usable de vHIT.
- Bias gigante incalibrable (offset enorme que no se va con el zero).
- Ejes podridos o cross-talk severo entre gyros.

El veredicto es **usable / marginal / roto**, no genuino / pirata.

### Diseño propuesto — suite de validación funcional

Una nueva tarjeta **"Validación funcional"** en paso 2 que corre las pruebas y emite veredicto por cada una. El usuario presiona "Ejecutar validación" con el sensor inmóvil sobre una superficie estable durante 30 segundos.

| # | Test | Qué mide | Pass criterion |
|---|---|---|---|
| **1** | Gravedad estática | Con sensor quieto en superficie plana, ‖a‖ debería ser 9.80 ± 0.20 m/s². Detecta saturación del accel, eje invertido, o cable malo. | 9.60 ≤ ‖a‖ ≤ 10.00 m/s² |
| **2** | Noise floor del gyro (10 s) | Captura corta con sensor estático, computa ARW y BI por eje. Compara contra **umbral absoluto de usabilidad vHIT** (no contra datasheet del chip). | ARW < umbral_vhit, BI < umbral_vhit |
| **3** | Bias estático del gyro (10 s) | Media de ‖ω‖ con sensor quieto. Detecta offset incalibrable. | ‖media(ω)‖ < umbral_bias (configurable) |
| **4** | Cross-axis isolation | Pide al usuario rotar solo en yaw 90°. Integra gyro X/Y/Z. Yaw debería integrar a ~90°, otros ≤ 5°. Detecta ejes podridos o cross-talk severo. | yaw ∈ [80°, 100°], otros < 5° |

WHO_AM_I se mantiene en el flujo de boot (para elegir driver) pero **no es gate de autenticidad** — clon que reporta ID correcto y anda bien = pass.

Tests 1-3 son automáticas (no requieren input del usuario). El 4 requiere guía interactiva.

Reporte estructurado `HW VALIDATION JSON {...}` que el cliente parsea y muestra como tabla con badges (`usable` / `marginal` / `roto`). Persistir en `sensor_profile.json` para auditoría.

Los umbrales `umbral_vhit`, `umbral_bias` viven en una tabla del cliente y se pueden tunear sin reflashear. Default conservador derivado de los datasheets de los sensores ya soportados.

### Esfuerzo estimado

- Firmware: ~150 líneas. Helpers de integración, medias estáticas, comando `VALIDATE`.
- Cliente: ~150 líneas. UI con paso interactivo para test 4, parsing del reporte, tabla con badges, tabla de umbrales editable.
- Tests Rust: si las pruebas 2-4 producen métricas, agregar fixture CSVs.

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
2. **(2) Suite de validación funcional** — antes de creer en los datos, validamos que el hardware funciona dentro de los umbrales de vHIT.
3. **(1) Configuración pesada** — ya con (1) y (2) atados, podemos jugar con parámetros sin perder la coherencia del setup.

## Dependencias entre los tres

- (1) y (3) requieren ambos extender el `BOOT JSON` o agregar comandos `CONFIG GET`/`AXES GET` para sincronizar estado entre firmware y cliente.
- (2) test 4 (noise floor) reusa la infraestructura del Allan corto in-situ que ya tenemos en `allan-inplace.svelte.ts`.
- (2) test 4 (cross-axis) requiere el mapeo de ejes ya configurado — por eso (3) va antes.

## Bump de firmware al cerrar todo

Cada uno suma un campo en `IMU STATUS JSON` y unos comandos:

| Fase | FW version | Nuevos comandos | Cambio en STATUS JSON |
|---|---|---|---|
| Después de (3) | 1.4.0 | `AXES GET`, `AXES SET`, `AXES RESET`, `AXES WIZARD` | `axes: {...}` |
| Después de (2) | 1.5.0 | `VALIDATE` | `hw_validation: {...}` |
| Después de (1) | 1.6.0 | `CONFIG GET`, `CONFIG SET`, `CONFIG CAPS`, `CONFIG RESET` | `config: {...}` |

## Total estimado

- ~380 líneas de firmware + tests
- ~550 líneas de frontend
- ~3 sesiones de trabajo (una por área) si vamos limpio

## Riesgos

- Umbrales de usabilidad vHIT (ARW, BI, bias) no están publicados en literatura — requieren bench testing con sensores conocidos buenos para calibrar la tabla default.
- Wizard 3D: si usamos threlte/three.js suma dep grande al bundle. Alternativa: SVG isométrico simple, más liviano y suficiente para visualizar el frame.
- Veredicto graduado (usable / marginal / roto), no boolean — la línea entre "marginal" y "roto" es subjetiva y depende del paciente/protocolo. Mostrar números crudos junto al badge para que el usuario decida.
