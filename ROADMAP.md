# Roadmap SimHIT

Hoja de ruta de funcionalidades, agrupadas por hitos. Las fechas son objetivos, no promesas.

---

## Estado actual (M0 — base funcional)

- App Tauri 2 + SvelteKit + TS, layout responsivo con `minWidth` 1280×800.
- Simulador 200 Hz con generador de impulsos y animación realista del ojo.
- Dos canales laterales (LL / RL) cubriendo el plano horizontal.
- Conexión serial real con la placa SimHIT.
- Editor multi-set de ojos / cámara con layout estrella (centro + 8 direcciones cardinales/diagonales) + secuencia lineal de parpadeo. Frames intermedios insertables con `+` entre cualquier par adyacente. Marcado de pupila por frame.
- Editor de escenarios (biblioteca + casos predefinidos).
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
- [ ] Reemplazar mock por orientación real del firmware (cuando llegue por serial).
- [ ] Histórico corto tipo osciloscopio del último ~2 s de velocidad cabeza/ojo en el visor (hoy está en TraceChart, separado).

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

## M2 — Multicanal vertical (canales LARP/RALP)

Objetivo: cubrir los seis canales semicirculares para un examen vHIT clínico completo.

### Modelo de datos
- Extender `Side = 'LL' | 'RL'` a 6 canales: `LL, RL, LA, RA, LP, RP`.
- Refactor de `ImpulseSnapshot.side` y de los almacenes (gainXX, countXX → mapas por canal).
- Migración de informes existentes (campos antiguos opcionales / fallback).

### UI
- Layout de gráficos en grilla 2×3 (LL/RL, LA/RA, LP/RP) o 3×2 según ancho.
- Tabs de canal en el modal con etiquetas anatómicas y colores propios por par.
- Tabla de resultados extendida (6 filas) con ganancia esperada por canal.

### Hardware / firmware
- Acordar protocolo serial extendido (ya hoy llega LL/RL → llegan 6 canales o equivalente cabeza 3D).
- Calibración inicial del eje vertical (LARP/RALP requieren posición de cabeza inclinada).

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

- Banco ampliado de casos clínicos con preguntas y rúbrica.
- Métricas del estudiante: tiempo, número de impulsos válidos, calidad técnica.
- Comparación contra el "patrón oro" del caso.
- Modo examen con tiempo limitado y resultado evaluable.

---

## Backlog / ideas sueltas

- Modo presentación / pantalla completa para demos clínicas.
- Integración con cámara externa real para tracking ocular alternativo.
- API local para que otras herramientas consuman los registros.
- Internacionalización (es / en / pt) — actualmente solo español neutro.
- Tema oscuro.
