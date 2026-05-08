// Escenarios: combinación de un caso clínico + un preset de aceptación + un set
// de cámara. El docente arma escenarios y, al activar uno, el simulador queda
// configurado con las tres partes a la vez.

import { scenarios } from '$lib/scenario.svelte';
import { acceptance } from '$lib/acceptance.svelte';
import { eyeset } from '$lib/eyeset.svelte';

export interface Escenario {
  id: string;
  name: string;
  casoId: string;
  acceptanceId: string;
  eyesetId: string;
  updated: number;
}

const LS_LIST = 'simhit:bundles:list';
const LS_ACTIVE = 'simhit:bundles:active';
const LS_SEEDED = 'simhit:bundles:seeded';

// Escenarios de muestra que se siembran la primera vez. El docente puede
// borrarlos y no vuelven (la flag `seeded` queda persistida).
function buildStarterBundles(): Escenario[] {
  const now = Date.now();
  return [
    {
      id: 'es_seed_normal',
      name: '1. Normal — Principiante',
      casoId: 'example-1',
      acceptanceId: 'principiante',
      eyesetId: 'builtin-default',
      updated: now,
    },
    {
      id: 'es_seed_hipoder',
      name: '2. Hipofunción derecha — Estándar',
      casoId: 'example-2',
      acceptanceId: 'estandar',
      eyesetId: 'builtin-default',
      updated: now - 1,
    },
    {
      id: 'es_seed_bilateral',
      name: '3. Bilateral parcial — Avanzado',
      casoId: 'example-5',
      acceptanceId: 'avanzado',
      eyesetId: 'builtin-default',
      updated: now - 2,
    },
  ];
}

function loadList(): Escenario[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LS_LIST);
    if (raw) return JSON.parse(raw) as Escenario[];
    // Primera ejecución: sembrar y marcar.
    if (!localStorage.getItem(LS_SEEDED)) {
      const seed = buildStarterBundles();
      localStorage.setItem(LS_LIST, JSON.stringify(seed));
      localStorage.setItem(LS_SEEDED, '1');
      if (!localStorage.getItem(LS_ACTIVE)) {
        localStorage.setItem(LS_ACTIVE, seed[0].id);
      }
      return seed;
    }
    return [];
  } catch { return []; }
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
  create(name: string): Escenario {
    const caso = scenarios.active?.id ?? scenarios.examples[0]?.id ?? scenarios.list[0]?.id ?? '';
    const acc = acceptance.activeId;
    const ey = eyeset.activeId;
    const b: Escenario = {
      id: 'es_' + Math.random().toString(36).slice(2, 9),
      name: name.trim() || 'Sin nombre',
      casoId: caso,
      acceptanceId: acc,
      eyesetId: ey,
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

  /** Aplica las tres sub-selecciones del escenario activo a los stores. */
  applyActive() {
    const b = this.active;
    if (!b) return;
    if (b.casoId) scenarios.setActive(b.casoId);
    if (b.acceptanceId) acceptance.setActive(b.acceptanceId);
    if (b.eyesetId) eyeset.setActive(b.eyesetId);
  }
}

export const bundles = new BundleStore();
