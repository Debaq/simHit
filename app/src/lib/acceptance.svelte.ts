// Configuración de aceptación de impulsos y zona objetivo de pose.
// El docente ajusta los rangos para adaptar la sensibilidad del simulador
// al nivel del estudiante (principiante / estándar / avanzado / custom).
//
// Persistencia: localStorage (datos chicos, lectura síncrona en HeadLiveView
// y evaluateImpulse).
//
// Rangos H vs V: pico, ganancia, duración y desplazamiento se separan en
// variantes horizontales (canales LL/RL) y verticales (LA/LP/RA/RP) porque
// los planos verticales suelen tolerar otros umbrales (ver issue #13).
// Los valores V iniciales replican los H; la UI docente los ajustará luego.

export interface AcceptanceCfg {
  /** Amplitud angular máxima permitida del impulso (°). Define la zona verde
   *  del HeadLiveView: la cabeza no debe excederla durante el hit. */
  yawTol: number;
  pitchTol: number;
  rollTol: number;
  /** Velocidad pico de cabeza aceptable (°/s) — canales horizontales. */
  peakMinH: number;
  peakMaxH: number;
  /** Velocidad pico de cabeza aceptable (°/s) — canales verticales. */
  peakMinV: number;
  peakMaxV: number;
  /** Ganancia VOR aceptable — horizontales. */
  gainMinH: number;
  gainMaxH: number;
  /** Ganancia VOR aceptable — verticales. */
  gainMinV: number;
  gainMaxV: number;
  /** Duración del impulso (ms) — horizontales. */
  durMinMsH: number;
  durMaxMsH: number;
  /** Duración del impulso (ms) — verticales. */
  durMinMsV: number;
  durMaxMsV: number;
  // Alias legado (sin sufijo): siempre reflejan los valores horizontales.
  // Existen para que la UI docente actual (que aún no distingue H/V) siga
  // operando sin cambios. La separación H/V real la hará F4.
  /** @deprecated alias de peakMinH — se sincroniza con H. */
  peakMin: number;
  /** @deprecated alias de peakMaxH. */
  peakMax: number;
  /** @deprecated alias de gainMinH. */
  gainMin: number;
  /** @deprecated alias de gainMaxH. */
  gainMax: number;
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
  if (out.gainMinH !== undefined) out.gainMin = out.gainMinH;
  if (out.gainMaxH !== undefined) out.gainMax = out.gainMaxH;
  if (out.durMinMsH !== undefined) out.durMinMs = out.durMinMsH;
  if (out.durMaxMsH !== undefined) out.durMaxMs = out.durMaxMsH;
  return out as T;
}

/** Convierte un patch legado (peakMin, etc.) en sus equivalentes *H,
 *  preservando el comportamiento de la UI docente actual. */
function migratePatchLegacy(patch: Partial<AcceptanceCfg> & { name?: string }):
  Partial<AcceptanceCfg> & { name?: string } {
  const out: any = { ...patch };
  if ('peakMin' in patch && out.peakMinH === undefined) out.peakMinH = (patch as any).peakMin;
  if ('peakMax' in patch && out.peakMaxH === undefined) out.peakMaxH = (patch as any).peakMax;
  if ('gainMin' in patch && out.gainMinH === undefined) out.gainMinH = (patch as any).gainMin;
  if ('gainMax' in patch && out.gainMaxH === undefined) out.gainMaxH = (patch as any).gainMax;
  if ('durMinMs' in patch && out.durMinMsH === undefined) out.durMinMsH = (patch as any).durMinMs;
  if ('durMaxMs' in patch && out.durMaxMsH === undefined) out.durMaxMsH = (patch as any).durMaxMs;
  return out;
}

export interface AcceptancePreset extends AcceptanceCfg {
  id: string;
  name: string;
  builtin: boolean;
}

function makeBuiltin(p: AcceptancePreset): AcceptancePreset {
  return withLegacyAliases(p);
}

