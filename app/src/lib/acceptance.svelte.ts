// Configuración de aceptación de impulsos y zona objetivo de pose.
// El docente ajusta los rangos para adaptar la sensibilidad del simulador
// al nivel del estudiante (principiante / estándar / avanzado / custom).
//
// Persistencia: localStorage (datos chicos, lectura síncrona en HeadLiveView
// y evaluateImpulse).

export interface AcceptanceCfg {
  /** Amplitud angular máxima permitida del impulso (°). Define la zona verde
   *  del HeadLiveView: la cabeza no debe excederla durante el hit. */
  yawTol: number;
  pitchTol: number;
  rollTol: number;
  /** Velocidad pico de cabeza aceptable (°/s). */
  peakMin: number;
  peakMax: number;
  /** Ganancia VOR aceptable (adimensional). */
  gainMin: number;
  gainMax: number;
  /** Duración del impulso (ms). */
  durMinMs: number;
  durMaxMs: number;
}

export interface AcceptancePreset extends AcceptanceCfg {
  id: string;
  name: string;
  builtin: boolean;
}

const BUILTIN: AcceptancePreset[] = [
  // Tolerancia de pose neutra (zona verde) según literatura vHIT:
  // 30° principiante, 20° estándar, 10° experto.
  {
    id: 'principiante',
    name: 'Principiante',
    builtin: true,
    yawTol: 30, pitchTol: 30, rollTol: 30,
    peakMin: 70, peakMax: 320,
    gainMin: 0.30, gainMax: 1.60,
    durMinMs: 60, durMaxMs: 320,
  },
  {
    id: 'estandar',
    name: 'Estándar',
    builtin: true,
    yawTol: 20, pitchTol: 20, rollTol: 20,
    peakMin: 100, peakMax: 280,
    gainMin: 0.40, gainMax: 1.40,
    durMinMs: 80, durMaxMs: 260,
  },
  {
    id: 'avanzado',
    name: 'Avanzado',
    builtin: true,
    yawTol: 10, pitchTol: 10, rollTol: 10,
    peakMin: 130, peakMax: 250,
    gainMin: 0.50, gainMax: 1.30,
    durMinMs: 100, durMaxMs: 230,
  },
];

const LS_PRESETS = 'simhit:acceptance:presets';
const LS_ACTIVE = 'simhit:acceptance:active';

function loadCustom(): AcceptancePreset[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LS_PRESETS);
    if (!raw) return [];
    const arr = JSON.parse(raw) as AcceptancePreset[];
    return arr.filter((p) => p && !p.builtin);
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
    const preset: AcceptancePreset = {
      id, name: name.trim() || 'Sin nombre', builtin: false,
      yawTol: seed.yawTol, pitchTol: seed.pitchTol, rollTol: seed.rollTol,
      peakMin: seed.peakMin, peakMax: seed.peakMax,
      gainMin: seed.gainMin, gainMax: seed.gainMax,
      durMinMs: seed.durMinMs, durMaxMs: seed.durMaxMs,
    };
    this.custom = [...this.custom, preset];
    this.persist();
    this.setActive(id);
    return preset;
  }

  update(id: string, patch: Partial<AcceptanceCfg> & { name?: string }) {
    this.custom = this.custom.map((p) => p.id === id ? { ...p, ...patch } : p);
    this.persist();
  }

  remove(id: string) {
    this.custom = this.custom.filter((p) => p.id !== id);
    this.persist();
    if (this.activeId === id) this.setActive('estandar');
  }
}

export const acceptance = new AcceptanceStore();
