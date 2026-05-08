// Modelo de escenario por canal vHIT.
// Cada escenario describe el "paciente" que verá el estudiante: qué respuesta
// dará el ojo cuando el examinador haga el impulso por cada uno de los 6
// canales de los conductos semicirculares.
//
//   LL = Lateral izquierdo  (horizontal, cabeza gira hacia la izquierda)
//   RL = Lateral derecho    (horizontal, cabeza gira hacia la derecha)
//   LA = Anterior izquierdo (vertical/diagonal)  -- aún sin cámara
//   RP = Posterior derecho  (vertical/diagonal)  -- aún sin cámara
//   RA = Anterior derecho   (vertical/diagonal)  -- aún sin cámara
//   LP = Posterior izquierdo (vertical/diagonal) -- aún sin cámara
//
// La UI sólo expone LL/RL hasta que la cámara detecte verticales; los demás se
// guardan con valores por defecto y quedan visibles pero deshabilitados.

import { storage } from './storage';

const SCENARIOS_DIR = 'scenarios';
const ACTIVE_KEY = 'simhit:active-scenario';
const LEGACY_KEY = 'simhit:scenarios';

export type ArtifactKind = 'blink' | 'slip' | 'wrong_dir' | 'overshoot' | 'fixation_loss';
export type ArtifactConfig = { artifact: ArtifactKind; probability: number };

export const CHANNELS = ['LL', 'RL', 'LA', 'RP', 'RA', 'LP'] as const;
export type Channel = (typeof CHANNELS)[number];

export const HORIZONTAL_CHANNELS: Channel[] = ['LL', 'RL'];
export const VERTICAL_CHANNELS: Channel[] = ['LA', 'RP', 'RA', 'LP'];

export const CHANNEL_LABELS: Record<Channel, string> = {
  LL: 'Lateral izq.',
  RL: 'Lateral der.',
  LA: 'Anterior izq.',
  RP: 'Posterior der.',
  RA: 'Anterior der.',
  LP: 'Posterior izq.',
};

export type ChannelConfig = {
  /** VOR gain 0..1.5 — proporción mov. ojo / mov. cabeza. */
  gain: number;
  /** Velocidad pico del impulso de cabeza (°/s). */
  peakVel: number;
  /** Sacada correctiva: ninguna, cubierta (durante impulso), manifiesta (post). */
  saccade: 'none' | 'covert' | 'overt';
  /** Lista de artefactos posibles con su probabilidad por impulso. */
  artifacts: ArtifactConfig[];
};

export type Scenario = {
  id: string;
  name: string;
  description?: string;
  channels: Record<Channel, ChannelConfig>;
  updated: number;
};

export function defaultChannelConfig(): ChannelConfig {
  return { gain: 0.95, peakVel: 180, saccade: 'none', artifacts: [] };
}

function emptyChannels(): Record<Channel, ChannelConfig> {
  return {
    LL: defaultChannelConfig(),
    RL: defaultChannelConfig(),
    LA: defaultChannelConfig(),
    RP: defaultChannelConfig(),
    RA: defaultChannelConfig(),
    LP: defaultChannelConfig(),
  };
}

class ScenarioStore {
  examples = $state<Scenario[]>([]);
  list = $state<Scenario[]>([]);
  activeId = $state<string | null>(null);
  loaded = $state(false);

  active = $derived(
    this.examples.find((s) => s.id === this.activeId) ??
      this.list.find((s) => s.id === this.activeId) ??
      null,
  );
  isExampleActive = $derived(!!this.examples.find((s) => s.id === this.activeId));

  async load() {
    this.examples = buildExampleCases();

    // Limpiar legacy localStorage (formato viejo de nodos).
    try { localStorage.removeItem(LEGACY_KEY); } catch {}

    const filenames = (await storage.list(SCENARIOS_DIR)).filter((n) => n.endsWith('.json'));
    const items: Scenario[] = [];
    for (const fn of filenames) {
      const raw = await storage.readJson<unknown>(`${SCENARIOS_DIR}/${fn}`);
      const s = normalizeScenario(raw);
      if (!s) {
        // Formato viejo (nodos/edges): borrar.
        await storage.remove(`${SCENARIOS_DIR}/${fn}`);
        continue;
      }
      items.push(s);
    }
    this.list = items.sort((a, b) => b.updated - a.updated);

    try { this.activeId = localStorage.getItem(ACTIVE_KEY); } catch {}
    if (!this.activeId || !this.findScenario(this.activeId)) {
      this.activeId = this.examples[0]?.id ?? this.list[0]?.id ?? null;
    }
    this.loaded = true;
  }

