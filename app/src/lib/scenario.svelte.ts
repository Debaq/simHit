import type { Node, Edge } from '@xyflow/svelte';
import { storage } from './storage';

const SCENARIOS_DIR = 'scenarios';
const LEGACY_KEY = 'simhit:scenarios';

export type NodeKind = 'start' | 'impulse' | 'pause' | 'artifact' | 'end' | 'random';

export type ImpulseData = {
  label?: string;
  side: 'L' | 'R' | 'random';
  count: number;
  gain: number;          // 0..1.5
  peakVel: number;       // °/s
  saccade: 'none' | 'covert' | 'overt';
};

export type PauseData = { label?: string; durationMs: number };
export type ArtifactData = {
  label?: string;
  artifact: 'blink' | 'slip' | 'wrong_dir' | 'overshoot' | 'fixation_loss';
  probability: number;   // 0..1
};
export type RandomData = { label?: string };
export type StartData = { label?: string };
export type EndData = { label?: string };

export type AnyData = ImpulseData | PauseData | ArtifactData | RandomData | StartData | EndData;

export type Scenario = {
  id: string;
  name: string;
  description?: string;
  nodes: Node[];
  edges: Edge[];
  updated: number;
};

const ACTIVE_KEY = 'simhit:active-scenario';

export function defaultsFor(kind: NodeKind): AnyData {
  switch (kind) {
    case 'impulse':
      return { label: 'Impulsos', side: 'random', count: 10, gain: 0.95, peakVel: 180, saccade: 'none' };
    case 'pause':
      return { label: 'Pausa', durationMs: 1500 };
    case 'artifact':
      return { label: 'Artefacto', artifact: 'blink', probability: 0.3 };
    case 'random':
      return { label: 'Bifurcación' };
    case 'start':
      return { label: 'Inicio' };
    case 'end':
      return { label: 'Fin' };
  }
}

class ScenarioStore {
  // Casos predefinidos (siempre disponibles, read-only). No se persisten.
  examples = $state<Scenario[]>([]);
  // Escenarios del usuario (persistidos en localStorage).
  list = $state<Scenario[]>([]);
  activeId = $state<string | null>(null);

  active = $derived(
    this.examples.find((s) => s.id === this.activeId) ??
      this.list.find((s) => s.id === this.activeId) ??
      null
  );
  isExampleActive = $derived(!!this.examples.find((s) => s.id === this.activeId));

  loaded = $state(false);

  async load() {
    this.examples = buildExampleCases();

    // Migración legacy → fs (una sola vez si fs vacío)
    const filenames = await storage.list(SCENARIOS_DIR);
    if (filenames.length === 0) {
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) {
        try {
          const arr: Scenario[] = JSON.parse(legacy);
          for (const s of arr) {
            await storage.writeJson(`${SCENARIOS_DIR}/${s.id}.json`, s);
          }
          localStorage.removeItem(LEGACY_KEY);
        } catch (e) { console.warn('migración escenarios', e); }
      }
    }

    const items: Scenario[] = [];
    for (const fn of (await storage.list(SCENARIOS_DIR)).filter((n) => n.endsWith('.json'))) {
      const s = await storage.readJson<Scenario>(`${SCENARIOS_DIR}/${fn}`);
      if (s) items.push(s);
    }
    this.list = items.sort((a, b) => b.updated - a.updated);

