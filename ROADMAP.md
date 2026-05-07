# Roadmap SimHIT

Hoja de ruta de funcionalidades, agrupadas por hitos. Las fechas son objetivos, no promesas.

---

## Estado actual (M0 — base funcional)

- App Tauri 2 + SvelteKit + TS, layout responsivo con `minWidth` 1280×800.
- Simulador 200 Hz con generador de impulsos y animación realista del ojo.
- Dos canales laterales (LL / RL) cubriendo el plano horizontal.
- Conexión serial real con la placa SimHIT.
- Editor multi-set de ojos / cámara con layout estrella (centro + 8 direcciones cardinales/diagonales) + secuencia lineal de parpadeo. Frames intermedios insertables con `+` entre cualquier par adyacente. Marcado de pupila por frame.
- Editor de escenarios por canal: el docente define la respuesta esperada del paciente virtual por cada canal vHIT (gain, peakVel, sacada, artefactos). Modelo soporta los 6 canales (LL, RL, LA, RP, RA, LP); UI sólo expone los horizontales hasta que la cámara detecte verticales. 10 casos predefinidos + escenarios propios.
- Generación de informes vHIT con export a PDF (vía diálogo de impresión).
- Modal de análisis detallado de impulsos por canal (individual / superpuestas, métricas, exclusión por prueba).
- Layout del simulador y del informe sin scroll, ajustado al alto de ventana.
- Español neutro en toda la UI (sin rioplatensismos).

---

## M1 — Captura asistida y visor en vivo

Objetivo: que el operador pueda ejecutar los impulsos con retroalimentación inmediata, sin depender del clínico experto a su lado.

### Visor de posición de la cabeza en vivo  ✅ (parcial)
- [x] Indicador con yaw / pitch / roll en tiempo real (mock en `simulator.svelte` — `headYaw/Pitch/Roll`).
- [x] Tres vistas anatómicas: superior (yaw), coronal (yaw + roll), lateral (pitch).
- [x] Conos / sectores verdes de zona objetivo (±6° por eje).
- [x] Tag de estado y mensaje correctivo ("gira a la derecha", "sube la cabeza", etc.).
- [x] Tarjeta del último impulso con veredicto ✓ Aceptado / ✗ Rechazado y razones.
- [x] Reemplazar mock por orientación real del firmware (pose desde Madgwick por serial).
- [x] Suavizado por rAF (lerp τ=40 ms) para desacoplar UI del batching del driver USB; elimina escalonado por ráfagas.
- [x] Cola de muestras gyro en `serial.svelte`: `parseLine` empuja a `gyroQueue`, `tickWithSensor` drena el lote completo cada tick. Resuelve el sawtooth en TraceChart e ImpulseChart causado por bursts USB + jitter de `setInterval` (perdían/duplicaban muestras a 200 Hz). Smoothing y captura ahora se aplican por sample real, con timestamp interpolado a 1/FS; si un tick no recibe samples, los buffers no rotan (cero plateau).
- [x] Pose en vivo aún en idle (sin test iniciado) para calibrar mapeo de ejes.
- [x] Vista coronal solo rota con roll (sin distorsión 3D por yaw).
- [ ] Histórico corto tipo osciloscopio del último ~2 s de velocidad cabeza/ojo en el visor (hoy está en TraceChart, separado).

### Configuración de mapeo de ejes  ✅
- [x] Panel ⚙ en HeadLiveView para mapear pose y gyro a ejes físicos del sensor (x/y/z + signo) con persistencia en localStorage.
- [x] Readout en vivo por DOF (yaw/pitch/roll) con barra y valor numérico para verificar visualmente el mapeo correcto sin bloquear el flujo.
- [x] Mapeo independiente para pose (Euler del Madgwick) y gyro (cuerpo del IC), reflejando que son sistemas de coordenadas distintos.

### Validación del impulso en vivo  ⏳
- [x] Heurística básica de aceptación post-impulso (pico, ganancia, duración) → veredicto en `lastVerdict`.
- [x] Feedback sonoro al cerrar la prueba (beep ok / error sintetizados con Web Audio API).
- [x] Metrónomo configurable (BPM + acento) para entrenamiento con ritmo.
- [x] Modal de configuración de sonido (frecuencia, duración, onda, volumen, prueba).
- [ ] Detección automática de inicio / fin por umbral y derivada (no por ventana fija).
- [ ] Clasificador de artefactos (parpadeo, movimiento previo, doble pico, pérdida de tracking).
- [ ] Auto-descarte de pruebas inválidas con opción a recuperar.

