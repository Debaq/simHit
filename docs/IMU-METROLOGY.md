# Caracterización metrológica del IMU — protocolo

> **Estado:** protocolo. Resultados pendientes. Este documento define **qué medir y cómo**, antes de tomar datos, para que la caracterización sea reproducible y defendible científicamente.

## 0. Objetivo

Demostrar que las gafas SimHIT entregan medidas de velocidad angular y orientación con incertidumbre **compatible con la práctica del vHIT clínico** (impulsos cefálicos de 50–300 °/s, duración 100–200 ms, amplitud 10–20°), o caracterizar explícitamente las limitaciones donde no lo sean.

No se trata de competir con un equipo certificado: se trata de **declarar la verdad metrológica** del dispositivo.

## 1. Referencias

- ISO/IEC Guide 98-3 (GUM) — expresión de la incertidumbre.
- IEEE Std 952-2020 — caracterización de IMUs (Allan variance).
- Literatura vHIT: rangos clínicamente relevantes de velocidad pico y ganancia VOR.

## 2. Equipos necesarios

| Equipo | Propósito | Disponibilidad |
|---|---|---|
| Mesa rotatoria con encoder (gold standard) o servo controlado con feedback óptico | Patrón de velocidad angular conocida | _pendiente_ |
| Cabeza maniquí + acoplador rígido al patrón | Réplica del montaje real | _pendiente_ |
| vHIT clínico comercial (Otometrics ICS Impulse / EyeSeeCam / similar) | Comparación cara a cara, mismo voluntario | _pendiente — gestión institucional_ |
| Cronómetro / generador de pulsos externo | Medida de latencia extremo-a-extremo | _disponible_ |
| Cámara de alta velocidad (≥ 240 fps) | Marca temporal externa para latencia | _pendiente_ |

## 3. Ensayos

### 3.1 Ruido en reposo (Allan variance)

- Cabezal **inmóvil**, sobre superficie rígida, 60 s mínimo, ambiente a temperatura estable.
- Capturar tramas serial a 200 Hz.
- Calcular Allan deviation para gyro X/Y/Z. Reportar:
  - **Angle Random Walk (ARW)** en °/√h.
  - **Bias Instability** en °/h.
- Aceptación: ARW del L3G4200D según datasheet ~0.03 °/√s. Documentar valor real medido.

### 3.2 Bias y deriva

- Antes y después de `IMU CAL`.
- Cabezal quieto 5 min. Media de gyro en cada eje.
- Repetir tras 30 min de uso continuo (efecto temperatura).
- Aceptación: deriva post-calibración < 1 °/s en reposo.

### 3.3 Linealidad y rango

- Mesa rotatoria a velocidades fijas: 50, 100, 150, 200, 250, 300 °/s. Cada una 10 s.
- Regresión lineal medido vs. nominal. Reportar:
  - Pendiente (idealmente 1.00).
  - R².
  - Error máximo en el rango clínico.

### 3.4 Latencia extremo-a-extremo

- Generar un pulso eléctrico/visual sincronizado con un golpe brusco al cabezal.
- Medir Δt entre el evento físico y la marca temporal correspondiente en la app.
- Repetir N ≥ 30. Reportar mediana e IQR.
- Crítico para vHIT: la ventana de impulso es ~150 ms; una latencia > 30 ms degrada la ganancia calculada.

### 3.5 Repetibilidad inter-equipo

- ≥ 2 unidades SimHIT.
- Mismo voluntario, misma sesión, mismo gesto, alternar gafas cada 10 impulsos.
- Comparar:
  - Distribución de velocidad pico.
  - Curva yaw vs. tiempo (superposición).
- Bland-Altman entre unidades.

### 3.6 Comparación contra vHIT clínico (opcional pero ideal)

- Voluntario sano. Día único.
- Set de 20 impulsos por lado con vHIT comercial.
- Set equivalente con SimHIT inmediatamente después.
- Comparar:
  - Velocidad pico cabeza (debería coincidir, ambos miden lo mismo).
  - Ganancia VOR — **no comparable** (SimHIT no mide el ojo del voluntario), reportar solo cabeza.

## 4. Especificaciones declaradas (tabla a completar)

| Parámetro | Valor medido | Unidad | Método |
|---|---|---|---|
| Tasa de muestreo | 200 | Hz | Configuración firmware |
| Rango gyro | ±2000 | °/s | FS configurado L3G4200D |
| Sensibilidad gyro | 70 | mdps/LSB | Datasheet, verificable |
| ARW gyro (post-cal) | _pendiente_ | °/√s | Allan variance |
| Bias instability gyro | _pendiente_ | °/h | Allan variance |
| Deriva yaw en reposo 5 min | _pendiente_ | °/s | Ensayo 3.2 |
| Linealidad 50–300 °/s, R² | _pendiente_ | — | Ensayo 3.3 |
| Latencia extremo-a-extremo | _pendiente_ | ms | Ensayo 3.4 |
| Variabilidad inter-equipo (pico) | _pendiente_ | % | Ensayo 3.5 |

## 5. Entregables

- `docs/metrology/protocol.md` — este archivo, versionado.
- `docs/metrology/raw/` — capturas crudas de cada ensayo (CSV).
- `docs/metrology/figures/` — Allan variance, regresiones, Bland-Altman.
- `docs/metrology/report.pdf` — informe firmado por el responsable metrológico, con conclusión: "apto / no apto / apto con observaciones para uso pedagógico vHIT".

## 6. Declaración de uso

SimHIT está pensado **para entrenamiento**. La caracterización metrológica establece **trazabilidad y reproducibilidad**, no aprobación regulatoria. Cualquier uso clínico está fuera del alcance previsto.