const BUILTIN: AcceptancePreset[] = [
  // Tolerancia de pose neutra (zona verde) según literatura vHIT:
  // 30° principiante, 20° estándar, 10° experto.
  // V = H inicial; ajustables luego desde la UI docente.
  makeBuiltin({
    id: 'principiante',
    name: 'Principiante',
    builtin: true,
    yawTol: 30, pitchTol: 30, rollTol: 30,
    peakMinH: 70,  peakMaxH: 320,
    peakMinV: 70,  peakMaxV: 320,
    gainMinH: 0.30, gainMaxH: 1.60,
    gainMinV: 0.30, gainMaxV: 1.60,
    durMinMsH: 60, durMaxMsH: 320,
    durMinMsV: 60, durMaxMsV: 320,
    // Aliases legados — los rellena withLegacyAliases.
    peakMin: 0, peakMax: 0, gainMin: 0, gainMax: 0, durMinMs: 0, durMaxMs: 0,
  }),
  makeBuiltin({
    id: 'estandar',
    name: 'Estándar',
    builtin: true,
    yawTol: 20, pitchTol: 20, rollTol: 20,
    peakMinH: 100, peakMaxH: 280,
    peakMinV: 100, peakMaxV: 280,
    gainMinH: 0.40, gainMaxH: 1.40,
    gainMinV: 0.40, gainMaxV: 1.40,
    durMinMsH: 80, durMaxMsH: 260,
    durMinMsV: 80, durMaxMsV: 260,
    peakMin: 0, peakMax: 0, gainMin: 0, gainMax: 0, durMinMs: 0, durMaxMs: 0,
  }),
  makeBuiltin({
    id: 'avanzado',
    name: 'Avanzado',
    builtin: true,
    yawTol: 10, pitchTol: 10, rollTol: 10,
    peakMinH: 130, peakMaxH: 250,
    peakMinV: 130, peakMaxV: 250,
    gainMinH: 0.50, gainMaxH: 1.30,
    gainMinV: 0.50, gainMaxV: 1.30,
    durMinMsH: 100, durMaxMsH: 230,
    durMinMsV: 100, durMaxMsV: 230,
    peakMin: 0, peakMax: 0, gainMin: 0, gainMax: 0, durMinMs: 0, durMaxMs: 0,
  }),
];

const LS_PRESETS = 'simhit:acceptance:presets';
const LS_ACTIVE = 'simhit:acceptance:active';

/** Normaliza un preset legado: conserva sólo los campos del schema actual.
 *  Si vienen los campos sin sufijo (peakMin/peakMax/etc.), se duplican como
 *  *H y *V para mantener compatibilidad con presets creados antes de F0. */
function sanitizePreset(p: any): AcceptancePreset | null {
  if (!p || typeof p !== 'object' || !p.id || p.builtin) return null;
  // Migración legado → H/V: si no existe *H, leer del campo sin sufijo.
  const peakMinH = p.peakMinH ?? p.peakMin;
  const peakMaxH = p.peakMaxH ?? p.peakMax;
  const peakMinV = p.peakMinV ?? p.peakMin;
  const peakMaxV = p.peakMaxV ?? p.peakMax;
  const gainMinH = p.gainMinH ?? p.gainMin;
  const gainMaxH = p.gainMaxH ?? p.gainMax;
  const gainMinV = p.gainMinV ?? p.gainMin;
  const gainMaxV = p.gainMaxV ?? p.gainMax;
  const durMinMsH = p.durMinMsH ?? p.durMinMs;
  const durMaxMsH = p.durMaxMsH ?? p.durMaxMs;
  const durMinMsV = p.durMinMsV ?? p.durMinMs;
  const durMaxMsV = p.durMaxMsV ?? p.durMaxMs;
  return withLegacyAliases({
    id: String(p.id),
    name: String(p.name ?? 'Sin nombre'),
    builtin: false,
    yawTol: Number(p.yawTol),
    pitchTol: Number(p.pitchTol),
    rollTol: Number(p.rollTol),
    peakMinH: Number(peakMinH),
    peakMaxH: Number(peakMaxH),
    peakMinV: Number(peakMinV),
    peakMaxV: Number(peakMaxV),
    gainMinH: Number(gainMinH),
    gainMaxH: Number(gainMaxH),
    gainMinV: Number(gainMinV),
    gainMaxV: Number(gainMaxV),
    durMinMsH: Number(durMinMsH),
    durMaxMsH: Number(durMaxMsH),
    durMinMsV: Number(durMinMsV),
    durMaxMsV: Number(durMaxMsV),
    // Aliases legados — los completa withLegacyAliases.
    peakMin: 0, peakMax: 0, gainMin: 0, gainMax: 0, durMinMs: 0, durMaxMs: 0,
  });
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
  return localStorage.getItem(LS_ACTIVE) || 'estandar';
}

class AcceptanceStore {
  custom = $state<AcceptancePreset[]>(loadCustom());
  activeId = $state<string>(loadActiveId());

  get all(): AcceptancePreset[] {
    return [...BUILTIN, ...this.custom];
  }

  get active(): AcceptancePreset {
    return this.all.find((p) => p.id === this.activeId) ?? BUILTIN[1];
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
      yawTol: seed.yawTol, pitchTol: seed.pitchTol, rollTol: seed.rollTol,
      peakMinH: seed.peakMinH, peakMaxH: seed.peakMaxH,
      peakMinV: seed.peakMinV, peakMaxV: seed.peakMaxV,
      gainMinH: seed.gainMinH, gainMaxH: seed.gainMaxH,
      gainMinV: seed.gainMinV, gainMaxV: seed.gainMaxV,
      durMinMsH: seed.durMinMsH, durMaxMsH: seed.durMaxMsH,
      durMinMsV: seed.durMinMsV, durMaxMsV: seed.durMaxMsV,
      peakMin: 0, peakMax: 0, gainMin: 0, gainMax: 0, durMinMs: 0, durMaxMs: 0,
    });
    this.custom = [...this.custom, preset];
    this.persist();
    this.setActive(id);
    return preset;
  }

  update(id: string, patch: Partial<AcceptanceCfg> & { name?: string }) {
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
