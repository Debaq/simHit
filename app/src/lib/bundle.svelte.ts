// Escenarios: combinación de un caso clínico + un preset de aceptación + un set
// de cámara. El docente arma escenarios y, al activar uno, el simulador queda
// configurado con las tres partes a la vez.

import { scenarios, CHANNELS, type Channel } from '$lib/scenario.svelte';
import { acceptance } from '$lib/acceptance.svelte';
import { eyeset } from '$lib/eyeset.svelte';

export type BundleKind = 'clinico' | 'practica-horiz' | 'practica-vert' | 'practica-multi';
export type PracticeOrder = 'random' | 'sequential';
export type PracticeMode = 'attempts' | 'hits';

/** Un objetivo de práctica: cuántos impulsos se piden con un preset de aceptación.
 *  `targetChannel` (opcional, #13 F8): fija el canal específico que se quiere
 *  practicar en ese goal. Solo lo usan los bundles `practica-multi` para guiar
 *  la transición de plano (horizontal → LARP → RALP). Si está indefinido, el
 *  comportamiento es el legado (cualquier canal del plano de la variant). */
export interface PracticeGoal {
  acceptanceId: string;
  count: number;
  targetChannel?: Channel;
}

export interface Escenario {
  id: string;
  name: string;
  kind: BundleKind;
  casoId: string;
  acceptanceId: string;
  eyesetId: string;
  /** Solo para kind = 'practica-*'. Lista de objetivos por preset de aceptación. */
  goals?: PracticeGoal[];
  /** Solo para práctica. random = mezclados; sequential = en el orden de la lista. */
  order?: PracticeOrder;
  /** Solo para práctica. attempts = termina al alcanzar total de intentos;
   *  hits = termina cuando se cumplen aciertos por cada preset (los fallos no cuentan). */
  mode?: PracticeMode;
  updated: number;
}

export function defaultGoals(): PracticeGoal[] {
  return [
    { acceptanceId: 'principiante', count: 3 },
    { acceptanceId: 'estandar', count: 3 },
    { acceptanceId: 'avanzado', count: 3 },
  ];
}

const LS_LIST = 'simhit:bundles:list';
const LS_ACTIVE = 'simhit:bundles:active';
/** Versionado: bumpear cuando se agregan nuevos seeds para que usuarios viejos los vean. */
const LS_SEEDED = 'simhit:bundles:seeded:v4';

// Escenarios de muestra que se siembran la primera vez. El docente puede
// borrarlos y no vuelven (la flag `seeded` queda persistida).
function buildStarterBundles(): Escenario[] {
  const now = Date.now();
  return [
    {
      id: 'es_seed_normal',
      name: '1. Normal — Principiante',
      kind: 'clinico',
      casoId: 'example-1',
      acceptanceId: 'principiante',
      eyesetId: 'builtin-default',
      updated: now,
    },
    {
      id: 'es_seed_hipoder',
      name: '2. Hipofunción derecha — Estándar',
      kind: 'clinico',
      casoId: 'example-2',
      acceptanceId: 'estandar',
      eyesetId: 'builtin-default',
      updated: now - 1,
    },
    {
      id: 'es_seed_bilateral',
      name: '3. Bilateral parcial — Avanzado',
      kind: 'clinico',
      casoId: 'example-5',
      acceptanceId: 'avanzado',
      eyesetId: 'builtin-default',
      updated: now - 2,
    },
    {
      id: 'es_seed_practica_h',
      name: '4. Práctica horizontal',
      kind: 'practica-horiz',
      casoId: '',
      acceptanceId: 'estandar',
      eyesetId: '',
      goals: defaultGoals(),
      order: 'random',
      mode: 'attempts',
      updated: now - 3,
    },
    {
      id: 'es_seed_practica_v',
      name: '5. Práctica vertical',
      kind: 'practica-vert',
      casoId: '',
      acceptanceId: 'estandar',
      eyesetId: '',
      goals: defaultGoals(),
      order: 'random',
      mode: 'attempts',
      updated: now - 4,
    },
    {
      id: 'es_seed_practica_multi',
      name: '6. Práctica multicanal (6 canales)',
      kind: 'practica-multi',
      casoId: '',
      acceptanceId: 'estandar',
      eyesetId: '',
      // Orden anatómico: horizontal → LARP → RALP. Cada goal apunta a un canal
      // específico para que la guía progresiva pueda anunciar la transición
      // de plano. El acceptanceId 'estandar' es el preset común; el orden
      // secuencial asegura que se mantenga la progresión.
      goals: [
        { acceptanceId: 'estandar', count: 5, targetChannel: 'LL' },
        { acceptanceId: 'estandar', count: 5, targetChannel: 'RL' },
        { acceptanceId: 'estandar', count: 5, targetChannel: 'LA' },
        { acceptanceId: 'estandar', count: 5, targetChannel: 'RP' },
        { acceptanceId: 'estandar', count: 5, targetChannel: 'RA' },
        { acceptanceId: 'estandar', count: 5, targetChannel: 'LP' },
      ],
      order: 'sequential',
      mode: 'attempts',
      updated: now - 5,
    },
  ];
}

