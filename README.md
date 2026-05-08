# SimHIT — Simulador open source para entrenamiento del Head Impulse Test (vHIT)

**Informe técnico y manual de aplicación · v2026.05**

SimHIT es una plataforma educativa abierta para enseñar y practicar el **Head Impulse Test** asistido por video (vHIT), una prueba clínica clave en otoneurología para evaluar la función del reflejo vestíbulo-ocular (VOR) por canal semicircular. El proyecto integra **hardware de bajo costo, firmware embebido y una aplicación de escritorio multiplataforma** que reproduce el flujo completo del examen (estimulación, captura, análisis e informe) sin requerir un paciente real.

El objetivo no es reemplazar al paciente, sino dar al estudiante un entorno seguro y reproducible para:

1. Aprender la **técnica motora** del impulso cefálico (amplitud, velocidad pico, aceleración, dirección por canal).
2. Reconocer **patrones diagnósticos** (hipofunción uni/bilateral, sacadas correctivas overt/covert, artefactos).
3. Producir un **informe clínico** estructurado y exportable a PDF.

Este documento describe qué hace el sistema, cómo se usa, cómo se replica y cómo se fabrica una unidad propia.

---

## 1. Fundamento clínico

El vHIT explora cada uno de los seis canales semicirculares (laterales LL/RL, anteriores LA/RA, posteriores LP/RP). El examinador imprime un giro cefálico breve, pasivo, de alta aceleración y baja amplitud (≈10–20°, pico 150–250°/s) sobre el plano del canal evaluado, mientras el paciente fija un punto. Una cámara registra la velocidad del ojo y se compara con la velocidad de la cabeza:

- **Ganancia VOR** (`gain = ∫velOjo / ∫velCabeza`):
  - ≥ 0.80 normal
  - 0.60–0.80 reducida
  - < 0.60 severamente reducida
- **Sacadas correctivas**: indican refijación tras un VOR insuficiente. *Overt* (tras el impulso, visibles) y *covert* (durante el impulso, ocultas, sólo visibles con vHIT).

SimHIT modela estos cuatro elementos —ganancia, velocidad pico, sacadas y artefactos— por canal, y los entrega al estudiante como respuesta del "paciente virtual".

---

## 2. Arquitectura del sistema

```
 ┌─────────────────┐     USB-CDC 460800 Bd     ┌──────────────────────┐
 │  Cabezal SimHIT │ ───────────────────────▶  │  App SimHIT (PC)     │
 │  ESP32-C3 +     │   "yaw;pitch;roll;        │  Tauri 2 + SvelteKit │
 │  IMU 9-DoF      │    gyrX;gyrY;gyrZ\n"      │  - Pose en vivo      │
 │  (200 Hz)       │ ◀─────  comandos  ─────── │  - Editor escenarios │
 └─────────────────┘   "IMU ON/OFF/CAL/…"      │  - Captura impulsos  │
                                                │  - Informe + PDF    │
                                                └──────────────────────┘
                                                          │
                                       (modo docente)     │
                                                          ▼
                                                ┌──────────────────────┐
                                                │  Cámara del paciente │
                                                │  (animación de ojo)  │
                                                └──────────────────────┘
```

Tres bloques independientes y desacoplados por interfaces simples:

| Bloque | Tecnología | Función |
|---|---|---|
| **Hardware** | PCB KiCad + ESP32-C3 SuperMini + IMU (L3G4200D gyro + LSM303DLHC accel/mag) | Aporta orientación angular real de la cabeza del estudiante. |
| **Firmware** | Arduino C++, Adafruit AHRS (Madgwick), I²C 100 kHz | Lee IMU a 200 Hz, fusiona, calibra y emite por USB-Serial. |
| **Software** | Tauri 2 + SvelteKit + TypeScript (desktop Linux/Win/Mac) | UI clínica, simulación del paciente virtual, captura, análisis e informe. |

El protocolo serial es ASCII de una línea por muestra, lo que permite reemplazar el cabezal por cualquier IMU equivalente (BNO055, ICM-20948, etc.) manteniendo el mismo flujo. Esto es deliberado: el proyecto migró de BNO055 a L3G+LSM303 sin cambiar la app.

