# Parte 1 — El sentido nuevo de esta etapa

Hasta ahora SimHIT era "un dispositivo educativo abierto con un software de simulación". Con lo que estás proponiendo —caracterización integrada, soporte multi-sensor, y flasheo del firmware desde la propia app— pasa a ser otra cosa: **una plataforma de entrenamiento vHIT completa, autocontenida, donde el usuario final no necesita compiladores, scripts de Python, ni conocimiento de electrónica para poner en marcha su equipo.**

Esta diferencia importa muchísimo para HardwareX porque resuelve la objeción más frecuente que reciben los papers de hardware abierto: *"se ve replicable en el paper pero en la práctica el setup es inviable para alguien fuera del laboratorio original."* Con flasheo y caracterización embebidos, el flujo del nuevo usuario es:

1. Imprime/manda a fabricar la PCB y la carcasa con los archivos del repo.
2. Suelda el IMU que haya conseguido (cualquiera de los 4 validados, u otro).
3. Conecta por USB-C.
4. Abre SimHIT. La app detecta el ESP32, ofrece flashear el firmware, ejecuta la caracterización guiada, genera el perfil del sensor con veredicto de cumplimiento vHIT.
5. Empieza a entrenar.

Sin terminal. Sin Arduino IDE. Sin esptool.py. Sin scripts sueltos. Ese flujo es lo que separa un paper de HardwareX "interesante" de uno "imprescindible".

La estructura narrativa del manuscrito que esto habilita se sostiene en cinco contribuciones, no en una:

1. Hardware: gafa replicable con cuatro stacks de IMU validados.
2. Firmware: abierto, multi-sensor con abstracción de driver, flasheable desde la app.
3. Software de simulación: el simulador vHIT educativo (ya existente).
4. Software de caracterización: módulo embebido para validar cualquier sensor.
5. Dataset de referencia: las mediciones de los cuatro sensores como baseline comparativo público.

Eso es contribución cuádruple desde lo metodológico. HardwareX permite manuscritos extensos cuando hay sustancia, y esto la tiene.

---

# Parte 2 — Especificación técnica detallada

A continuación está todo lo que necesitas para codear con autonomía. Cada componente lleva: responsabilidades, contrato (entradas/salidas/errores), algoritmo cuando aplica, y criterios de aceptación que el código debe cumplir.

## 2.1 Componente: capture.rs

**Responsabilidad:** leer el flujo serial del ESP32, validar cada muestra, escribirla a un CSV en disco con timestamp local, emitir eventos de progreso al frontend.

**Contrato del comando público:**

```rust
pub struct StaticCaptureConfig {
    pub duration_seconds: u64,        // 1800–43200 (30 min a 12 h)
    pub output_dir: PathBuf,          // donde se crea la sesión
    pub sensor_label: String,         // "ICM-42688", elegido por el usuario
    pub ambient_temp_c_start: f32,    // ingresado por el usuario
    pub preheat_minutes: u32,         // típicamente 15, configurable
    pub serial_port: String,          // "/dev/ttyACM0" o "COM3"
    pub baud_rate: u32,               // según firmware, p.ej. 921600
}

pub struct CaptureSession {
    pub id: String,                   // UUID v4
    pub csv_path: PathBuf,            // <output_dir>/<id>/raw.csv
    pub metadata_path: PathBuf,       // <output_dir>/<id>/session.json
    pub started_at: DateTime<Utc>,
}

pub async fn start_static_capture(
    config: StaticCaptureConfig,
) -> Result<CaptureSession, CaptureError>;
```

**Errores que debe distinguir:**

- `CaptureError::PortNotFound(String)` — el puerto serial no existe o está ocupado.
- `CaptureError::HandshakeFailed` — el ESP32 no respondió al ping inicial.
- `CaptureError::FirmwareVersionMismatch { expected, found }` — firmware demasiado viejo para el módulo.
- `CaptureError::SampleParseError { line, raw }` — línea malformada en el stream.
- `CaptureError::DiskFull` / `CaptureError::DiskWriteError`.

**Flujo interno:**

