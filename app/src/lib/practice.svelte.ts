// Sesión de práctica: secuencia de objetivos por preset de aceptación.
// El docente arma la lista de objetivos (cualquier preset, builtin o custom),
// elige orden (aleatorio o secuencial) y modo de finalización (intentos
// totales o aciertos por preset).

import { acceptance } from '$lib/acceptance.svelte';
import { sim, isHorizontalSide, type Verdict, type Impulse, type ImpulseSide } from '$lib/simulator.svelte';
import type { Escenario } from '$lib/bundle.svelte';

export interface SeqItem {
  /** Posición original en la secuencia (no cambia tras la mezcla). */
  idx: number;
  acceptanceId: string;
}

export interface Attempt {
  itemIdx: number;
  acceptanceId: string;
  side: ImpulseSide;
  ok: boolean;
  peak: number;
  gain: number;
  durMs: number;
  amp: number;
  reasons: string[];
  ts: number;
  /** Impulso ID del sim (correlación con traza). */
  impulseId: number;
  /** Tiempo en ms (relativo al inicio del impulso). */
  traceT: number[];
  /** Velocidad angular de la cabeza (°/s). */
  traceHead: number[];
  /** Velocidad angular del ojo (°/s) para análisis de gain/saccade. */
  traceEye: number[];
}

export interface PresetStats {
  acceptanceId: string;
  attempts: number;
  hits: number;
  required: number;
  peakAvg: number;
  gainAvg: number;
  durAvg: number;
  ampAvg: number;
}

export interface Achievements {
  totalGoals: number;
  totalAttempts: number;
  totalHits: number;
  durationMs: number;
  byPreset: PresetStats[];
  failReasons: Record<string, number>;
  bestPeak: number;
  worstPeak: number;
}

