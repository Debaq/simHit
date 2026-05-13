// Tipos comunes del pipeline de detectores.
//
// Cada detector evalúa UNA dimensión del impulso (pose inicial, velocidad pico,
// amplitud, duración, aceleración, overshoot, oscilación, etc.) y devuelve un
// `DetectorResult` independiente. La aceptación global es la conjunción de los
// resultados de severidad ≠ 'fail'.

import type { Channel } from '$lib/scenario.svelte';
import type { Impulse } from '$lib/simulator.svelte';
import type { AcceptancePreset } from '$lib/acceptance.svelte';

export type DetectorSeverity = 'pass' | 'warn' | 'fail';

/** Identificador del nivel de aceptación. Los builtin son slugs estables
 *  (inicial/basico/estandar/avanzado); los custom usan IDs `cu_*`. */
export type LevelId = 'inicial' | 'basico' | 'estandar' | 'avanzado' | string;

export interface DetectorResult {
  /** ID estable del detector (e.g. 'pose-initial', 'peak-velocity'). */
  id: string;
  severity: DetectorSeverity;
  /** Valor medido (si aplica). null cuando el detector no pudo medir. */
  measured: number | null;
  /** Rango esperado para el reporte. Ambos opcionales. */
  expected: { min?: number; max?: number };
  /** Mensaje legible en español neutro para el reporte/UI. */
  message: string;
  /** Peso relativo del detector en el score global (0..1). 0 = informativo. */
  weight: number;
}

export interface DetectorContext {
  impulse: Impulse;
  channel: Channel;
  preset: AcceptancePreset;
  /** Pose pre-impulso (promedio de una ventana ~300 ms antes del trigger).
   *  Si está undefined, el detector de pose hace skip silencioso. */
  preImpulsePose?: { yaw: number; pitch: number; roll: number };
}

export interface Detector {
  id: string;
  category: 'kinematic' | 'pose' | 'artifact' | 'behavioral';
  /** Si false para el level activo, el pipeline lo salta. */
  enabledForLevel: (levelId: LevelId) => boolean;
  run(ctx: DetectorContext): DetectorResult;
}