1. Abrir puerto serial con `tokio-serial`. Configurar timeout de lectura en 100 ms.
2. Enviar comando `HANDSHAKE\n` al ESP32. Esperar respuesta `{"firmware":"x.y.z","sensor":"ICM-42688","sample_rate":200}`. Validar versión mínima.
3. Esperar `preheat_minutes` antes de empezar a grabar, mientras se descartan muestras y se emite progreso de pre-calentamiento al frontend.
4. Enviar comando `CAPTURE START\n`. A partir de la primera muestra válida, comenzar a contar la duración.
5. Por cada línea recibida del ESP32: parsear, validar, escribir al CSV. Mantener buffer de 1024 muestras antes de flush al disco para no fragmentar.
6. Emitir evento Tauri `capture://progress` cada 1 segundo con `{elapsed_s, total_s, samples_written, samples_lost}`.
7. Al cumplir duración, enviar `CAPTURE STOP\n`, cerrar archivos, fijar permisos read-only sobre el CSV, escribir `session.json` con metadatos.
8. Calcular SHA256 del CSV cerrado, almacenar en `session.json`.

**Schema del CSV de salida (formato canónico, único y obligatorio):**

```
timestamp_us,gyro_x_dps,gyro_y_dps,gyro_z_dps,accel_x_g,accel_y_g,accel_z_g,mag_x_uT,mag_y_uT,mag_z_uT,temp_c
0,0.012,-0.008,0.003,0.0011,0.0021,0.9998,12.34,-5.67,40.21,24.8
5000,0.014,-0.007,0.004,0.0012,0.0019,0.9999,12.35,-5.66,40.21,24.8
...
```

- `timestamp_us`: microsegundos desde el inicio de la captura efectiva (primera muestra = 0).
- Si el sensor no tiene magnetómetro (caso ICM-42688), las tres columnas mag se llenan con `NaN`.
- Encabezado obligatorio en la primera línea. Sin BOM. UTF-8. Separador coma. Punto decimal.
- Encoding y formato declarados en `session.json` con sus hashes.

**Schema de session.json:**

```json
{
  "schema_version": "simhit-session-1.0",
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "type": "static_capture",
  "started_at_utc": "2026-05-13T03:00:00Z",
  "ended_at_utc": "2026-05-13T07:00:00Z",
  "duration_s": 14400,
  "config": { "...": "el StaticCaptureConfig serializado" },
  "firmware": { "version": "1.2.0", "sensor": "ICM-42688", "sample_rate_declared_hz": 200 },
  "sampling_summary": {
    "samples_written": 2879523,
    "samples_lost": 477,
    "mean_dt_us": 5001.2,
    "stdev_dt_us": 12.8
  },
  "data_files": {
    "raw.csv": {
      "sha256": "abcd...",
      "size_bytes": 261847230,
      "lines": 2879524
    }
  }
}
```

**Tests de aceptación:**

1. Una captura de 60 segundos a 200 Hz produce un CSV con exactamente 12000 ± 24 filas (tolerancia 0.2%).
2. Si se desconecta el USB durante la captura, el archivo CSV queda cerrado correctamente (no corrupto), `samples_lost` refleja la verdad, y la sesión queda marcada como `incomplete` en `session.json`.
3. El hash SHA256 calculado al final coincide al recalcularlo con `sha256sum` desde terminal.
4. Una segunda captura inmediata genera un session_id distinto y no sobrescribe nada.

---

## 2.2 Componente: allan.rs

**Responsabilidad:** calcular la Allan variance overlapping sobre cada eje del giroscopio, extraer ARW y bias instability, devolver curva graficable.

**Contrato del comando público:**

```rust
pub struct AllanVarianceConfig {
    pub csv_path: PathBuf,
    pub min_tau_s: f64,      // típicamente 0.005 s = 1 muestra a 200 Hz
    pub max_tau_s: f64,      // típicamente duration/10
    pub n_points: usize,     // típicamente 100, distribuidos log-espaciados
}

pub struct AllanVarianceResult {
    pub tau_s: Vec<f64>,                  // length = n_points
    pub sigma_dps_per_axis: Vec<[f64; 3]>, // length = n_points
    pub arw_deg_sqrt_hr: [f64; 3],        // extrapolado a τ=1s, pendiente -½
    pub bias_instability_deg_hr: [f64; 3], // mínimo de la curva
    pub n_samples_total: usize,
    pub duration_s: f64,
}

pub fn compute_allan_variance(
    config: AllanVarianceConfig,
) -> Result<AllanVarianceResult, AnalysisError>;
```

**Algoritmo (overlapping Allan variance):**

Dada una serie temporal $\omega_i$ (i = 1..N) muestreada a frecuencia $f_s$, con período de muestreo $\tau_0 = 1/f_s$:

Para cada $\tau_k$ en el conjunto log-espaciado (paso 1):

a) Definir $m = \tau_k / \tau_0$ redondeado al entero más cercano (cluster size).

b) Calcular promedios de cluster: $\bar{\omega}_j = \frac{1}{m} \sum_{i=jm}^{(j+1)m - 1} \omega_i$ para $j = 0..\lfloor N/m \rfloor - 1$.

