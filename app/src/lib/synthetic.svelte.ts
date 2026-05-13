// Validación sintética de los detectores cinemáticos.
//
// Genera impulsos cefálicos paramétricos según docs/trabajo_metricas.md §2.4
// y los pasa por el pipeline de detección real (sin reimplementar). Reporta
// matriz de confusión por detector contra el ground truth derivado del preset
// activo (in-spec vs out-of-spec).
//
// Implementación en TypeScript (no Rust) porque los detectores viven en el
// frontend: una reimplementación en Rust divergería y la validación perdería
// significado. El cómputo es liviano (~ms por celda) y síncrono.

import { acceptance } from './acceptance.svelte';
import type { Impulse, ImpulseSide } from './simulator.svelte';
import { peakVelocityDetector } from './detectors/peak-velocity';
import { durationDetector } from './detectors/duration';
import { amplitudeDetector } from './detectors/amplitude';
import type { Detector, DetectorContext } from './detectors/types';

export type SyntheticConfig = {
  peakVelocitiesDps: number[]; // p.ej. [60, 100, 140, 180, 220, 280]
  durationsMs: number[];        // p.ej. [120, 180, 250, 320]
  noiseLevels: number[];        // fracciones, p.ej. [0, 0.03, 0.08]
  repetitions: number;          // por celda, p.ej. 30
  sampleRateHz: number;         // p.ej. 200
  side?: ImpulseSide;           // canal evaluado, default 'RL'
  seed?: number;                // semilla LCG para reproducibilidad
};

export type ConfusionMatrix = { tp: number; fp: number; tn: number; fn: number };
export type PerDetectorStats = {
  detector: string;
  confusion: ConfusionMatrix;
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  fpr: number;
};

export type SyntheticResult = {
  totalTrials: number;
  inSpecCount: number;
  outOfSpecCount: number;
  perDetector: PerDetectorStats[];
  // Tasa de aceptación global (todos los detectores pass) vs ground truth.
  globalConfusion: ConfusionMatrix;
  durationMs: number;
};

