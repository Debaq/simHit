// Detector: aceleración angular pico. Si el firmware extendido entregó
// muestras durante el impulso (impulse.angAcc), usa el pico de esa serie;
// si no, hace skip silencioso con severity='pass' y weight=0. El skip por
// firmware legacy es informativo, no marca el impulso como fallido.
//
// Si el preset tiene accelMin*/accelMax* en null para el plano correspondiente,
// también hace skip silencioso.

import { isHorizontalSide } from '$lib/simulator.svelte';
import type { Detector, DetectorContext, DetectorResult } from './types';

function peakAbs(arr: Float64Array): number {
  let peak = 0;
  for (let i = 0; i < arr.length; i++) {
    const v = Math.abs(arr[i]);
    if (v > peak) peak = v;
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
    const angAcc = ctx.impulse.angAcc;
    if (!angAcc || angAcc.length === 0) {
      // Firmware legacy (sin aceleración angular en el stream) o impulso
      // simulado: el detector se omite. No invalida el impulso.
      return {
        id: 'accel',
        severity: 'pass',
        measured: null,
        expected: { min, max },
        message: 'aceleración no disponible en este firmware',
        weight: 0,
      };
    }
    const a = peakAbs(angAcc);
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