---

## 3. ¿Qué hace SimHIT?

### 3.1 Para el estudiante (modo Pruebas)

1. Conecta el cabezal por USB y pulsa **▶ SimHIT** en la barra superior.
2. Selecciona un **escenario** (caso clínico): la app trae 10 casos predefinidos (normal, hipofunción derecha, bilateral, presbivestibulopatía, neuritis aguda, etc.) más los que cargue el docente.
3. Ejecuta impulsos cefálicos sobre el cabezal montado en su frente. La app:
   - Muestra **pose en vivo** (vistas superior, coronal y lateral) con conos verdes de zona objetivo (±6°).
   - Reproduce la **animación del ojo** del paciente virtual: cuando la respuesta del canal estimulado tiene baja ganancia, aparece la sacada correctiva correspondiente.
   - Da **veredicto inmediato** por impulso (✓ aceptado / ✗ rechazado, con razón) y feedback sonoro.
   - Permite **metrónomo configurable** (BPM + acento) para entrenar ritmo.
4. Al terminar, abre el **Informe**: tabla de ganancias, gráficos por canal, casillas de hallazgos, interpretación clínica, diagnóstico. Exporta a **PDF** mediante diálogo nativo "Guardar como".

### 3.2 Para el docente (modo Docente)

- **Editor de escenarios**: define la respuesta esperada por canal (gain, peakVel, sacada `none|covert|overt|both`, artefactos). El modelo soporta los 6 canales; la UI hoy expone los horizontales (LL/RL).
- **Editor de cámara**: define los frames del ojo en layout estrella (centro + 8 direcciones) más una secuencia lineal de parpadeo. Permite insertar frames intermedios y marcar la pupila.
- **Configuración de mapeo de ejes**: asocia los ejes físicos del IMU con yaw/pitch/roll y con el cuerpo del giroscopio, con persistencia en `localStorage` por equipo.
- Los escenarios y sets de cámara se guardan como JSON en el almacenamiento del webview (`~/.local/share/com.nick.app/` en Linux).

### 3.3 Lo que **no** es SimHIT

- No es un dispositivo médico. No diagnostica pacientes reales.
- No tiene oclusor ni cámara IR sobre el ojo del usuario: el "ojo" es la animación del paciente virtual.
- La validación clínica del aprendizaje requiere un protocolo educativo aparte (no incluido en este repositorio).

---

## 4. Procesamiento de señal

### 4.1 Captura

El firmware muestrea el giroscopio L3G4200D (FS=2000 dps, ~1.22 mrad/s/LSB) y el acelerómetro/magnetómetro LSM303DLHC a 200 Hz. La fusión Madgwick produce yaw/pitch/roll en grados. Por ráfaga USB se envían varias muestras consecutivas; la app las **encola y drena por tick** para evitar el efecto sawtooth observado con `setInterval` puro a 200 Hz.

### 4.2 Detección y métricas del impulso

- Detección actual: ventana fija alrededor del pico de velocidad cefálica.
- Métricas por impulso:
  - Velocidad pico cabeza (°/s) y duración.
  - Ganancia VOR como ratio de áreas bajo `|velOjo|` y `|velCabeza|` durante la ventana.
  - Detección de sacada correctiva sobre la velocidad ocular post-impulso.
- Heurística de aceptación: amplitud, pico y duración dentro de rangos. Pruebas fuera de rango quedan **excluibles** desde el modal de análisis.

### 4.3 Calibración

- **`IMU CAL`**: calcula bias del gyro con el cabezal en reposo y lo persiste en NVS.
- **`MAG CAL`**: rota el cabezal en figura-8; estima hard-iron (offset) y soft-iron (escala por eje).
- **Mapeo de ejes** en la app: corrige orientaciones físicas distintas del IMU sin tocar firmware.

---

## 5. Cómo replicarlo

Replicar SimHIT requiere ensamblar **tres entregables independientes**:

```
hardware/simHIT/    ← PCB en KiCad, esquemático, BOM
firmware/simhit/    ← simhit.ino (Arduino IDE / arduino-cli)
app/                ← Aplicación Tauri 2 (este es el repo principal de software)
```

### 5.1 Lista de materiales (BOM mínima)

| Cant. | Componente | Notas |
|---|---|---|
| 1 | ESP32-C3 SuperMini | USB-C nativo, footprint pequeño |
| 1 | L3G4200D | Giroscopio I²C (`0x69`), 2000 dps |
| 1 | LSM303DLHC | Acelerómetro + magnetómetro I²C |
| 1 | Cable USB-C de datos | Imprescindible que sea de datos, no solo carga |
| — | Conectores I²C, headers, resistencias pull-up 4k7 | Si no usás módulos con pull-ups integrados |
| 1 | Carcasa impresa 3D | Modelo en `hardware/` (versión vigente del PCB) |
| 1 | Banda elástica frontal | Para fijar el cabezal a la frente del estudiante |

PCB v0.1: ver `hardware/simHIT/v0.1.pdf` y archivos KiCad en el mismo directorio. Se puede fabricar en JLCPCB / PCBWay con los Gerber generados por KiCad.

### 5.2 Fabricación de la PCB

1. Abrir el proyecto en **KiCad 7+**: `hardware/simHIT/sinHIT.kicad_pro`.
2. Verificar que el footprint del ESP32-C3 coincide con la variante que comprarás.
3. Generar Gerbers + BOM + Pick&Place.
4. Pedir 5 unidades en cualquier fab. Costo orientativo: USD 5–15 por la PCB sin SMD, USD 20–35 con ensamble.
5. Imprimir la carcasa en PETG o PLA (espesor de pared ≥ 2 mm para soportar el ajuste frontal).

### 5.3 Flasheo del firmware

```bash
# requisitos: Arduino IDE 2.x con board "ESP32C3 Dev Module"
# librerías: Adafruit Sensor, Adafruit LSM303 Accel, Adafruit LSM303DLH Mag, Adafruit AHRS
arduino-cli compile --fqbn esp32:esp32:esp32c3 firmware/simhit
arduino-cli upload  --fqbn esp32:esp32:esp32c3 -p /dev/ttyACM0 firmware/simhit
```

Configuración en Arduino IDE:
- Board: **ESP32C3 Dev Module**
- USB CDC On Boot: **Enabled**
- Upload speed: 921600
- Flash size: 4 MB

Tras el primer flash, conectar y desde la app:
- **Calibrar** (cabezal quieto sobre la mesa, 2 s) → guarda bias del gyro.
- **MAG CAL** (rotar en figura-8, ~20 s) → guarda calibración magnética.

### 5.4 Instalación de la aplicación

**Requisitos**: Node.js 20+, Rust 1.78+, dependencias de Tauri 2 (`webkit2gtk`, etc., según SO).

```bash
git clone <repo>
cd simHit
./simhit.sh install     # npm install
./simhit.sh dev         # desarrollo (Tauri + Vite hot reload)
./simhit.sh build       # binario release
./simhit.sh build:bundle  # + .deb / .rpm / .AppImage en Linux
```

Sin el script:

```bash
cd app
npm install
npm run tauri dev
npm run tauri build
```

El binario queda en `app/src-tauri/target/release/app` (o el bundle correspondiente). El menú interactivo `./simhit.sh` cubre dev, build, release con bump de versión, gestión de datos del webview y limpieza.

### 5.5 Datos persistidos

| Qué | Dónde |
|---|---|
| Escenarios, sets de cámara, mapeo de ejes | `localStorage` del webview Tauri |
| Informes generados | mismo `localStorage`, exportables a PDF |
| Calibración del cabezal | NVS interna del ESP32-C3 (`Preferences`) |