### Guía de protocolo  ⏳
- [ ] Plan de captura por canal con contador objetivo (LL: 10/15, RL: 8/15…).
- [ ] Indicador visual del lado a estimular en la próxima prueba (modo aleatorio).
- [ ] Bloqueo / aviso si el operador intenta avanzar sin completar el plan.

---

## M1.5 — Migración firmware: ESP32-C3 + L3G4200D + LSM303DLHC

Objetivo: reemplazar BNO055/ESP12 por combo discreto (gyro L3G4200D + accel/mag LSM303DLHC) sobre ESP32-C3 SuperMini, manteniendo invariante el protocolo serial host↔placa.

### Plataforma
- [x] Migrar build a ESP32-C3 (Arduino-ESP32).
- [x] I2C en GPIO6 (SDA) / GPIO7 (SCL), 400 kHz.
- [x] Sin LEDs ni OLED en esta revisión; láser se añade luego (pin a definir).
- [x] USB-CDC nativo; mantener 460800 nominal.

### Drivers
- [x] L3G4200D con driver inline por registros (I2C 0x69, ±2000 dps, ODR 800 Hz, BW 50 Hz, BDU on, lectura burst con auto-incremento). Detección por `WHO_AM_I` (0xD3) en setup.
- [x] `Adafruit_LSM303_Accel`.
- [x] `Adafruit_LSM303DLH_Mag` con corrección hard/soft-iron aplicada.

### Fusión y orientación
- [x] Madgwick de `Adafruit_AHRS` a 200 Hz con Δt determinista (`micros()`).
- [x] Quaternion → Euler (yaw/pitch/roll) en grados.
- [x] Reset de orientación al recibir `IMU CAL`.

### Calibración
- [x] Gyro: bias en reposo (`IMU CAL`, session-only) con detección de movimiento (rechaza si σ > 3 °/s).
- [x] Magnetómetro: rutina hard/soft-iron (figura-8, comando `MAG CAL`, 15–45 s) con cobertura de los 8 octantes y métrica de calidad (CV de |M|).
- [x] Persistencia en NVS de la calibración del magnetómetro.
- [x] Comandos `IMU CLR`, `IMU STATUS`, `MAG CLR`, `MAG STATUS`.
- [x] UI host: modal de calibración con instrucciones, estado de error y retry; botón "Calibrar" en TopBar.
- [x] UI host: botón "Mag" + modal con guía visual (figura-8 animada, cubo de 8 octantes, 4 poses ilustradas) y log en vivo con copia/descarga.
- [x] Firmware: umbral mínimo de rango (`MAG_OCT_MIN_RANGE` 10 μT) antes de contar octantes para evitar falsos positivos por ruido en reposo.
- [x] Firmware: log enriquecido por segundo con rangos por eje, muestra actual y bounding box completo para diagnóstico remoto.
- [x] **Fallback 6DOF**: este módulo LSM303DLHC tiene el eje Z saturado (>810 μT con gain ±8.1 G), no calibrable. `filter.update` reemplazado por `filter.updateIMU` (gyro+accel only). Bloque 9DOF queda comentado para restaurar al cambiar el módulo. Yaw deriva sin mag; aceptable en tests cortos con `IMU CAL` previo.
- [ ] Calibración del acelerómetro (1 g vertical, one-shot al fabricar/montar).

### Protocolo serial (invariante)
- [x] Salida: `angX;angY;angZ;gyroX;gyroY;gyroZ\n`.
- [x] Comandos host→placa: `IMU ON/OFF/CAL/CLR/STATUS`, `MAG CAL/CLR/STATUS`, `HELLO`, `RESET` (LED/OLED retirados).
- [x] Unidades: ° y °/s.

### Validación
- [ ] Banco rotacional a velocidad conocida; gyro ±5 %.
- [ ] Comparativa de orientación vs BNO055 sobre impulso vHIT.
- [ ] Regresión host: `serial.svelte.ts` parsea sin tocar.
- [x] Subir firmware a hardware real y verificar enumeración USB-CDC del C3 SuperMini.
- [x] Bring-up: gyro responde, accel + mag inicializan, salida CSV correcta.

---

## M2 — Multicanal vertical (canales LARP/RALP)

Objetivo: cubrir los seis canales semicirculares para un examen vHIT clínico completo.