  private findScenario(id: string): Scenario | null {
    return this.examples.find((s) => s.id === id) ?? this.list.find((s) => s.id === id) ?? null;
  }

  private persist(s: Scenario) {
    void storage.writeJson(`${SCENARIOS_DIR}/${s.id}.json`, s);
  }

  create(name = 'Nuevo escenario'): Scenario {
    const s: Scenario = {
      id: crypto.randomUUID(),
      name,
      channels: emptyChannels(),
      updated: Date.now(),
    };
    this.list = [s, ...this.list];
    this.activeId = s.id;
    try { localStorage.setItem(ACTIVE_KEY, s.id); } catch {}
    this.persist(s);
    return s;
  }

  duplicate(id: string): Scenario | null {
    const src = this.findScenario(id);
    if (!src) return null;
    const copy: Scenario = {
      id: crypto.randomUUID(),
      name: src.name.replace(/^\d+\.\s*/, '') + ' (copia)',
      description: src.description,
      channels: cloneChannels(src.channels),
      updated: Date.now(),
    };
    this.list = [copy, ...this.list];
    this.activeId = copy.id;
    try { localStorage.setItem(ACTIVE_KEY, copy.id); } catch {}
    this.persist(copy);
    return copy;
  }

  remove(id: string) {
    this.list = this.list.filter((s) => s.id !== id);
    if (this.activeId === id) this.activeId = this.list[0]?.id ?? this.examples[0]?.id ?? null;
    void storage.remove(`${SCENARIOS_DIR}/${id}.json`);
    if (this.activeId) try { localStorage.setItem(ACTIVE_KEY, this.activeId); } catch {}
  }

  rename(id: string, name: string) {
    const s = this.list.find((x) => x.id === id);
    if (!s) return;
    s.name = name;
    s.updated = Date.now();
    this.persist(s);
    this.list = [...this.list];
  }

  setActive(id: string) {
    this.activeId = id;
    try { localStorage.setItem(ACTIVE_KEY, id); } catch {}
  }

  updateChannel(scenarioId: string, channel: Channel, patch: Partial<ChannelConfig>) {
    const s = this.list.find((x) => x.id === scenarioId);
    if (!s) return;
    s.channels[channel] = { ...s.channels[channel], ...patch };
    s.updated = Date.now();
    this.list = [...this.list];
    this.persist(s);
  }

  setChannelArtifacts(scenarioId: string, channel: Channel, artifacts: ArtifactConfig[]) {
    this.updateChannel(scenarioId, channel, { artifacts: artifacts.map((a) => ({ ...a })) });
  }
}

function cloneChannels(src: Record<Channel, ChannelConfig>): Record<Channel, ChannelConfig> {
  const out = emptyChannels();
  for (const k of CHANNELS) {
    out[k] = {
      gain: src[k].gain,
      peakVel: src[k].peakVel,
      saccade: src[k].saccade,
      artifacts: src[k].artifacts.map((a) => ({ ...a })),
    };
  }
  return out;
}

function normalizeScenario(raw: unknown): Scenario | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.name !== 'string') return null;
  if (!r.channels || typeof r.channels !== 'object') return null; // formato viejo (nodos/edges)
  const channels = emptyChannels();
  const src = r.channels as Record<string, unknown>;
  for (const k of CHANNELS) {
    const c = src[k];
    if (c && typeof c === 'object') {
      const cc = c as Record<string, unknown>;
      channels[k] = {
        gain: clamp(num(cc.gain, 0.95), 0, 1.5),
        peakVel: clamp(num(cc.peakVel, 180), 50, 350),
        saccade: ['none', 'covert', 'overt'].includes(cc.saccade as string)
          ? (cc.saccade as ChannelConfig['saccade'])
          : 'none',
        artifacts: Array.isArray(cc.artifacts)
          ? (cc.artifacts as ArtifactConfig[])
              .filter((a) => a && typeof a.artifact === 'string')
              .map((a) => ({ artifact: a.artifact, probability: clamp(num(a.probability, 0.3), 0, 1) }))
          : [],
      };
    }
  }
  return {
    id: r.id,
    name: r.name,
    description: typeof r.description === 'string' ? r.description : undefined,
    channels,
    updated: typeof r.updated === 'number' ? r.updated : Date.now(),
  };
}