c) Calcular la Allan variance estándar:

$$\sigma^2(\tau_k) = \frac{1}{2(M-1)} \sum_{j=0}^{M-2} (\bar{\omega}_{j+1} - \bar{\omega}_j)^2$$

donde $M$ es el número de clusters.

d) $\sigma(\tau_k) = \sqrt{\sigma^2(\tau_k)}$.

Optimización para la versión *overlapping* (mejor estadística que la versión no-overlapping): en lugar de clusters disjuntos, deslizar el cluster de 1 muestra en 1 muestra. Esto multiplica el número de muestras útiles por $m$ y reduce el error estadístico de $\sigma(\tau)$ en un factor $\sqrt{m}$. Para una implementación eficiente, calcular la suma acumulada de $\omega$ una sola vez:

```rust
// pseudocódigo
let theta: Vec<f64> = omega.iter().scan(0.0, |acc, &x| { *acc += x * tau_0; Some(*acc) }).collect();
// luego para cada m:
//   sigma^2(tau) = sum_{i=0..N-2m} (theta[i+2m] - 2*theta[i+m] + theta[i])^2 / (2 * tau^2 * (N - 2m))
```

Esta forma es estándar en metrología (IEEE 1554/1139). Es la que deben implementar y citar.

**Extracción de ARW:** ajustar una recta de pendiente $-\frac{1}{2}$ en el rango log-log de τ ∈ [1, 10] s y leer el valor de σ en τ = 1 s. ARW (en °/√h) = σ(1s) × √3600.

**Extracción de bias instability:** el mínimo de la curva σ(τ) multiplicado por una constante 1/0.664 (factor estándar). Reportar también el τ donde ocurre el mínimo.

**Tests de aceptación:**

1. Una señal sintética de ruido blanco gaussiano puro de σ conocida produce una curva Allan con pendiente exacta -½ en log-log.
2. Una señal sintética que es ruido blanco + drift lineal produce una curva con valle visible en algún τ intermedio.
3. Re-procesar el mismo CSV produce resultados idénticos hasta el bit (función determinística).
4. Procesamiento de un CSV de 4 h a 200 Hz se completa en menos de 60 segundos en un laptop estándar.

---

## 2.3 Componente: sampling.rs

**Responsabilidad:** analizar timestamps del CSV y reportar frecuencia real, jitter y muestras perdidas.

**Contrato:**

```rust
pub struct SamplingResult {
    pub declared_hz: f64,                // del firmware
    pub measured_hz: f64,                // 1 / mean_dt
    pub mean_dt_us: f64,
    pub stdev_dt_us: f64,
    pub p50_dt_us: f64,
    pub p99_dt_us: f64,
    pub max_dt_us: f64,
    pub samples_lost_estimate: usize,    // gaps detectables
    pub histogram_dt_us: Vec<(f64, u64)>, // (bin_center, count)
    pub passes_vhit_criterion: bool,     // ≥ 200 Hz y jitter < 10% del período
}
```

**Detección de muestras perdidas:** un Δt entre muestras consecutivas mayor a 1.5× el período declarado se considera un gap. El número estimado de muestras perdidas es `round(dt / período_declarado) - 1`.

**Tests de aceptación:**

1. Sobre un CSV sintético con timestamps perfectamente equiespaciados (Δt = 5000 µs), `stdev_dt_us` debe ser 0 y `passes_vhit_criterion` = true.
2. Sobre un CSV con un gap conocido (saltarse 3 muestras), `samples_lost_estimate` = 3.

---

## 2.4 Componente: synthetic.rs

**Responsabilidad:** generar trazas matemáticas de impulsos cefálicos con parámetros conocidos, pasarlas por el pipeline de detección existente, reportar matriz de confusión y curvas ROC.

**Modelo del impulso cefálico:** un perfil de velocidad angular gaussiano modulado, con velocidad pico $v_p$, duración $T$, amplitud integrada $A$. Forma estándar:

$$\omega(t) = v_p \exp\left(-\frac{(t - T/2)^2}{2(T/6)^2}\right) \cdot s(t)$$

donde $s(t)$ aplica un envelope suave para llevar la señal a cero en los bordes. Verificar que $\int \omega \, dt \approx A$.

**Contrato:**