Path por SO:
- Linux: `~/.local/share/com.nick.app/`
- Windows: `%APPDATA%\com.nick.app\`
- macOS: `~/Library/Application Support/com.nick.app/`

---

## 6. Protocolo serial

USB-CDC, 460 800 Bd, 8N1, sin control de flujo.

**Stream de salida** (200 Hz cuando IMU está activo):

```
yaw;pitch;roll;gyrX;gyrY;gyrZ\n
```

Yaw/pitch/roll en grados (continuos, con wrap monotónico ±180°). gyr* en °/s en el sistema del IC.

**Comandos de entrada** (terminados en `\n`):

| Comando | Efecto |
|---|---|
| `IMU ON` / `IMU OFF` | Inicia / detiene streaming. |
| `IMU CAL` | Calcula y guarda bias del gyro (cabezal quieto). |
| `IMU CLR` | Borra calibración del gyro. |
| `IMU STATUS` | Imprime estado (bias, RUNNING/STOPPED). |
| `MAG CAL` | Calibra magnetómetro (rotar 20 s). |
| `MAG CLR` | Borra calibración magnética. |
| `MAG STATUS` | Imprime offsets y escalas magnéticas. |
| `HELLO` | Responde `SIMHIT vX.Y` (descubrimiento). |
| `RESET` | Reinicio del MCU. |

Esta interfaz textual habilita reemplazar el hardware por otro IMU equivalente sin tocar la app.

---

## 7. Estructura del repositorio

```
simHit/
├── README.md          ← este documento
├── ROADMAP.md         ← hitos M0 → M3, estado por feature
├── LICENSE            ← MIT
├── simhit.sh          ← gestor de dev/build/release
├── hardware/simHIT/   ← KiCad: esquemático, PCB, PDF
├── firmware/simhit/   ← simhit.ino (ESP32-C3, IMU)
├── app/               ← aplicación Tauri 2 + SvelteKit
│   ├── src/           ← UI, simulación, informe
│   ├── src-tauri/     ← backend Rust (serial, fs, dialog)
│   └── package.json
├── images/            ← logos para informes
├── python_old/        ← versión legacy en PySide6 (referencia histórica)
└── API/               ← endpoint web auxiliar (opcional)
```

---

## 8. Validación, limitaciones y trabajo futuro

### Validado hoy (M0–M1 del roadmap)

- Streaming estable a 200 Hz con eliminación del *sawtooth* mediante encolado de muestras.
- Pose en vivo con tres vistas anatómicas y conos de zona objetivo.
- 10 escenarios clínicos de referencia, editables.
- Informe vHIT con tabla de ganancias, gráficos, hallazgos, diagnóstico y exportación PDF a archivo (diálogo nativo "Guardar como").
- Feedback sonoro post-impulso y metrónomo de entrenamiento.

### Limitaciones conocidas

- Detección de inicio/fin del impulso por **ventana fija**, no por umbral adaptativo (M1).
- Sin clasificador automático de artefactos (parpadeo, doble pico, etc.).
- UI hoy expone solo canales horizontales (LL/RL); el modelo soporta los seis pero falta detección de plano vertical en cámara.
- Sin estudio de validación educativa publicado (objetivo de la siguiente etapa).

### Próximos hitos

- **M1.5**: consolidación firmware ESP32-C3 + L3G4200D + LSM303DLHC.
- **M2**: detección automática de eventos, clasificador de artefactos, plan de protocolo por canal.
- **M3**: canales verticales, modo multi-estudiante con cuentas, métricas longitudinales de aprendizaje.

Detalle por feature en `ROADMAP.md`.

---

## 9. Cómo contribuir

1. Fork → rama `feature/<nombre>` → PR a `main`.
2. Cambios de firmware: incluir captura del log serial pre/post.
3. Cambios en escenarios clínicos: justificar con literatura o caso clínico de referencia.
4. UI: español neutro (sin rioplatensismos).
5. Antes de subir: `./simhit.sh check` (svelte-check + cargo check).

Issues bienvenidos para reportar bugs, casos clínicos faltantes y mejoras pedagógicas.

---

## 10. Licencia y cita

Código y diseños bajo **Licencia MIT** (ver `LICENSE`). Para usos académicos se solicita citar el proyecto:

> Ávila D., Baier N. *SimHIT: simulador open source para entrenamiento del Head Impulse Test.* Universidad Austral de Chile, 2026.

Contacto: `david.avila@uach.cl`
