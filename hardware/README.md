# Hardware — gafas SimHIT

## Estructura

```
hardware/
├── simHIT/                  # PCB (KiCad 8+)
│   ├── sinHIT.kicad_pro
│   ├── sinHIT.kicad_sch
│   ├── sinHIT.kicad_pcb
│   ├── sinHIT.kicad_prl
│   ├── v0.1.pdf             # esquemático exportado, revisión 0.1
│   ├── sinHIT-backups/      # snapshots automáticos KiCad
│   ├── fabrication/         # ← pendiente: gerbers, drill, P&P, BoM KiCad
│   └── renders/             # ← pendiente: PNG 3D top/bot
└── enclosure/               # ← pendiente
    ├── source/              # CAD fuente (FreeCAD / F360 / OnShape)
    └── stl/                 # STL listos para imprimir
```

## Estado actual

| Item | Estado |
|---|---|
| Esquemático (KiCad source) | ✅ |
| PCB layout (KiCad source) | ✅ |
| Esquemático PDF | ✅ (`v0.1.pdf`) |
| Gerbers para fabricación | ❌ pendiente — ver TODO §3 |
| Drill files | ❌ pendiente |
| BoM exportado de KiCad | ❌ pendiente |
| Render 3D | ❌ pendiente |
| Carcasa CAD fuente | ❌ pendiente |
| Carcasa STL | ❌ pendiente |

## Generar Gerbers (KiCad CLI ≥ 8)

```bash
mkdir -p hardware/simHIT/fabrication/gerbers
kicad-cli pcb export gerbers hardware/simHIT/sinHIT.kicad_pcb \
    -o hardware/simHIT/fabrication/gerbers/ \
    --layers F.Cu,B.Cu,F.Mask,B.Mask,F.Silkscreen,B.Silkscreen,Edge.Cuts \
    --no-protel-ext
kicad-cli pcb export drill hardware/simHIT/sinHIT.kicad_pcb \
    -o hardware/simHIT/fabrication/gerbers/ \
    --format excellon --excellon-units mm
```

Pick & Place para PCBA (JLCPCB / PCBWay):

```bash
kicad-cli pcb export pos hardware/simHIT/sinHIT.kicad_pcb \
    -o hardware/simHIT/fabrication/positions.csv \
    --format csv --units mm
```

BoM desde KiCad (Eeschema):

```bash
kicad-cli sch export bom hardware/simHIT/sinHIT.kicad_sch \
    -o hardware/simHIT/fabrication/bom-kicad.csv
```

## Licencia hardware

CERN-OHL-S v2 propuesta (a confirmar). Hasta que se declare formalmente, los archivos PCB siguen la MIT del repo.