```rust
pub struct SyntheticConfig {
    pub peak_velocities_dps: Vec<f64>,   // p.ej. [50, 100, 150, 200, 250, 300]
    pub amplitudes_deg: Vec<f64>,        // p.ej. [10, 15, 20, 25]
    pub durations_ms: Vec<f64>,          // p.ej. [120, 150, 180, 200]
    pub noise_levels: Vec<f64>,          // fracciones, p.ej. [0.0, 0.02, 0.05]
    pub repetitions: usize,              // por celda, p.ej. 50
    pub sample_rate_hz: f64,             // 200
}

pub struct RocResult {
    pub confusion_matrix: ConfusionMatrix,
    pub roc_curves: HashMap<String, Vec<(f64, f64)>>, // por detector
    pub auc_by_detector: HashMap<String, f64>,
    pub thresholds_used: HashMap<String, f64>,
}
```

**Tests de aceptación:**

1. Con `noise_level = 0`, todos los detectores deben aceptar el 100% de impulsos dentro de su rango configurado.
2. AUC del detector PeakVelocity debe ser ≥ 0.95 para `noise_level ≤ 0.05`.

---

## 2.5 Componente: profile.rs

**Responsabilidad:** integrar los resultados de los componentes anteriores en un perfil único, calcular veredicto, exportar JSON con hashes verificables.

**Schema completo del perfil exportable:**

```json
{
  "schema_version": "simhit-profile-1.0",
  "generated_by": { "app": "SimHIT", "version": "2026.5.0" },
  "generated_at_utc": "2026-05-13T08:00:00Z",
  "sensor": {
    "label": "ICM-42688",
    "vendor": "TDK InvenSense",
    "datasheet_url": "https://...",
    "configured_range_dps": 2000,
    "configured_range_g": 16
  },
  "firmware": { "version": "1.2.0", "git_commit": "abc123def" },
  "platform": {
    "mcu": "ESP32-S3",
    "esp32_chip_id": "...",
    "host_os": "Linux 6.5",
    "ambient_temp_c_start": 24.8,
    "ambient_temp_c_end": 25.1
  },
  "sessions": [
    { "id": "...", "type": "static_capture", "csv_sha256": "..." },
    { "id": "...", "type": "synthetic_test", "csv_sha256": "..." }
  ],
  "metrics": {
    "sampling": { "...": "SamplingResult serializado" },
    "allan": { "...": "AllanVarianceResult serializado" },
    "latency": { "...": "opcional, si se ejecutó" },
    "rotational": { "...": "opcional, si se ejecutó" },
    "synthetic": { "...": "opcional, si se ejecutó" }
  },
  "verdict": {
    "passes_arw": true,
    "passes_bias_instability": true,
    "passes_sampling_rate": true,
    "passes_dynamic_range": true,
    "overall": "Pass",
    "notes": [
      "ARW dentro de rango: 0.42 °/√h (criterio < 2 °/√h)",
      "Frecuencia efectiva 199.84 Hz (declarada 200 Hz)"
    ]
  }
}
```

**Reglas del veredicto:**

| Criterio | Pass | Marginal | Fail |
|---|---|---|---|
| ARW (°/√h) | < 2 | 2–4 | > 4 |
| Bias instability (°/h) | < 50 | 50–100 | > 100 |
| Frecuencia efectiva (Hz) | ≥ 198 | 180–198 | < 180 |
| Rango dinámico (°/s) | ≥ 500 | 300–500 | < 300 |
| Latencia end-to-end (ms) | < 50 | 50–100 | > 100 |

`overall = Pass` si todos los criterios cumplen. `Marginal` si al menos uno está en marginal y ninguno en fail. `Fail` si al menos uno está en fail.

---

## 2.6 Componente: flash.rs — flasheo del ESP32 desde la app

Este es el componente nuevo que habilita el flujo de onboarding cero-friction.

**Responsabilidad:** detectar ESP32 conectados, flashear el firmware oficial de SimHIT directamente desde la app, verificar la operación.

**Crate recomendado:** `espflash` v3.x. Es una reimplementación oficial en Rust de `esptool.py`, mantenida por Espressif. Tiene API library además de CLI, perfecta para Tauri.

```toml
[dependencies]
espflash = "3"
```

**Contrato:**

```rust
pub struct FlashConfig {
    pub serial_port: String,
    pub firmware_binary: PathBuf,    // .bin precompilado, embebido en la app
    pub partition_table: PathBuf,
    pub bootloader: PathBuf,
}

pub async fn detect_esp32_ports() -> Result<Vec<DetectedDevice>, FlashError>;

pub async fn flash_firmware(
    config: FlashConfig,
    progress_callback: impl Fn(FlashProgress),
) -> Result<FlashedDeviceInfo, FlashError>;

pub async fn verify_firmware(
    serial_port: String,
) -> Result<FirmwareInfo, FlashError>;
```

