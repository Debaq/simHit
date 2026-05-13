// Detector: velocidad pico del impulso.
//
// Compara el peak de |head| contra los rangos peakMinH/MaxH o peakMinV/MaxV
// del preset, según el plano (horizontal vs vertical).

import { isHorizontalSide } from '$lib/simulator.svelte';
import type { Detector, DetectorContext, DetectorResult } from './types';

export const peakVelocityDetector: Detector = {
  id: 'peak-velocity',
  category: 'kinematic',
  enabledForLevel: () => true,
  run(ctx: DetectorContext): DetectorResult {
    const horiz = isHorizontalSide(ctx.channel);
    const min = horiz ? ctx.preset.peakMinH : ctx.preset.peakMinV;
    const max = horiz ? ctx.preset.peakMaxH : ctx.preset.peakMaxV;
    const head = ctx.impulse.head;
    let peak = 0;
    for (let i = 0; i < head.length; i++) {
      const v = Math.abs(head[i]);
      if (v > peak) peak = v;
    }
    const ok = peak >= min && peak <= max;
    return {
      id: 'peak-velocity',
      severity: ok ? 'pass' : 'fail',
      measured: peak,
      expected: { min, max },
      message: ok
        ? 'pico OK'
        : `pico ${peak.toFixed(0)} fuera de ${min}–${max} °/s`,
      weight: 1,
    };
  },
};
