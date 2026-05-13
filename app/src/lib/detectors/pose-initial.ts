// Detector: validación de pose inicial pre-impulso.
//
// Compara la pose sostenida pre-impulso (yaw/pitch/roll promediados en una
// ventana ~300 ms antes del trigger) contra el objetivo del canal:
//   - Horizontal (LL/RL): yaw=0, pitch=-30° (chin-down), roll=0.
//   - LARP (LA/RP):       yaw=-45°, pitch=0, roll=0.
//   - RALP (RA/LP):       yaw=+45°, pitch=0, roll=0.
//
// Si el error en cualquier eje supera `preset.poseTolDeg`, el detector marca
// 'fail'. Si la pose pre-impulso no está disponible (datos antiguos / mock),
// hace skip con severity='pass' y measured=null.

import type { Channel } from '$lib/scenario.svelte';
import type { Detector, DetectorContext, DetectorResult } from './types';

/** Pose objetivo por canal. El plano horizontal arranca con chin-down -30°
 *  (no neutro 0°): es el setup clínico recomendado para vHIT lateral. */
export const POSE_TARGETS: Record<Channel, { yaw: number; pitch: number; roll: number }> = {
  LL: { yaw: 0,   pitch: -30, roll: 0 },
  RL: { yaw: 0,   pitch: -30, roll: 0 },
  LA: { yaw: -45, pitch:   0, roll: 0 },
  RP: { yaw: -45, pitch:   0, roll: 0 },
  RA: { yaw: +45, pitch:   0, roll: 0 },
  LP: { yaw: +45, pitch:   0, roll: 0 },
};

export const poseInitialDetector: Detector = {
  id: 'pose-initial',
  category: 'pose',
  enabledForLevel: () => true,
  run(ctx: DetectorContext): DetectorResult {
    const tol = ctx.preset.poseTolDeg;
    if (!ctx.preImpulsePose) {
      return {
        id: 'pose-initial',
        severity: 'pass',
        measured: null,
        expected: {},
        message: 'Pose pre-impulso no disponible',
        weight: 0,
      };
    }
    const target = POSE_TARGETS[ctx.channel];
    const dYaw   = ctx.preImpulsePose.yaw   - target.yaw;
    const dPitch = ctx.preImpulsePose.pitch - target.pitch;
    const dRoll  = ctx.preImpulsePose.roll  - target.roll;
    const errMax = Math.max(Math.abs(dYaw), Math.abs(dPitch), Math.abs(dRoll));
    if (errMax > tol) {
      // Identificar el eje más desviado para el mensaje correctivo.
      let axis = 'yaw'; let delta = dYaw;
      if (Math.abs(dPitch) > Math.abs(delta)) { axis = 'pitch'; delta = dPitch; }
      if (Math.abs(dRoll) > Math.abs(delta))  { axis = 'roll';  delta = dRoll; }
      const dir = delta > 0 ? 'positivo' : 'negativo';
      return {
        id: 'pose-initial',
        severity: 'fail',
        measured: errMax,
        expected: { max: tol },
        message: `pose inicial fuera de objetivo (${axis} desviado ${delta.toFixed(1)}° hacia ${dir}, tol ±${tol}°)`,
        weight: 1,
      };
    }
    return {
      id: 'pose-initial',
      severity: 'pass',
      measured: errMax,
      expected: { max: tol },
      message: 'pose inicial OK',
      weight: 1,
    };
  },
};
