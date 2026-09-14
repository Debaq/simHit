# TODO — SimHIT release pública

Estado de los entregables necesarios para que el repo sea **replicable, citable y científicamente defendible**. Marcar `[x]` al terminar.

Leyenda:
- 🔴 crítico (bloquea uso/validación)
- 🟡 importante (replicabilidad)
- 🟢 deseable (difusión)

---

## 🔴 1. Caracterización metrológica del IMU

Es el punto que define si SimHIT puede llamarse simulador con datos comparables a un vHIT clínico. Sin esto, no hay defensa científica.

- [ ] Protocolo escrito (qué se mide, con qué patrón de referencia, criterio de aceptación). Plantilla en `docs/IMU-METROLOGY.md`.
- [ ] Banco de medida: gafas SimHIT montadas sobre mesa rotatoria o cabeza maniquí con encoder/gold-standard.
- [ ] **Ruido del giroscopio en reposo** (Allan variance o desviación a 200 Hz, 60 s).
- [ ] **Bias y drift** del giroscopio antes y después de `IMU CAL`.
- [ ] **Linealidad** a velocidades pico realistas del vHIT (50–300 °/s).
- [ ] **Latencia extremo-a-extremo** (sensor → USB → app), medida con marca temporal.
- [ ] **Repetibilidad inter-equipo**: ≥2 unidades, mismo ensayo, comparar curvas.
- [ ] **Comparación contra vHIT clínico** (si se consigue acceso a equipo comercial): impulsos pareados sobre el mismo voluntario, mismo día, curvas superpuestas.
- [ ] Informe metrológico (PDF) en `docs/metrology/` con figuras y datos crudos.
- [ ] Tabla resumen de especificaciones (rango, ruido, latencia, deriva) al final del informe.

## 🔴 2. BoM con precios y links

- [x] Plantilla `docs/BOM.md` creada con componentes inferidos del firmware.
- [ ] **Completar precios** (USD y CLP) en proveedores reales: Mouser, DigiKey, AliExpress, LCSC, locales.
- [ ] Confirmar **footprints y encapsulados** contra el PCB de KiCad.
- [ ] Añadir **alternativas funcionalmente equivalentes** (IMU sustituto, ESP32 sustituto).
- [ ] Validar links (cada uno debe abrir).
- [ ] Costo total estimado por unidad — figura visible.

## 🔴 3. Archivos PCB — Gerbers

- [x] Fuente KiCad presente: `hardware/simHIT/sinHIT.kicad_*`.
- [ ] Exportar **Gerbers** (capa cobre top/bot, mask, silk, drill, edge cuts) a `hardware/simHIT/fabrication/gerbers/`.
- [ ] Exportar **drill files** (.drl).
- [ ] Exportar **Pick & Place** (.pos) si va a montar JLCPCB/PCBA.
- [ ] Exportar **BoM de KiCad** (CSV) cruzado con `docs/BOM.md`.
- [ ] Render 3D (PNG) del PCB top y bottom — `hardware/simHIT/renders/`.
- [ ] Verificar DRC sin errores antes del export.

Comando sugerido (KiCad 8+):
```bash
kicad-cli pcb export gerbers hardware/simHIT/sinHIT.kicad_pcb \
    -o hardware/simHIT/fabrication/gerbers/
kicad-cli pcb export drill   hardware/simHIT/sinHIT.kicad_pcb \
    -o hardware/simHIT/fabrication/gerbers/
```

## 🔴 4. STL de carcasa

- [x] STL v0.1 subido: `hardware/enclosure/stl/simhit-enclosure-v0.1.stl` (OnShape export).
- [ ] Modelo CAD fuente (OnShape link público o STEP) en `hardware/enclosure/source/`.
- [ ] Separar en piezas si la carcasa es multi-parte (top/bottom/anclaje cinta).
- [ ] Parámetros de impresión recomendados (material, altura de capa, relleno, soportes) — provisorios ya en `hardware/enclosure/README.md`.
- [ ] Tornillería: lista en BoM (M2/M3, largo, tipo).
- [ ] Render del ensamble final.