### Modelo de datos  ✅
- [x] Modelo de escenario soporta los 6 canales (`LL, RL, LA, RP, RA, LP`) con config independiente por canal.
- [ ] Extender `ImpulseSnapshot.side` a `Channel` y migrar almacenes (gainLL/RL, countLL/RL → mapas por canal).
- [ ] Migración de informes existentes (campos antiguos opcionales / fallback).

### UI
- [x] Editor docente con tarjetas para los 6 canales (verticales deshabilitadas con tag "próximamente").
- [ ] Habilitar tarjetas verticales en el editor cuando la cámara las soporte.
- [ ] Layout de gráficos en grilla 2×3 (LL/RL, LA/RP, RA/LP) o 3×2 según ancho.
- [ ] Tabs de canal en el modal con etiquetas anatómicas y colores propios por par.
- [ ] Tabla de resultados extendida (6 filas) con ganancia esperada por canal.

### Hardware / firmware
- [ ] Acordar protocolo serial extendido (ya hoy llega LL/RL → llegan 6 canales o equivalente cabeza 3D).
- [ ] Calibración inicial del eje vertical (LARP/RALP requieren posición de cabeza inclinada).
- [ ] Detección de canal activo por dirección de cabeza (yaw/pitch/roll) para disparar el impulso del canal correcto.

---

## M3 — Análisis avanzado de impulsos (cálculo en software)

Premisa: el hardware no entrega métricas finales; el software debe procesar la señal cruda para una experiencia clínica realista.

### Procesado base
- Filtrado pasa-bajos configurable (ej. Butterworth 50 Hz) sobre velocidad de cabeza y de ojo.
- Estimación de velocidad por diferenciación numérica de posición + suavizado.
- Sincronización temporal cabeza-ojo y corrección de latencia del giroscopio.
- Re-muestreo común a 1 kHz para que las métricas sean comparables entre dispositivos.

### Métricas por impulso
- Ganancia instantánea, ganancia por área (gain by area, integral ojo / integral cabeza).
- Ganancia regresiva (slope eye/head sobre la fase aceleratoria).
- Pico de aceleración cefálica (°/s²), pico de velocidad, duración, latencia ojo-cabeza.
- Asimetría intraprueba.

### Detección de sacadas
- Algoritmo de detección automática de sacadas correctivas (umbral velocidad post-impulso + pico).
- Clasificación covert (durante el impulso) vs overt (después).
- Cálculo de PR-score (prevalencia y amplitud) y métricas tipo Halmagyi.

### Métricas agregadas por canal
- Media, mediana, desviación, IC95% de ganancia.
- Detección de outliers (Grubbs / IQR) con sugerencia de exclusión visual.
- Asimetría intercanal (LL vs RL, LA vs RP, etc.).

### Calidad del registro
- Score de calidad por impulso (rango cabeza, ruido base, deriva, pestañeo).
- Marca de artefacto automática (parpadeo, pérdida tracking, doble pico).

---

## M4 — Análisis longitudinal y reporte clínico

- Comparación entre exámenes del mismo paciente (evolución de ganancia por canal).
- Plantillas de informe por diagnóstico con texto sugerido editable.
- Export a CSV / JSON crudo para investigación.
- Anonimización para compartir / docencia.

---

## M5 — Modo docente y evaluación

- [x] Editor por canal (gain, peakVel, sacada, artefactos) reemplaza el editor de flujo de nodos.
- [x] 10 casos clínicos predefinidos (normal bilateral, hipofunciones uni/bilaterales, compensación, artefactos).
- [ ] Banco ampliado de casos clínicos con preguntas y rúbrica.
- [ ] Métricas del estudiante: tiempo, número de impulsos válidos, calidad técnica.
- [ ] Comparación contra el "patrón oro" del caso.
- [ ] Modo examen con tiempo limitado y resultado evaluable.
- [ ] Reemplazar disparo random L/R del modo escenario por trigger desde firmware (movimiento real de cabeza).

---

## Backlog / ideas sueltas

- Modo presentación / pantalla completa para demos clínicas.
- Integración con cámara externa real para tracking ocular alternativo.
- API local para que otras herramientas consuman los registros.
- Internacionalización (es / en / pt) — actualmente solo español neutro.
- Tema oscuro.
- Reemplazar módulo LSM303DLHC actual (eje Z mag dañado) y restaurar fusión 9DOF para eliminar drift de yaw.
- Suavizado opcional configurable por usuario (slider de τ) en TraceChart / ImpulseChart si distintos hardware tienen diferente jitter de batching USB.
