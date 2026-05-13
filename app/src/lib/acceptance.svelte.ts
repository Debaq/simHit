// Configuración de aceptación de impulsos y zona objetivo de pose.
// El docente ajusta los rangos para adaptar la sensibilidad del simulador
// al nivel del estudiante.
//
// Persistencia: localStorage (datos chicos, lectura síncrona en HeadLiveView
// y evaluateImpulse).
//
// Cuatro niveles alineados con literatura vHIT:
//   - inicial   ("Aprendiendo el gesto") — no clínico, solo práctica.
//   - basico    ("Novato")               — no clínico, práctica y examen formativo.
//   - estandar  ("Usable")               — clínico.
//   - avanzado  ("Experto")              — clínico.
//
// Rangos H vs V: pico, amplitud, duración y aceleración se separan en variantes
// horizontales (canales LL/RL) y verticales (LA/LP/RA/RP) porque los planos
// verticales toleran otros umbrales. Aceleración es opcional (`null` = ignorar).
//
// Nota: la ganancia VOR (peak_ojo/peak_cabeza) NO se chequea como criterio
// de aceptación. Es el resultado clínico medido del impulso: filtrarla
// rechazaría como "inválidos" hallazgos patológicos legítimos (hipofunción).
// El gain sigue exponiéndose como métrica en informes y revisor de impulsos.

export interface AcceptanceCfg {
  /** Amplitud angular máxima permitida del impulso (°). Define la zona verde
   *  del HeadLiveView: la cabeza no debe excederla durante el hit. */
  yawTol: number;
  pitchTol: number;
  rollTol: number;
  /** Amplitud mínima horizontal (°). Por debajo se considera impulso ineficaz. */
  ampMinH: number;
  /** Amplitud mínima vertical (°). */
  ampMinV: number;
  /** Velocidad pico de cabeza aceptable (°/s) — canales horizontales. */
  peakMinH: number;
  peakMaxH: number;
  /** Velocidad pico de cabeza aceptable (°/s) — canales verticales. */
  peakMinV: number;
  peakMaxV: number;
  /** Duración del impulso (ms) — horizontales. */
  durMinMsH: number;
  durMaxMsH: number;
  /** Duración del impulso (ms) — verticales. */
  durMinMsV: number;
  durMaxMsV: number;
  /** Aceleración pico aceptable (°/s²). `null` = ignorar este detector
   *  (útil para el nivel inicial). */
  accelMinH: number | null;
  accelMaxH: number | null;
  accelMinV: number | null;
  accelMaxV: number | null;
  /** Tolerancia de pose inicial respecto al objetivo del canal (°). */
  poseTolDeg: number;
  // Alias legado (sin sufijo): siempre reflejan los valores horizontales.
  // Existen para que la UI docente actual (que aún no distingue H/V) siga
  // operando sin cambios y para componentes como TraceReview/TraceChart.
  /** @deprecated alias de peakMinH — se sincroniza con H. */
  peakMin: number;
  /** @deprecated alias de peakMaxH. */
  peakMax: number;
  /** @deprecated alias de durMinMsH. */
  durMinMs: number;
  /** @deprecated alias de durMaxMsH. */
  durMaxMs: number;
}

/** Mantiene los alias legados (sin sufijo) en sync con los campos *H. */
function withLegacyAliases<T extends Partial<AcceptanceCfg>>(p: T): T {
  const out: any = { ...p };
  if (out.peakMinH !== undefined) out.peakMin = out.peakMinH;
  if (out.peakMaxH !== undefined) out.peakMax = out.peakMaxH;
  if (out.durMinMsH !== undefined) out.durMinMs = out.durMinMsH;
  if (out.durMaxMsH !== undefined) out.durMaxMs = out.durMaxMsH;
  return out as T;
}

/** Convierte un patch legado (peakMin, etc.) en sus equivalentes *H,
 *  preservando el comportamiento de la UI docente actual.
 *  Campos legacy de ganancia (gainMin/gainMax) se descartan silenciosamente:
 *  el chequeo de ganancia se eliminó del modelo de aceptación. */