## 🔴 5. Build guide paso a paso

- [x] Plantilla `docs/BUILD.md` creada.
- [ ] Foto/render por cada paso de montaje (PCB → soldadura → carcasa → ajuste → flasheo firmware).
- [ ] Procedimiento de **flasheo del firmware** (esptool / Arduino IDE — pin BOOT, baud, puerto).
- [ ] **Calibración inicial obligatoria** (gyro + magnetómetro) explicada con foto del gesto.
- [ ] Checklist de **verificación funcional** (test serial `HELLO`, lectura yaw/pitch/roll en reposo, encendido del láser).
- [ ] Troubleshooting de errores comunes (no detecta IMU, magnetómetro saturado, ruido eléctrico del USB).

## 🟡 6. Dataset de ejemplo (≥5 sesiones)

- [x] Plantilla `docs/DATASETS.md` con formato y licencia.
- [ ] Capturar **≥5 sesiones reales** con consentimiento del voluntario:
  - [ ] 1 normal (sano).
  - [ ] 1 simulando hipofunción derecha (ganancia <1 inducida por software o paciente real con patología documentada y permiso).
  - [ ] 1 con sacadas covert programadas.
  - [ ] 1 con artefactos típicos (anticipación, doble pico).
  - [ ] 1 plano vertical (LARP o RALP).
- [ ] Exportar a `datasets/` cada una con: traza serial cruda, JSON del caso, informe PDF, README de la sesión.
- [ ] **Anonimizar** (sin nombres, sin metadatos identificables).
- [ ] Licencia explícita del dataset (CC-BY-4.0 recomendado).
- [ ] Esquema de archivos documentado y estable (versionado).

## 🟢 7. Video demostración (3–5 min)

- [ ] Guión: problema → gafas → app modo práctica → app modo simulación → informe.
- [ ] Grabación: cámara fija + screen capture sincronizado.
- [ ] Subtítulos ES + EN.
- [ ] Subir a YouTube (no listado primero) + Zenodo (archivo permanente).
- [ ] Enlace en README sección "Demostración".
- [ ] Versión corta 30 s para redes.

## 🟡 8. Documentación pendiente en `/docs`

- [x] `docs/BOM.md` — esqueleto.
- [x] `docs/BUILD.md` — esqueleto.
- [x] `docs/IMU-METROLOGY.md` — esqueleto.
- [x] `docs/DATASETS.md` — esqueleto.
- [x] `docs/SERIAL-PROTOCOL.md` — extraído del firmware.
- [x] `docs/INDEX.md` — índice navegable.
- [ ] `docs/CALIBRATION.md` — procedimiento detallado de calibración del usuario final.
- [ ] `docs/TESTING.md` — tests automáticos del proyecto (qué corre, cómo).
- [ ] `docs/CHANGELOG.md` — historial (puede generarse de `git log` por release).

## 🟢 9. Difusión / artículo

- [ ] Paper corto (JOSS / Hardware X / similar) describiendo el equipo.
- [ ] Póster congreso ORL chileno / latinoamericano.
- [ ] Charla técnica grabada.

---

## Orden sugerido de ejecución

1. **PCB Gerbers** (no requiere medir nada — solo abrir KiCad y exportar). Habilita que un tercero fabrique.
2. **BoM con precios** (requiere cotizar en proveedores reales).
3. **STL carcasa** (necesita CAD existente — ¿hay archivo fuente? si no, modelar).
4. **Build guide** (con fotos del montaje real ya hecho).
5. **Caracterización metrológica** (el más largo: necesita banco de medida).
6. **Dataset** (con voluntarios, consentimiento).
7. **Video** (al final, cuando todo lo demás esté pulido).