function loadList(): Escenario[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LS_LIST);
    const seeded = localStorage.getItem(LS_SEEDED);
    let list: Escenario[] = [];
    if (raw) list = (JSON.parse(raw) as any[]).map((b) => migrateBundle(b));

    if (!seeded) {
      // Sembrar todos los starter que falten (por id) — útil al introducir
      // seeds nuevos en versiones posteriores. Bumpear LS_SEEDED para forzar.
      const starters = buildStarterBundles();
      const have = new Set(list.map((b) => b.id));
      for (const s of starters) if (!have.has(s.id)) list.unshift(s);
      localStorage.setItem(LS_LIST, JSON.stringify(list));
      localStorage.setItem(LS_SEEDED, '1');
      if (!localStorage.getItem(LS_ACTIVE) && list.length) {
        localStorage.setItem(LS_ACTIVE, list[0].id);
      }
    }
    return list;
  } catch { return []; }
}

/** Migra escenarios persistidos a la forma actual. */
function migrateBundle(raw: any): Escenario {
  const kind: BundleKind = raw.kind ?? 'clinico';
  let goals = raw.goals;
  // Formato viejo: { principiante, estandar, avanzado } → array.
  if (goals && !Array.isArray(goals) && typeof goals === 'object') {
    const arr: PracticeGoal[] = [];
    for (const id of ['principiante', 'estandar', 'avanzado']) {
      if (typeof goals[id] === 'number' && goals[id] > 0) {
        arr.push({ acceptanceId: id, count: goals[id] });
      }
    }
    goals = arr;
  }
  // Conservar targetChannel si está presente (solo valores válidos del enum).
  if (Array.isArray(goals)) {
    goals = goals.map((g: any) => {
      const out: PracticeGoal = { acceptanceId: g.acceptanceId, count: g.count };
      if (typeof g.targetChannel === 'string' && (CHANNELS as readonly string[]).includes(g.targetChannel)) {
        out.targetChannel = g.targetChannel as Channel;
      }
      return out;
    });
  }
  return {
    id: raw.id,
    name: raw.name,
    kind,
    casoId: raw.casoId ?? '',
    acceptanceId: raw.acceptanceId ?? 'estandar',
    eyesetId: raw.eyesetId ?? '',
    goals: kind === 'clinico' ? undefined : (goals ?? defaultGoals()),
    order: raw.order ?? 'random',
    mode: raw.mode ?? 'attempts',
    updated: raw.updated ?? Date.now(),
  };
}

function loadActive(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(LS_ACTIVE);
}

class BundleStore {
  list = $state<Escenario[]>(loadList());
  activeId = $state<string | null>(loadActive());

  active = $derived(this.list.find((b) => b.id === this.activeId) ?? null);

  private persist() {
    try { localStorage.setItem(LS_LIST, JSON.stringify(this.list)); } catch {}
  }

  private persistActive() {
    try {
      if (this.activeId) localStorage.setItem(LS_ACTIVE, this.activeId);
      else localStorage.removeItem(LS_ACTIVE);
    } catch {}
  }

  /** Crea un escenario con las selecciones actuales (o defaults). */
  create(name: string, kind: BundleKind = 'clinico'): Escenario {
    const caso = kind === 'clinico'
      ? (scenarios.active?.id ?? scenarios.examples[0]?.id ?? scenarios.list[0]?.id ?? '')
      : '';
    const acc = acceptance.activeId;
    const ey = kind === 'clinico' ? eyeset.activeId : '';
    const b: Escenario = {
      id: 'es_' + Math.random().toString(36).slice(2, 9),
      name: name.trim() || 'Sin nombre',
      kind,
      casoId: caso,
      acceptanceId: acc,
      eyesetId: ey,
      goals: kind === 'clinico' ? undefined : defaultGoals(),
      order: kind === 'clinico' ? undefined : 'random',
      mode: kind === 'clinico' ? undefined : 'attempts',
      updated: Date.now(),
    };
    this.list = [b, ...this.list];
    this.persist();
    this.setActive(b.id);
    return b;
  }

  update(id: string, patch: Partial<Omit<Escenario, 'id'>>) {
    this.list = this.list.map((b) =>
      b.id === id ? { ...b, ...patch, updated: Date.now() } : b,
    );
    this.persist();
    if (this.activeId === id) this.applyActive();
  }

  remove(id: string) {
    this.list = this.list.filter((b) => b.id !== id);
    this.persist();
    if (this.activeId === id) {
      this.activeId = this.list[0]?.id ?? null;
      this.persistActive();
      if (this.activeId) this.applyActive();
    }
  }

  duplicate(id: string) {
    const src = this.list.find((b) => b.id === id);
    if (!src) return;
    const copy: Escenario = {
      ...src,
      id: 'es_' + Math.random().toString(36).slice(2, 9),
      name: src.name + ' (copia)',
      updated: Date.now(),
    };
    this.list = [copy, ...this.list];
    this.persist();
  }

  setActive(id: string) {
    this.activeId = id;
    this.persistActive();
    this.applyActive();
  }

  /** Aplica las tres sub-selecciones del escenario activo a los stores.
   *  En práctica solo se aplica acceptance (caso/eyeset no se usan). */
  applyActive() {
    const b = this.active;
    if (!b) return;
    if (b.kind === 'clinico') {
      if (b.casoId) scenarios.setActive(b.casoId);
      if (b.eyesetId) eyeset.setActive(b.eyesetId);
    } else {
      // Práctica: el ojo no se evalúa, pero el simulador necesita un caso
      // activo para capturar impulsos. Usamos el primer ejemplo (normal).
      const fallback = scenarios.examples[0]?.id ?? scenarios.list[0]?.id;
      if (fallback) scenarios.setActive(fallback);
    }
    if (b.acceptanceId) acceptance.setActive(b.acceptanceId);
  }
}

export const bundles = new BundleStore();