    try {
      this.activeId = localStorage.getItem(ACTIVE_KEY);
    } catch {}
    if (!this.activeId) this.activeId = this.examples[0]?.id ?? this.list[0]?.id ?? null;
    this.loaded = true;
  }

  private persist(s: Scenario) {
    void storage.writeJson(`${SCENARIOS_DIR}/${s.id}.json`, s);
  }

  create(name = 'Nuevo escenario'): Scenario {
    const id = crypto.randomUUID();
    const s: Scenario = {
      id,
      name,
      nodes: [
        { id: 'start', type: 'start', position: { x: 80, y: 200 }, data: defaultsFor('start') as any },
        { id: 'end', type: 'end', position: { x: 800, y: 200 }, data: defaultsFor('end') as any },
      ],
      edges: [],
      updated: Date.now(),
    };
    this.list = [s, ...this.list];
    this.activeId = id;
    try { localStorage.setItem(ACTIVE_KEY, id); } catch {}
    this.persist(s);
    return s;
  }

  duplicate(id: string): Scenario | null {
    const src = this.examples.find((s) => s.id === id) ?? this.list.find((s) => s.id === id);
    if (!src) return null;
    const copy: Scenario = {
      id: crypto.randomUUID(),
      name: src.name.replace(/^\d+\.\s*/, '') + ' (copia)',
      description: src.description,
      nodes: src.nodes.map((n) => ({ ...n, data: { ...(n.data as any) } })),
      edges: src.edges.map((e) => ({ ...e })),
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
    if (s) { s.name = name; s.updated = Date.now(); this.persist(s); this.list = [...this.list]; }
  }

  setActive(id: string) {
    this.activeId = id;
    try { localStorage.setItem(ACTIVE_KEY, id); } catch {}
  }

  updateActive(nodes: Node[], edges: Edge[]) {
    const s = this.list.find((x) => x.id === this.activeId);
    if (!s) return;
    s.nodes = nodes;
    s.edges = edges;
    s.updated = Date.now();
    this.persist(s);
  }
}

type ImpulseStep = Partial<ImpulseData>;
type ArtifactStep = { kind: 'artifact'; data: Partial<ArtifactData> };
type PauseStep = { kind: 'pause'; data: Partial<PauseData> };
type Step = (ImpulseStep & { kind?: 'impulse' }) | ArtifactStep | PauseStep;

function buildCase(idSuffix: string, name: string, description: string, steps: Step[]): Scenario {
  const id = `example-${idSuffix}`;
  const nodes: Node[] = [
    { id: 'start', type: 'start', position: { x: 60, y: 220 }, data: defaultsFor('start') as any },
  ];
  const edges: Edge[] = [];
  let prevId = 'start';
  steps.forEach((step, i) => {
    const nid = `n${i}`;
    const x = 240 + i * 220;
    let type: NodeKind = 'impulse';
    let data: any;
    if ('kind' in step && step.kind === 'artifact') {
      type = 'artifact';
      data = { ...defaultsFor('artifact'), ...step.data };
    } else if ('kind' in step && step.kind === 'pause') {
      type = 'pause';
      data = { ...defaultsFor('pause'), ...step.data };
    } else {
      type = 'impulse';
      data = { ...defaultsFor('impulse'), ...(step as ImpulseStep) };
    }
    nodes.push({ id: nid, type, position: { x, y: 220 }, data });
    edges.push({ id: `e-${prevId}-${nid}`, source: prevId, target: nid });
    prevId = nid;
  });
  const endX = 240 + steps.length * 220;
  nodes.push({ id: 'end', type: 'end', position: { x: endX, y: 220 }, data: defaultsFor('end') as any });
  edges.push({ id: `e-${prevId}-end`, source: prevId, target: 'end' });
  return { id, name, description, nodes, edges, updated: Date.now() };
}

