# Dataset de ejemplo — especificación

> **Estado:** especificación. Sesiones reales pendientes (mínimo 5).

## 1. Objetivo

Acompañar el repositorio con un conjunto mínimo de sesiones reales para que un tercero pueda:

- Validar el parser serial sin tener el hardware en mano.
- Reproducir gráficos y métricas de la app sobre datos conocidos.
- Comparar su propia implementación contra una referencia.

## 2. Estructura de carpetas

```
datasets/
├── README.md                    # licencia, anonimización, citation
├── 001-normal/
│   ├── session.meta.json        # voluntario anónimo, fecha, equipo, firmware ver, app ver
│   ├── case.json                # caso clínico cargado (export desde la app)
│   ├── raw.serial.log           # traza serial cruda, 200 Hz
│   ├── impulses.csv             # impulsos detectados, una fila por impulso
│   ├── report.pdf               # informe exportado desde la app
│   └── notes.md                 # observaciones del operador
├── 002-hipofuncion-derecha/
├── 003-sacadas-covert/
├── 004-artefactos/
└── 005-plano-vertical-LARP/
```

## 3. Sesiones mínimas (≥ 5)

| # | Etiqueta | Descripción | Notas |
|---|---|---|---|
| 001 | normal | Sano, ganancia esperada ≥ 0.8 en todos los canales horizontales evaluados. | Línea base. |
| 002 | hipofuncion-derecha | Caso programado con ganancia 0.4 lado derecho. | El "paciente" sigue siendo sano físicamente; la patología la simula el software. |
| 003 | sacadas-covert | Caso con sacadas covert puras lado izquierdo. | Útil para entrenar detección visual. |
| 004 | artefactos | Sesión con impulsos rechazados deliberados (lentos, amplios, anticipados). | Muestra el comportamiento del validador. |
| 005 | plano-vertical-LARP | Impulsos en plano LARP (cabeza girada 45° a la izquierda). | Cuando el soporte vertical esté terminado. |

## 4. Formato de cada archivo

### `session.meta.json`

```json
{
  "session_id": "001",
  "label": "normal",
  "date_iso": "2026-05-15",
  "operator_role": "estudiante",
  "subject_anonymized_id": "VOL-001",
  "subject_sex": "M",
  "subject_age_range": "20-30",
  "device_serial": "SIMHIT-002",
  "firmware_version": "git:abcd1234",
  "app_version": "v2026.5.0",
  "consent_signed": true,
  "consent_path": "consent/VOL-001.signed.pdf"
}
```

> **`consent/` no se sube al repo público.** Se mantiene fuera del control de versiones (ver `.gitignore`). El campo queda como marca de auditoría.

### `raw.serial.log`

Una línea por trama, formato firmware:

```
angX;angY;angZ;gyroX;gyroY;gyroZ;angAccX;angAccY;angAccZ;linAccX;linAccY;linAccZ;tsMs;crc
```

Detalle en [`SERIAL-PROTOCOL.md`](SERIAL-PROTOCOL.md).

### `impulses.csv`

```csv
idx,t_start_ms,t_peak_ms,t_end_ms,channel,peak_dps,amplitude_deg,duration_ms,accepted,reject_reason
1,1234,1278,1383,LL,212.4,14.6,149,true,
2,2105,2148,2255,RL,198.7,13.9,150,true,
3,3001,3050,3140,LL,82.3,6.1,139,false,velocidad_baja
```

### `case.json`

Export directo desde la app (Editor de casos). Estructura definida por el motor de simulación; debe poder reimportarse sin modificación.

### `report.pdf`

PDF exportado desde la app. No editar a mano.

## 5. Anonimización

Antes de subir cualquier sesión:

- [ ] Sin nombres en `notes.md`, `session.meta.json` ni en metadatos del PDF.
- [ ] Sin fotos del voluntario.
- [ ] `device_serial` no debe ser un identificador rastreable (usar etiquetas internas tipo `SIMHIT-001`, `SIMHIT-002`).
- [ ] `consent/*.pdf` **excluido** del repo (`.gitignore`).

## 6. Licencia

**CC-BY-4.0** propuesta para el dataset (separada de la MIT del código). Debe constar en `datasets/README.md` y en cada `session.meta.json`.

## 7. Cómo añadir una sesión

1. Ejecutar la sesión en la app y exportar el PDF.
2. Capturar el log serial crudo en paralelo (el `simhit.sh` puede hacerlo si se le pasa `--log`).
3. Exportar el caso clínico desde el editor.
4. Crear la carpeta `datasets/NNN-etiqueta/` con la estructura del punto 2.
5. Llenar `notes.md` con observaciones que no estén ya en el PDF.
6. Verificar anonimización (sección 5).
7. Commit + push con mensaje `data(session): añadir sesión NNN — <etiqueta>`.

## 8. Citation del dataset

A definir cuando se publique. Provisional:

> Baier-Quezada N. et al. *SimHIT example dataset* (v0.1). Universidad Austral de Chile, 2026. https://doi.org/10.5281/zenodo.XXXXXXX
