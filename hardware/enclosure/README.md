# Carcasa SimHIT

## STL disponibles

| Archivo | Versión | Notas |
|---|---|---|
| `stl/simhit-enclosure-v0.1.stl` | v0.1 | Carcasa en uso actual. Export de OnShape ("Part Studio 1"). Pieza única — falta separar tapa si aplica. |

## Pendiente

- [ ] Subir CAD fuente (OnShape link público o export STEP) a `source/`.
- [ ] Si la carcasa es de dos piezas, separar y exportar `top.stl` y `bottom.stl`.
- [ ] Parámetros de impresión recomendados (PLA/PETG, capa, relleno, soportes).
- [ ] Render fotorrealista o screenshot del modelo.
- [ ] Lista de tornillería e insertos (cruzar con `docs/BOM.md`).

## Parámetros de impresión sugeridos (provisional)

| Parámetro | Valor |
|---|---|
| Material | PLA o PETG |
| Altura de capa | 0.2 mm |
| Relleno | 30 % giroide |
| Perímetros | 3 |
| Soportes | Solo donde haya voladizos > 45° |
| Adhesión | Brim 5 mm |

Ajustar según impresora.
