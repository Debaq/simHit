// Detector: aceleración pico estimada a partir de la derivada de la velocidad
// del impulso. Si el preset tiene accelMin*/accelMax* en null para el plano
// correspondiente, el detector se salta (skip silencioso con severity='pass'
// y peso 0).

import { isHorizontalSide } from '$lib/simulator.svelte';
import type { Detector, DetectorContext, DetectorResult } from './types';

function peakAccel(t: Float64Array, head: Float64Array): number {
  if (t.length < 2) return 0;
  let peak = 0;
  for (let i = 1; i < t.length; i++) {
    const dt = (t[i] - t[i - 1]) / 1000; // ms -> s
    if (dt <= 0) continue;
    const a = Math.abs((head[i] - head[i - 1]) / dt);
    if (a > peak) peak = a;
  }
  return peak;
}

export const accelDetector: Detector = {
  id: 'accel',
  category: 'kinematic',
  // El nivel inicial define accel*=null → skip; los demás lo evalúan.
  enabledForLevel: () => true,
  run(ctx: DetectorContext): DetectorResult {
    const horiz = isHorizontalSide(ctx.channel);
    const min = horiz ? ctx.preset.accelMinH : ctx.preset.accelMinV;
    const max = horiz ? ctx.preset.accelMaxH : ctx.preset.accelMaxV;
    if (min === null || max === null) {
      return {
        id: 'accel',
        severity: 'pass',
        measured: null,
        expected: {},
        message: 'aceleración no evaluada (nivel sin rango)',
        weight: 0,
      };
    }
    const a = peakAccel(ctx.impulse.t, ctx.impulse.head);
    const ok = a >= min && a <= max;
    return {
      id: 'accel',
      severity: ok ? 'pass' : 'fail',
      measured: a,
      expected: { min, max },
      message: ok
        ? 'aceleración OK'
        : `aceleración ${a.toFixed(0)} fuera de ${min}–${max} °/s²`,
      weight: 1,
    };
  },
};