function migratePatchLegacy(patch: Partial<AcceptanceCfg> & { name?: string; gainMin?: number; gainMax?: number }):
  Partial<AcceptanceCfg> & { name?: string } {
  const out: any = { ...patch };
  if ('peakMin' in patch && out.peakMinH === undefined) out.peakMinH = (patch as any).peakMin;
  if ('peakMax' in patch && out.peakMaxH === undefined) out.peakMaxH = (patch as any).peakMax;
  if ('durMinMs' in patch && out.durMinMsH === undefined) out.durMinMsH = (patch as any).durMinMs;
  if ('durMaxMs' in patch && out.durMaxMsH === undefined) out.durMaxMsH = (patch as any).durMaxMs;
  // Descartar cualquier campo de ganancia que pueda venir de patches legados.
  delete out.gainMin;
  delete out.gainMax;
  delete out.gainMinH;
  delete out.gainMaxH;
  delete out.gainMinV;
  delete out.gainMaxV;
  return out;
}

export interface AcceptancePreset extends AcceptanceCfg {
  id: string;
  name: string;
  builtin: boolean;
  /** Si false, el preset NO se debe ofrecer como nivel de examen clínico.
   *  Solo aparece en modo práctica (formativo). */
  clinicallyValid: boolean;
}

function makeBuiltin(p: AcceptancePreset): AcceptancePreset {
  return withLegacyAliases(p);
}

const BUILTIN: AcceptancePreset[] = [
  // Nivel 1 — Inicial ("Aprendiendo el gesto"). Tolerancias muy amplias,
  // sin chequeo de aceleración. Solo para práctica formativa inicial.
  makeBuiltin({
    id: 'inicial',
    name: 'Inicial — Aprendiendo el gesto',
    builtin: true,
    clinicallyValid: false,
    yawTol: 30, pitchTol: 25, rollTol: 20,
    ampMinH: 3, ampMinV: 2,
    peakMinH: 40,  peakMaxH: 300,
    peakMinV: 25,  peakMaxV: 200,
    durMinMsH: 80, durMaxMsH: 500,
    durMinMsV: 80, durMaxMsV: 500,
    accelMinH: null, accelMaxH: null,
    accelMinV: null, accelMaxV: null,
    poseTolDeg: 20,
    peakMin: 0, peakMax: 0, durMinMs: 0, durMaxMs: 0,
  }),
  // Nivel 2 — Básico ("Novato"). Rangos amplios pero ya con aceleración.
  // No es clínicamente válido todavía: sirve para examen formativo.
  makeBuiltin({
    id: 'basico',
    name: 'Básico — Novato',
    builtin: true,
    clinicallyValid: false,
    yawTol: 8, pitchTol: 7, rollTol: 15,
    ampMinH: 5, ampMinV: 3,
    peakMinH: 80,  peakMaxH: 149,
    peakMinV: 40,  peakMaxV: 79,
    durMinMsH: 220, durMaxMsH: 350,
    durMinMsV: 220, durMaxMsV: 350,
    accelMinH: 750,  accelMaxH: 1999,
    accelMinV: 500,  accelMaxV: 1499,
    poseTolDeg: 15,
    peakMin: 0, peakMax: 0, durMinMs: 0, durMaxMs: 0,
  }),
  // Nivel 3 — Estándar ("Usable"). Primer nivel clínicamente válido.
  // Valores alineados con literatura vHIT clínica.
  makeBuiltin({
    id: 'estandar',
    name: 'Estándar — Usable',
    builtin: true,
    clinicallyValid: true,
    yawTol: 15, pitchTol: 14, rollTol: 10,
    ampMinH: 10, ampMinV: 8,
    peakMinH: 150, peakMaxH: 249,
    peakMinV: 80,  peakMaxV: 149,
    durMinMsH: 150, durMaxMsH: 220,
    durMinMsV: 150, durMaxMsV: 220,
    accelMinH: 2000, accelMaxH: 3499,
    accelMinV: 1500, accelMaxV: 3499,
    poseTolDeg: 10,
    peakMin: 0, peakMax: 0, durMinMs: 0, durMaxMs: 0,
  }),
  // Nivel 4 — Avanzado ("Experto"). Rangos exigentes, tolerancia mínima.
  makeBuiltin({
    id: 'avanzado',
    name: 'Avanzado — Experto',
    builtin: true,
    clinicallyValid: true,
    yawTol: 20, pitchTol: 20, rollTol: 5,
    ampMinH: 15, ampMinV: 15,
    peakMinH: 250, peakMaxH: 400,
    peakMinV: 150, peakMaxV: 250,
    durMinMsH: 100, durMaxMsH: 180,
    durMinMsV: 100, durMaxMsV: 180,
    accelMinH: 3500, accelMaxH: 5000,
    accelMinV: 3500, accelMaxV: 5000,
    poseTolDeg: 5,
    peakMin: 0, peakMax: 0, durMinMs: 0, durMaxMs: 0,
  }),
];