**Estrategia de empaquetado de binarios firmware:** decisión recomendada → **firmware único con autodetección del sensor**.

Razones:

1. El usuario no tiene que elegir nada al flashear. Mejor experiencia.
2. Permite intercambiar sensores por zócalo sin reflashear. Aprovecha la arquitectura existente.
3. El binario adicional por incluir los 4 drivers es pequeño (~80 KB combinado). El ESP32-S3 tiene 4–8 MB de flash, sobra.

Al arrancar, el firmware ejecuta `i2c_scan()`. Identifica el sensor por dirección y verificación WHO_AM_I. Activa solo el driver correspondiente. Reporta el sensor detectado en el handshake con la app.

**Tabla de direcciones I2C y WHO_AM_I para autodetección:**

| Sensor | Dirección I2C | Registro WHO_AM_I | Valor esperado |
|---|---|---|---|
| BNO055 | 0x28 o 0x29 | 0x00 | 0xA0 |
| ICM-42688 | 0x68 o 0x69 | 0x75 | 0x47 |
| MPU9250 | 0x68 o 0x69 | 0x75 | 0x71 |
| L3GD20H | 0x6A o 0x6B | 0x0F | 0xD7 |
| LSM303D (mag/accel) | 0x1D o 0x1E | 0x0F | 0x49 |

Importante: ICM-42688 y MPU9250 comparten dirección I2C **y** registro WHO_AM_I. Se distinguen por el valor (0x47 vs 0x71). Hay que probar en orden y discriminar por valor, no por dirección.

**Empaquetado de binarios en la app:** los .bin del firmware se incluyen como assets de Tauri en `src-tauri/binaries/`. La función `flash_firmware` los extrae a un tempfile y los pasa a espflash. Esto evita dependencia de internet.

**Tests de aceptación:**

1. `detect_esp32_ports()` retorna al menos un dispositivo si hay un ESP32 conectado, con su chip type y MAC.
2. Después de un flasheo exitoso, `verify_firmware()` retorna la versión correcta.
3. Si el binario está corrupto, el flasheo falla limpiamente con `FlashError::VerificationFailed`, sin dejar el ESP32 en estado intermedio.
4. El progreso reportado al frontend llega al 100% solo después de la verificación, no después del write.

---

## 2.7 Comandos Tauri expuestos al frontend (cierre)

Lista completa que el frontend Svelte puede invocar:

```rust
// Flash
detect_esp32_ports()
flash_firmware(config)
verify_firmware(port)

// Captura
start_static_capture(config)
stop_capture(session_id)
get_capture_progress(session_id)

// Análisis
analyze_allan_variance(csv_path)
analyze_sampling(csv_path)
run_synthetic_test(config)
analyze_latency_tap(session_dir)

// Perfil
build_sensor_profile(session_dir)
export_profile_json(profile, output_path)
export_profile_pdf(profile, output_path)
compare_against_reference(profile)
```

---

## 2.8 Tests de integración (end-to-end) que el código completo debe pasar

Cuando todos los componentes estén implementados, estos cuatro escenarios validan el módulo completo:

1. **Onboarding de cero:** la app detecta un ESP32 sin firmware, flashea, reinicia, hace handshake, identifica el sensor por I2C scan. Tiempo total < 60 segundos.
2. **Captura estática completa:** 30 minutos de captura con un ICM-42688 producen un perfil con `verdict.overall == "Pass"` y la curva de Allan variance es visualmente coherente con literatura del sensor.
3. **Robustez ante desconexión:** desconectar y reconectar el USB durante la captura no corrompe archivos; la sesión queda marcada como incompleta pero el CSV escrito es parseable.
4. **Reproducibilidad bit a bit del análisis:** ejecutar el análisis dos veces sobre el mismo CSV produce JSON idéntico (excepto timestamps de ejecución). Los hashes calculados coinciden con `sha256sum` de terminal.

---

# Parte 3 — Cómo conecta esto con el manuscrito

Cuando tengas el módulo funcionando, la sección de Methods del paper se reescribe como una descripción del **protocolo embebido**, no como una receta separada. Ejemplo de párrafo modelo para la sección Methods:

> *"All sensor characterization metrics reported in this work were obtained using the open-source characterization module integrated into the SimHIT application. The protocol is deterministic and reproducible by any user of the device. Each characterization session generates a versioned `sensor_profile.json` artifact whose schema is publicly documented (Supplementary Material S1). All raw capture files (CSV) are SHA-256-hashed and the hashes are stored within the profile, ensuring traceability between reported metrics and source data."*

Eso es exactamente el lenguaje que HardwareX premia.