// LCG determinístico — sin dep externa, reproducible bit a bit.
class Lcg {
  private s: bigint;
  constructor(seed: number) {
    this.s = BigInt(seed >>> 0) || 0xC0FFEEn;
  }
  next(): number {
    this.s = (this.s * 6364136223846793005n + 1442695040888963407n) & 0xFFFFFFFFFFFFFFFFn;
    return Number(this.s >> 33n) / 0x80000000;
  }
  normal(): number {
    const u1 = Math.max(this.next(), 1e-12);
    const u2 = this.next();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
}

// Perfil gaussiano modulado con envelope suave (ω→0 en bordes), §2.4.
// Genera trazas con `t` en ms (compatible con duration/amplitude detectors)
// y `head` en °/s. La velocidad pico real puede diferir levemente de la
// objetivo cuando se agrega ruido — eso es deseado para que el detector
// trabaje sobre la señal observada, no la teórica.
function makeImpulse(
  peakDps: number,
  durMs: number,
  noiseRel: number,
  fs: number,
  rng: Lcg,
  side: ImpulseSide,
  id: number,
): Impulse {
  const dtMs = 1000 / fs;
  const totalMs = durMs;
  const n = Math.max(2, Math.round(totalMs / dtMs));
  const t = new Float64Array(n);
  const head = new Float64Array(n);
  const eye = new Float64Array(n);
  const center = totalMs / 2;
  const stddev = totalMs / 6; // ancho σ del perfil gaussiano
  const sign = (side === 'LL' || side === 'LA' || side === 'LP') ? -1 : 1;

  for (let i = 0; i < n; i++) {
    const tt = i * dtMs;
    // Envelope que lleva a cero en bordes: ventana coseno (Hann) suave sobre los
    // 10% extremos para evitar discontinuidades.
    const edge = 0.10 * totalMs;
    let env = 1;
    if (tt < edge)              env = 0.5 * (1 - Math.cos(Math.PI * (tt / edge)));
    else if (tt > totalMs - edge) env = 0.5 * (1 - Math.cos(Math.PI * ((totalMs - tt) / edge)));

    const gauss = Math.exp(-((tt - center) ** 2) / (2 * stddev * stddev));
    const omega = sign * peakDps * env * gauss + (noiseRel > 0 ? noiseRel * peakDps * rng.normal() : 0);
    t[i] = tt;
    head[i] = omega;
    eye[i] = -omega * 0.95; // VOR ideal (gain ≈ 0.95) para no afectar a detectores cinemáticos
  }
  return { id, side, t, head, eye, gain: 0.95 };
}

// Ejecuta el grid completo. Síncrono: con valores típicos (~3000 trials)
// completa en < 1 s en cualquier laptop moderno.
export function runSyntheticValidation(cfg: SyntheticConfig): SyntheticResult {
  const t0 = performance.now();
  const preset = acceptance.active;
  const side: ImpulseSide = cfg.side ?? 'RL';
  const horizontal = side === 'LL' || side === 'RL';
  const peakMin = horizontal ? preset.peakMinH : preset.peakMinV;
  const peakMax = horizontal ? preset.peakMaxH : preset.peakMaxV;
  const durMin = horizontal ? preset.durMinMsH : preset.durMinMsV;
  const durMax = horizontal ? preset.durMaxMsH : preset.durMaxMsV;
  const ampMin = horizontal ? preset.ampMinH : preset.ampMinV;
  // amplitudeDetector usa yawTol/pitchTol como techo del rango aceptable.
  const ampMax = horizontal ? preset.yawTol : preset.pitchTol;

  const detectors: Detector[] = [peakVelocityDetector, durationDetector, amplitudeDetector];
  const conf: Record<string, ConfusionMatrix> = {};
  for (const d of detectors) conf[d.id] = { tp: 0, fp: 0, tn: 0, fn: 0 };
  const global: ConfusionMatrix = { tp: 0, fp: 0, tn: 0, fn: 0 };

  const rng = new Lcg(cfg.seed ?? 0xC0FFEE);
  let total = 0;
  let inSpecCount = 0;

  let idCounter = 1;
  for (const vp of cfg.peakVelocitiesDps) {
    for (const dur of cfg.durationsMs) {
      for (const noise of cfg.noiseLevels) {
        for (let r = 0; r < cfg.repetitions; r++) {
          const imp = makeImpulse(vp, dur, noise, cfg.sampleRateHz, rng, side, idCounter++);
          const ctx: DetectorContext = { impulse: imp, channel: side, preset };
          // Ground truth: el impulso "como pedido" cumple los rangos clínicos.
          // Aproximación de amplitud: ∫|ω| ≈ vp·dur·(√(2π)·σ/dur)·env ≈ vp·dur·0.42 (para σ=dur/6).
          const approxAmp = vp * (dur / 1000) * 0.42;
          const truthInSpec = vp >= peakMin && vp <= peakMax
            && dur >= durMin && dur <= durMax
            && approxAmp >= ampMin && approxAmp <= ampMax;
          if (truthInSpec) inSpecCount++;
          total++;

          let allPass = true;
          for (const d of detectors) {
            const res = d.run(ctx);
            const pred = res.severity === 'pass';
            const c = conf[d.id];
            // Para cada detector, la verdad es: ¿este detector debería aceptar?
            // Eso depende solo de su dimensión, no de la conjunción.
            let dTruth: boolean;
            if (d.id === 'peak-velocity') dTruth = vp >= peakMin && vp <= peakMax;
            else if (d.id === 'duration') dTruth = dur >= durMin && dur <= durMax;
            else if (d.id === 'amplitude') dTruth = approxAmp >= ampMin && approxAmp <= ampMax;
            else dTruth = truthInSpec;

            if (pred && dTruth) c.tp++;
            else if (pred && !dTruth) c.fp++;
            else if (!pred && dTruth) c.fn++;
            else c.tn++;
            if (!pred) allPass = false;
          }
          if (allPass && truthInSpec) global.tp++;
          else if (allPass && !truthInSpec) global.fp++;
          else if (!allPass && truthInSpec) global.fn++;
          else global.tn++;
        }
      }
    }
  }

  const perDetector: PerDetectorStats[] = detectors.map((d) => statsFrom(d.id, conf[d.id]));
  return {
    totalTrials: total,
    inSpecCount,
    outOfSpecCount: total - inSpecCount,
    perDetector,
    globalConfusion: global,
    durationMs: performance.now() - t0,
  };
}

function statsFrom(name: string, c: ConfusionMatrix): PerDetectorStats {
  const denomAcc = c.tp + c.tn + c.fp + c.fn || 1;
  const accuracy = (c.tp + c.tn) / denomAcc;
  const precision = c.tp + c.fp > 0 ? c.tp / (c.tp + c.fp) : 1;
  const recall = c.tp + c.fn > 0 ? c.tp / (c.tp + c.fn) : 1;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const fpr = c.fp + c.tn > 0 ? c.fp / (c.fp + c.tn) : 0;
  return { detector: name, confusion: c, accuracy, precision, recall, f1, fpr };
}

// Store ligero para integrar al UI de /metricas.
class SyntheticStore {
  state = $state<'idle' | 'running' | 'done' | 'error'>('idle');
  result = $state<SyntheticResult | null>(null);
  error = $state<string | null>(null);

  // Defaults razonables: cubre el rango clínico relevante con grid moderado.
  defaultConfig(): SyntheticConfig {
    return {
      peakVelocitiesDps: [60, 100, 140, 180, 220, 280],
      durationsMs: [120, 180, 250, 320],
      noiseLevels: [0, 0.03, 0.08],
      repetitions: 30,
      sampleRateHz: 200,
      side: 'RL',
      seed: 0xC0FFEE,
    };
  }

  async run(cfg?: Partial<SyntheticConfig>) {
    this.state = 'running';
    this.error = null;
    try {
      // Ceder al event loop para que la UI alcance a mostrar el spinner.
      await new Promise((r) => setTimeout(r, 16));
      const full: SyntheticConfig = { ...this.defaultConfig(), ...(cfg ?? {}) };
      this.result = runSyntheticValidation(full);
      this.state = 'done';
    } catch (e) {
      this.error = String(e);
      this.state = 'error';
    }
  }

  reset() {
    this.state = 'idle';
    this.result = null;
    this.error = null;
  }
}

export const synthetic = new SyntheticStore();