function buildExampleCases(): Scenario[] {
  return [
    buildCase('1', '1. Normal bilateral', 'VOR normal en ambos lados (gain ~0.95). Sin sacadas correctivas.', [
      { label: '10 izq', side: 'L', count: 10, gain: 0.95, peakVel: 180, saccade: 'none' },
      { label: '10 der', side: 'R', count: 10, gain: 0.95, peakVel: 180, saccade: 'none' },
    ]),
    buildCase('2', '2. Hipofunción derecha — overt', 'Pérdida vestibular derecha clásica con sacadas manifiestas.', [
      { label: '10 izq normal', side: 'L', count: 10, gain: 0.95, peakVel: 180, saccade: 'none' },
      { label: '10 der ↓ overt', side: 'R', count: 10, gain: 0.4, peakVel: 180, saccade: 'overt' },
    ]),
    buildCase('3', '3. Hipofunción izquierda — overt', 'Pérdida vestibular izquierda con sacadas manifiestas.', [
      { label: '10 izq ↓ overt', side: 'L', count: 10, gain: 0.4, peakVel: 180, saccade: 'overt' },
      { label: '10 der normal', side: 'R', count: 10, gain: 0.95, peakVel: 180, saccade: 'none' },
    ]),
    buildCase('4', '4. Hipofunción derecha — covert', 'Hipofunción derecha compensada con sacadas cubiertas (sutil).', [
      { label: '10 izq normal', side: 'L', count: 10, gain: 0.95, peakVel: 180, saccade: 'none' },
      { label: '10 der ↓ covert', side: 'R', count: 10, gain: 0.55, peakVel: 180, saccade: 'covert' },
    ]),
    buildCase('5', '5. Bilateral parcial', 'Hipofunción bilateral simétrica (gain ~0.5 ambos).', [
      { label: '10 izq ↓', side: 'L', count: 10, gain: 0.5, peakVel: 180, saccade: 'overt' },
      { label: '10 der ↓', side: 'R', count: 10, gain: 0.5, peakVel: 180, saccade: 'overt' },
    ]),
    buildCase('6', '6. Hipofunción severa derecha', 'Pérdida casi total derecha con sacadas overt amplias.', [
      { label: '10 izq normal', side: 'L', count: 10, gain: 0.95, peakVel: 200, saccade: 'none' },
      { label: '10 der severo', side: 'R', count: 10, gain: 0.2, peakVel: 200, saccade: 'overt' },
    ]),
    buildCase('7', '7. Hipofunción leve izquierda', 'Pérdida leve izquierda con sacadas covert ocasionales.', [
      { label: '10 izq leve', side: 'L', count: 10, gain: 0.75, peakVel: 170, saccade: 'covert' },
      { label: '10 der normal', side: 'R', count: 10, gain: 0.95, peakVel: 170, saccade: 'none' },
    ]),
    buildCase('8', '8. Compensación post-aguda', 'Mezcla de sacadas covert y overt (compensación en curso).', [
      { label: '10 izq normal', side: 'L', count: 10, gain: 0.95, peakVel: 180, saccade: 'none' },
      { label: '5 der covert', side: 'R', count: 5, gain: 0.6, peakVel: 180, saccade: 'covert' },
      { label: '5 der overt', side: 'R', count: 5, gain: 0.6, peakVel: 180, saccade: 'overt' },
    ]),
    buildCase('9', '9. Examen con artefactos', 'Patrón normal contaminado por parpadeos y deslizamiento de gafas.', [
      { label: '10 izq', side: 'L', count: 10, gain: 0.95, peakVel: 180, saccade: 'none' },
      { kind: 'artifact', data: { artifact: 'blink', probability: 0.4 } },
      { label: '10 der', side: 'R', count: 10, gain: 0.95, peakVel: 180, saccade: 'none' },
      { kind: 'artifact', data: { artifact: 'slip', probability: 0.3 } },
    ]),
    buildCase('10', '10. Mixto progresivo', 'Sesión con normales seguidos de patológicos en cada lado.', [
      { label: '5 izq normal', side: 'L', count: 5, gain: 0.95, peakVel: 180, saccade: 'none' },
      { label: '5 izq ↓', side: 'L', count: 5, gain: 0.5, peakVel: 180, saccade: 'overt' },
      { kind: 'pause', data: { durationMs: 2000 } },
      { label: '5 der normal', side: 'R', count: 5, gain: 0.95, peakVel: 180, saccade: 'none' },
      { label: '5 der ↓', side: 'R', count: 5, gain: 0.4, peakVel: 180, saccade: 'overt' },
    ]),
  ];
}

export const scenarios = new ScenarioStore();