const LS_PRESETS = 'simhit:acceptance:presets';
const LS_ACTIVE = 'simhit:acceptance:active';

/** Normaliza un preset legado: conserva sólo los campos del schema actual.
 *  Si vienen los campos sin sufijo (peakMin/peakMax/etc.), se duplican como
 *  *H y *V para mantener compatibilidad con presets creados antes de F0.
 *  Campos antiguos de ganancia (gainMin, gainMax, gainMinH/V, gainMaxH/V)
 *  se ignoran silenciosamente: el chequeo de ganancia se eliminó.
 *
 *  Campos nuevos (ampMin*, accel*, poseTolDeg, clinicallyValid) se completan
 *  con defaults razonables cuando el preset legacy no los trae. */
function sanitizePreset(p: any): AcceptancePreset | null {
  if (!p || typeof p !== 'object' || !p.id || p.builtin) return null;
  // Migración legado → H/V: si no existe *H, leer del campo sin sufijo.
  const peakMinH = p.peakMinH ?? p.peakMin;
  const peakMaxH = p.peakMaxH ?? p.peakMax;
  const peakMinV = p.peakMinV ?? p.peakMin;
  const peakMaxV = p.peakMaxV ?? p.peakMax;
  const durMinMsH = p.durMinMsH ?? p.durMinMs;
  const durMaxMsH = p.durMaxMsH ?? p.durMaxMs;
  const durMinMsV = p.durMinMsV ?? p.durMinMs;
  const durMaxMsV = p.durMaxMsV ?? p.durMaxMs;
  // Campos nuevos con defaults compatibles con el comportamiento previo.
  const ampMinH = typeof p.ampMinH === 'number' ? p.ampMinH : 0;
  const ampMinV = typeof p.ampMinV === 'number' ? p.ampMinV : 0;
  const accelMinH = numOrNull(p.accelMinH);
  const accelMaxH = numOrNull(p.accelMaxH);
  const accelMinV = numOrNull(p.accelMinV);
  const accelMaxV = numOrNull(p.accelMaxV);
  const poseTolDeg = typeof p.poseTolDeg === 'number' ? p.poseTolDeg : 15;
  // Presets custom legacy se consideran clínicamente válidos por defecto
  // (el docente los creó intencionalmente). Si el preset trae el flag, se
  // respeta.
  const clinicallyValid = typeof p.clinicallyValid === 'boolean' ? p.clinicallyValid : true;
  return withLegacyAliases({
    id: String(p.id),
    name: String(p.name ?? 'Sin nombre'),
    builtin: false,
    clinicallyValid,
    yawTol: Number(p.yawTol),
    pitchTol: Number(p.pitchTol),
    rollTol: Number(p.rollTol),
    ampMinH: Number(ampMinH),
    ampMinV: Number(ampMinV),
    peakMinH: Number(peakMinH),
    peakMaxH: Number(peakMaxH),
    peakMinV: Number(peakMinV),
    peakMaxV: Number(peakMaxV),
    durMinMsH: Number(durMinMsH),
    durMaxMsH: Number(durMaxMsH),
    durMinMsV: Number(durMinMsV),
    durMaxMsV: Number(durMaxMsV),
    accelMinH, accelMaxH,
    accelMinV, accelMaxV,
    poseTolDeg: Number(poseTolDeg),
    // Aliases legados — los completa withLegacyAliases.
    peakMin: 0, peakMax: 0, durMinMs: 0, durMaxMs: 0,
  });
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function loadCustom(): AcceptancePreset[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LS_PRESETS);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown[];
    if (!Array.isArray(arr)) return [];
    const clean = arr.map(sanitizePreset).filter((p): p is AcceptancePreset => p !== null);
    const needsRewrite = JSON.stringify(clean) !== raw;
    if (needsRewrite) {
      try { localStorage.setItem(LS_PRESETS, JSON.stringify(clean)); } catch {}
    }
    return clean;
  } catch { return []; }
}

