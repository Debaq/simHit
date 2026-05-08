// Configuración de aceptación de impulsos y zona objetivo de pose.
// El docente ajusta los rangos para adaptar la sensibilidad del simulador
// al nivel del estudiante (principiante / estándar / avanzado / custom).
//
// Persistencia: localStorage (datos chicos, lectura síncrona en HeadLiveView
// y evaluateImpulse).

export interface AcceptanceCfg {
  /** Tolerancia angular en pose neutra previa al impulso (°). */
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
  /** Desplazamiento angular total durante el impulso (°). */
  ampMin: number;
  ampMax: number;
}

export interface AcceptancePreset extends AcceptanceCfg {
  id: string;
  name: string;
  builtin: boolean;
}

const BUILTIN: AcceptancePreset[] = [
  {
    id: 'principiante',
    name: 'Principiante',
    builtin: true,
    yawTol: 12, pitchTol: 12, rollTol: 12,
    peakMin: 70, peakMax: 320,
    gainMin: 0.30, gainMax: 1.60,
    durMinMs: 60, durMaxMs: 320,
    ampMin: 5, ampMax: 35,
  },
  {
    id: 'estandar',
    name: 'Estándar',
    builtin: true,
    yawTol: 6, pitchTol: 6, rollTol: 6,
    peakMin: 100, peakMax: 280,
    gainMin: 0.40, gainMax: 1.40,
    durMinMs: 80, durMaxMs: 260,
    ampMin: 8, ampMax: 25,
  },
  {
    id: 'avanzado',
    name: 'Avanzado',
    builtin: true,
    yawTol: 3, pitchTol: 3, rollTol: 3,
    peakMin: 130, peakMax: 250,
    gainMin: 0.50, gainMax: 1.30,
    durMinMs: 100, durMaxMs: 230,
    ampMin: 10, ampMax: 20,
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
      ampMin: seed.ampMin, ampMax: seed.ampMax,
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
