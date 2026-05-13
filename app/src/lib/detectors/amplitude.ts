// Detector: amplitud (desplazamiento angular) del impulso.
//
// Integra |velocidad| trapezoidalmente para obtener el desplazamiento angular
// (°) y verifica que esté dentro del rango ampMin* (mínimo eficaz) y
// yawTol/pitchTol (máximo permitido en zona verde).

import { isHorizontalSide } from '$lib/simulator.svelte';
import type { Detector, DetectorContext, DetectorResult } from './types';

function integrateAmplitude(t: Float64Array, head: Float64Array): number {
  if (t.length < 2) return 0;
  let acc = 0;
  for (let i = 1; i < t.length; i++) {
    const dt = (t[i] - t[i - 1]) / 1000; // ms -> s
    acc += 0.5 * (Math.abs(head[i]) + Math.abs(head[i - 1])) * dt;
  }
  return acc;
}

export const amplitudeDetector: Detector = {
  id: 'amplitude',
  category: 'kinematic',
  enabledForLevel: () => true,
  run(ctx: DetectorContext): DetectorResult {
    const horiz = isHorizontalSide(ctx.channel);
    const min = horiz ? ctx.preset.ampMinH : ctx.preset.ampMinV;
    const max = horiz ? ctx.preset.yawTol  : ctx.preset.pitchTol;
    const amp = integrateAmplitude(ctx.impulse.t, ctx.impulse.head);
    const ok = amp >= min && amp <= max;
    return {
      id: 'amplitude',
      severity: ok ? 'pass' : 'fail',
      measured: amp,
      expected: { min, max },
      message: ok
        ? 'desplazamiento OK'
        : `despl. ${amp.toFixed(1)} fuera de ${min}–${max} °`,
      weight: 1,
    };
  },
};