function shuffle<T>(arr: T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

class PracticeStore {
  active = $state(false);
  paused = $state(false);
  bundleId = $state<string | null>(null);
  variant = $state<'horiz' | 'vert'>('horiz');
  /** Modo de finalización del bundle. */
  mode = $state<'attempts' | 'hits'>('attempts');
  /** Requeridos por preset (para modo 'hits'). */
  required = $state<Record<string, number>>({});
  /** Secuencia ordenada o mezclada de items (sólo se usa en modo 'attempts'). */
  sequence = $state<SeqItem[]>([]);
  /** Cursor sobre `sequence` (modo attempts). */
  cursor = $state(0);
  /** Aciertos acumulados por preset (modo hits). */
  hitsByPreset = $state<Record<string, number>>({});
  attempts = $state<Attempt[]>([]);
  startedMs = $state(0);
  endedMs = $state(0);
  /** Nombre del practicante para informe/PDF. */
  practitioner = $state('');

  private prevAcceptanceId: string | null = null;
  private lastSeenImpulseId = 0;
  /** En modo 'hits' la secuencia es virtual: el current se elige de los presets que aún no completaron sus aciertos. */
  private hitsOrder: string[] = [];
  private hitsCursor = 0;
  private hitsRandom = false;

  get current(): SeqItem | null {
    if (!this.active || this.done) return null;
    if (this.mode === 'attempts') return this.sequence[this.cursor] ?? null;
    // hits: tomar el siguiente preset cuyo aciertos < requeridos
    return this.nextPendingHits();
  }

  private nextPendingHits(): SeqItem | null {
    const order = this.hitsOrder;
    if (order.length === 0) return null;
    for (let i = 0; i < order.length; i++) {
      const idx = (this.hitsCursor + i) % order.length;
      const id = order[idx];
      const need = this.required[id] ?? 0;
      const got = this.hitsByPreset[id] ?? 0;
      if (got < need) {
        return { idx, acceptanceId: id };
      }
    }
    return null;
  }

  get done(): boolean {
    if (!this.active) return false;
    if (this.mode === 'attempts') return this.cursor >= this.sequence.length;
    // hits: cuando todos los presets cumplen su required
    for (const id of this.hitsOrder) {
      if ((this.hitsByPreset[id] ?? 0) < (this.required[id] ?? 0)) return false;
    }
    return true;
  }

  get progress() {
    if (this.mode === 'attempts') {
      const total = this.sequence.length;
      return { current: Math.min(this.cursor, total), total };
    }
    let got = 0, need = 0;
    for (const id of this.hitsOrder) {
      need += this.required[id] ?? 0;
      got += Math.min(this.hitsByPreset[id] ?? 0, this.required[id] ?? 0);
    }
    return { current: got, total: need };
  }

  /** Restantes por preset (modo attempts: cuenta items pendientes de la secuencia;
   *  modo hits: required - hits). */
  get remainingByPreset(): Record<string, number> {
    const r: Record<string, number> = {};
    if (this.mode === 'attempts') {
      for (let i = this.cursor; i < this.sequence.length; i++) {
        const id = this.sequence[i].acceptanceId;
        r[id] = (r[id] ?? 0) + 1;
      }
    } else {
      for (const id of this.hitsOrder) {
        r[id] = Math.max(0, (this.required[id] ?? 0) - (this.hitsByPreset[id] ?? 0));
      }
    }
    return r;
  }

  start(b: Escenario, practitioner = '') {
    if (b.kind === 'clinico') return;
    const goals = (b.goals ?? []).filter((g) => g.count > 0);
    if (goals.length === 0) return;

    this.practitioner = practitioner.trim();

    this.bundleId = b.id;
    this.variant = b.kind === 'practica-vert' ? 'vert' : 'horiz';
    this.mode = b.mode ?? 'attempts';

    // Construir secuencia base en orden de la lista del docente.
    const base: SeqItem[] = [];
    let idx = 0;
    for (const g of goals) {
      for (let i = 0; i < g.count; i++) {
        base.push({ idx: idx++, acceptanceId: g.acceptanceId });
      }
    }
    const order = b.order ?? 'random';
    this.sequence = order === 'random' ? shuffle(base).map((x, i) => ({ ...x, idx: i })) : base;
    this.cursor = 0;

    // Para modo 'hits' guardamos required y orden de presentación de presets.
    const req: Record<string, number> = {};
    const hitOrder: string[] = [];
    for (const g of goals) {
      req[g.acceptanceId] = (req[g.acceptanceId] ?? 0) + g.count;
      if (!hitOrder.includes(g.acceptanceId)) hitOrder.push(g.acceptanceId);
    }
    this.required = req;
    this.hitsOrder = order === 'random' ? shuffle(hitOrder) : hitOrder;
    this.hitsRandom = order === 'random';
    this.hitsByPreset = {};
    this.hitsCursor = 0;

    this.attempts = [];
    this.startedMs = Date.now();
    this.endedMs = 0;
    this.prevAcceptanceId = acceptance.activeId;
    this.lastSeenImpulseId = sim.lastImpulse?.id ?? 0;
    this.active = true;
    this.paused = false;
    this.applyCurrentLevel();
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    this.paused = false;
    this.endedMs = Date.now();
    if (this.prevAcceptanceId) acceptance.setActive(this.prevAcceptanceId);
    this.prevAcceptanceId = null;
  }

  reset() {
    this.stop();
    this.sequence = [];
    this.attempts = [];
    this.cursor = 0;
    this.hitsByPreset = {};
    this.hitsCursor = 0;
    this.required = {};
    this.bundleId = null;
    this.startedMs = 0;
    this.endedMs = 0;
  }

  pause() { if (this.active) this.paused = true; }
  resume() {
    if (this.active) {
      this.paused = false;
      // Ignorar impulsos previos a reanudar (los que llegaron mientras pausado).
      this.lastSeenImpulseId = sim.lastImpulse?.id ?? this.lastSeenImpulseId;
      this.applyCurrentLevel();
    }
  }

  consumeImpulse(verdict: Verdict, side: ImpulseSide, impulseId: number, impulse?: Impulse | null) {
    if (!this.active || this.paused || this.done) return;
    if (impulseId <= this.lastSeenImpulseId) return;
    const cur = this.current;
    if (!cur) return;

    const isHoriz = isHorizontalSide(side);
    if (this.variant === 'vert' && isHoriz) return;
    if (this.variant === 'horiz' && !isHoriz) return;

    // Solo marcar consumido si el impulso pasó los filtros y se va a procesar.
    this.lastSeenImpulseId = impulseId;

    const imp = impulse ?? sim.lastImpulse;
    const t0 = imp && imp.t.length > 0 ? imp.t[0] : 0;
    const traceT: number[] = imp ? Array.from(imp.t, (v) => v - t0) : [];
    const traceHead: number[] = imp ? Array.from(imp.head) : [];
    const traceEye: number[] = imp ? Array.from(imp.eye) : [];

    this.attempts = [...this.attempts, {
      itemIdx: cur.idx,
      acceptanceId: cur.acceptanceId,
      side,
      ok: verdict.ok,
      peak: verdict.peak,
      gain: verdict.gain,
      durMs: verdict.durMs,
      amp: verdict.amp,
      reasons: verdict.reasons.slice(),
      ts: Date.now(),
      impulseId,
      traceT,
      traceHead,
      traceEye,
    }];

    if (this.mode === 'attempts') {
      // Cada intento avanza, ok o no.
      this.cursor++;
    } else {
      // hits: solo aciertos avanzan. Los fallos quedan registrados pero no cuentan.
      if (verdict.ok) {
        const newCount = (this.hitsByPreset[cur.acceptanceId] ?? 0) + 1;
        this.hitsByPreset = { ...this.hitsByPreset, [cur.acceptanceId]: newCount };
        // En orden secuencial: solo rotar cuando el preset actual cumplió sus aciertos.
        // En aleatorio: rotar siempre para mezclar presets.
        const need = this.required[cur.acceptanceId] ?? 0;
        const completedThis = newCount >= need;
        const shouldRotate = this.hitsRandom || completedThis;
        if (shouldRotate) {
          this.hitsCursor = (this.hitsCursor + 1) % this.hitsOrder.length;
        }
      }
    }

    if (this.done) {
      this.endedMs = Date.now();
      if (this.prevAcceptanceId) acceptance.setActive(this.prevAcceptanceId);
    } else {
      this.applyCurrentLevel();
    }
  }

  /** Salta el objetivo actual: lo cuenta como intento fallido y pasa al siguiente. */
  skipCurrent() {
    if (!this.active || this.done) return;
    const cur = this.current;
    if (!cur) return;
    this.attempts = [...this.attempts, {
      itemIdx: cur.idx,
      acceptanceId: cur.acceptanceId,
      side: 'LL',
      ok: false,
      peak: 0, gain: 0, durMs: 0, amp: 0,
      reasons: ['saltado por docente'],
      ts: Date.now(),
      impulseId: 0,
      traceT: [],
      traceHead: [],
      traceEye: [],
    }];
    if (this.mode === 'attempts') {
      this.cursor++;
    } else {
      // hits: avanzar cursor de presentación pero sin sumar acierto.
      this.hitsCursor = (this.hitsCursor + 1) % Math.max(1, this.hitsOrder.length);
    }
    if (this.done) {
      this.endedMs = Date.now();
      if (this.prevAcceptanceId) acceptance.setActive(this.prevAcceptanceId);
    } else {
      this.applyCurrentLevel();
    }
  }

  private applyCurrentLevel() {
    const cur = this.current;
    if (!cur) return;
    acceptance.setActive(cur.acceptanceId);
  }

  computeAchievements(): Achievements {
    const att = this.attempts;
    const map = new Map<string, PresetStats>();

    const ensure = (id: string): PresetStats => {
      let s = map.get(id);
      if (!s) {
        s = {
          acceptanceId: id, attempts: 0, hits: 0,
          required: this.required[id] ?? 0,
          peakAvg: 0, gainAvg: 0, durAvg: 0, ampAvg: 0,
        };
        map.set(id, s);
      }
      return s;
    };
    // Pre-cargar presets requeridos aunque no hayan tenido intento.
    for (const id of Object.keys(this.required)) ensure(id);

    const failReasons: Record<string, number> = {};
    let bestPeak = 0;
    let worstPeak = Infinity;

    for (const a of att) {
      const s = ensure(a.acceptanceId);
      s.attempts++;
      if (a.ok) s.hits++;
      s.peakAvg += a.peak;
      s.gainAvg += a.gain;
      s.durAvg += a.durMs;
      s.ampAvg += a.amp;
      if (a.peak > 0) {
        if (a.peak > bestPeak) bestPeak = a.peak;
        if (a.peak < worstPeak) worstPeak = a.peak;
      }
      if (!a.ok) {
        for (const r of a.reasons) {
          const key = r.split(' ')[0];
          failReasons[key] = (failReasons[key] ?? 0) + 1;
        }
      }
    }
    for (const s of map.values()) {
      if (s.attempts > 0) {
        s.peakAvg /= s.attempts;
        s.gainAvg /= s.attempts;
        s.durAvg /= s.attempts;
        s.ampAvg /= s.attempts;
      }
    }
    if (worstPeak === Infinity) worstPeak = 0;

    return {
      totalGoals: this.mode === 'attempts'
        ? this.sequence.length
        : Object.values(this.required).reduce((a, b) => a + b, 0),
      totalAttempts: att.length,
      totalHits: att.filter((a) => a.ok).length,
      durationMs: (this.endedMs || Date.now()) - this.startedMs,
      byPreset: Array.from(map.values()),
      failReasons,
      bestPeak,
      worstPeak,
    };
  }
}

export const practice = new PracticeStore();
