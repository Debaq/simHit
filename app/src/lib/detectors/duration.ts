// Detector: duración total del impulso (ms).

import { isHorizontalSide } from '$lib/simulator.svelte';
import type { Detector, DetectorContext, DetectorResult } from './types';

export const durationDetector: Detector = {
  id: 'duration',
  category: 'kinematic',
  enabledForLevel: () => true,
  run(ctx: DetectorContext): DetectorResult {
    const horiz = isHorizontalSide(ctx.channel);
    const min = horiz ? ctx.preset.durMinMsH : ctx.preset.durMinMsV;
    const max = horiz ? ctx.preset.durMaxMsH : ctx.preset.durMaxMsV;
    const t = ctx.impulse.t;
    const durMs = t.length ? t[t.length - 1] - t[0] : 0;
    const ok = durMs >= min && durMs <= max;
    return {
      id: 'duration',
      severity: ok ? 'pass' : 'fail',
      measured: durMs,
      expected: { min, max },
      message: ok
        ? 'duración OK'
        : `duración ${durMs.toFixed(0)} fuera de ${min}–${max} ms`,
      weight: 1,
    };
  },
};