function num(v: unknown, def: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : def;
}
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function buildCase(
  idSuffix: string,
  name: string,
  description: string,
  ll: Partial<ChannelConfig>,
  rl: Partial<ChannelConfig>,
): Scenario {
  const channels = emptyChannels();
  channels.LL = { ...defaultChannelConfig(), ...ll };
  channels.RL = { ...defaultChannelConfig(), ...rl };
  return {
    id: `example-${idSuffix}`,
    name,
    description,
    channels,
    updated: Date.now(),
  };
}

function buildExampleCases(): Scenario[] {
  return [
    buildCase('1', '1. Normal bilateral', 'VOR normal en ambos lados (gain ~0.95). Sin sacadas correctivas.',
      { gain: 0.95, peakVel: 180, saccade: 'none' },
      { gain: 0.95, peakVel: 180, saccade: 'none' }),
    buildCase('2', '2. Hipofunción derecha — overt', 'Pérdida vestibular derecha clásica con sacadas manifiestas.',
      { gain: 0.95, peakVel: 180, saccade: 'none' },
      { gain: 0.4,  peakVel: 180, saccade: 'overt' }),
    buildCase('3', '3. Hipofunción izquierda — overt', 'Pérdida vestibular izquierda con sacadas manifiestas.',
      { gain: 0.4,  peakVel: 180, saccade: 'overt' },
      { gain: 0.95, peakVel: 180, saccade: 'none' }),
    buildCase('4', '4. Hipofunción derecha — covert', 'Hipofunción derecha compensada con sacadas cubiertas (sutil).',
      { gain: 0.95, peakVel: 180, saccade: 'none' },
      { gain: 0.55, peakVel: 180, saccade: 'covert' }),
    buildCase('5', '5. Bilateral parcial', 'Hipofunción bilateral simétrica (gain ~0.5 ambos).',
      { gain: 0.5, peakVel: 180, saccade: 'overt' },
      { gain: 0.5, peakVel: 180, saccade: 'overt' }),
    buildCase('6', '6. Hipofunción severa derecha', 'Pérdida casi total derecha con sacadas overt amplias.',
      { gain: 0.95, peakVel: 200, saccade: 'none' },
      { gain: 0.2,  peakVel: 200, saccade: 'overt' }),
    buildCase('7', '7. Hipofunción leve izquierda', 'Pérdida leve izquierda con sacadas covert ocasionales.',
      { gain: 0.75, peakVel: 170, saccade: 'covert' },
      { gain: 0.95, peakVel: 170, saccade: 'none' }),
    buildCase('8', '8. Compensación post-aguda', 'Mezcla de sacadas covert y overt; hipofunción derecha en compensación.',
      { gain: 0.95, peakVel: 180, saccade: 'none' },
      { gain: 0.6,  peakVel: 180, saccade: 'covert' }),
    buildCase('9', '9. Examen con artefactos', 'Patrón normal contaminado por parpadeos y deslizamiento de gafas.',
      { gain: 0.95, peakVel: 180, saccade: 'none', artifacts: [{ artifact: 'blink', probability: 0.4 }] },
      { gain: 0.95, peakVel: 180, saccade: 'none', artifacts: [{ artifact: 'slip', probability: 0.3 }] }),
    buildCase('10', '10. Mixto progresivo', 'Hipofunción izquierda moderada con normal a la derecha.',
      { gain: 0.5,  peakVel: 180, saccade: 'overt' },
      { gain: 0.95, peakVel: 180, saccade: 'none' }),
  ];
}

export const scenarios = new ScenarioStore();