function loadActiveId(): string {
  if (typeof localStorage === 'undefined') return 'estandar';
  const v = localStorage.getItem(LS_ACTIVE) || 'estandar';
  // Migración: el viejo id 'principiante' ya no existe → 'inicial'.
  if (v === 'principiante') return 'inicial';
  return v;
}

class AcceptanceStore {
  custom = $state<AcceptancePreset[]>(loadCustom());
  activeId = $state<string>(loadActiveId());

  get all(): AcceptancePreset[] {
    return [...BUILTIN, ...this.custom];
  }

  /** Sólo los presets aptos para examen clínico (estándar/avanzado y
   *  cualquier preset custom con clinicallyValid=true). */
  get clinical(): AcceptancePreset[] {
    return this.all.filter((p) => p.clinicallyValid);
  }

  get active(): AcceptancePreset {
    return this.all.find((p) => p.id === this.activeId)
      ?? this.all.find((p) => p.id === 'estandar')
      ?? BUILTIN[2];
  }

  setActive(id: string) {
    this.activeId = id;
    try { localStorage.setItem(LS_ACTIVE, id); } catch {}
  }

  private persist() {
    try { localStorage.setItem(LS_PRESETS, JSON.stringify(this.custom)); } catch {}
  }

  /** Crea un preset propio a partir de los valores actuales o de uno base. */
  create(name: string, base?: AcceptanceCfg): AcceptancePreset {
    const seed = base ?? this.active;
    const id = 'cu_' + Math.random().toString(36).slice(2, 9);
    const preset: AcceptancePreset = withLegacyAliases({
      id, name: name.trim() || 'Sin nombre', builtin: false,
      clinicallyValid: true,
      yawTol: seed.yawTol, pitchTol: seed.pitchTol, rollTol: seed.rollTol,
      ampMinH: seed.ampMinH, ampMinV: seed.ampMinV,
      peakMinH: seed.peakMinH, peakMaxH: seed.peakMaxH,
      peakMinV: seed.peakMinV, peakMaxV: seed.peakMaxV,
      durMinMsH: seed.durMinMsH, durMaxMsH: seed.durMaxMsH,
      durMinMsV: seed.durMinMsV, durMaxMsV: seed.durMaxMsV,
      accelMinH: seed.accelMinH, accelMaxH: seed.accelMaxH,
      accelMinV: seed.accelMinV, accelMaxV: seed.accelMaxV,
      poseTolDeg: seed.poseTolDeg,
      peakMin: 0, peakMax: 0, durMinMs: 0, durMaxMs: 0,
    });
    this.custom = [...this.custom, preset];
    this.persist();
    this.setActive(id);
    return preset;
  }

  update(id: string, patch: Partial<AcceptanceCfg> & { name?: string; clinicallyValid?: boolean }) {
    // Si vienen campos legados (peakMin, etc.), se traducen a *H antes de
    // aplicar; luego se rearman los alias para mantener consistencia.
    const migrated = migratePatchLegacy(patch);
    this.custom = this.custom.map((p) => {
      if (p.id !== id) return p;
      return withLegacyAliases({ ...p, ...migrated }) as AcceptancePreset;
    });
    this.persist();
  }

  remove(id: string) {
    this.custom = this.custom.filter((p) => p.id !== id);
    this.persist();
    if (this.activeId === id) this.setActive('estandar');
  }
}

export const acceptance = new AcceptanceStore();
