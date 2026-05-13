// Pipeline de evaluación de impulsos.
//
// Ejecuta todos los detectores activos para el nivel del preset y consolida
// el resultado. La aceptación global es `failed.length === 0` (cualquier
// detector en severity='fail' invalida el impulso).
//
// `score` es un promedio ponderado simple: 1.0 si todos pass, 0 si todos fail.
// Detectores con weight=0 no aportan al score (informativos).

import { getDetectorsForLevel } from './index';
import type { DetectorContext, DetectorResult } from './types';

export interface PipelineResult {
  accepted: boolean;
  results: DetectorResult[];
  failed: DetectorResult[];
  warnings: DetectorResult[];
  score: number;
  /** True si específicamente el detector de pose inicial falló. */
  invalidPose: boolean;
}

function weightedScore(results: DetectorResult[]): number {
  let totalW = 0;
  let sumW = 0;
  for (const r of results) {
    if (r.weight <= 0) continue;
    totalW += r.weight;
    if (r.severity === 'pass') sumW += r.weight;
    else if (r.severity === 'warn') sumW += r.weight * 0.5;
  }
  return totalW === 0 ? 1 : sumW / totalW;
}

export function evaluateImpulsePipeline(ctx: DetectorContext): PipelineResult {
  const detectors = getDetectorsForLevel(ctx.preset.id);
  const results: DetectorResult[] = [];
  for (const d of detectors) {
    results.push(d.run(ctx));
  }
  const failed   = results.filter((r) => r.severity === 'fail');
  const warnings = results.filter((r) => r.severity === 'warn');
  const invalidPose = failed.some((r) => r.id === 'pose-initial');
  return {
    accepted: failed.length === 0,
    results,
    failed,
    warnings,
    score: weightedScore(results),
    invalidPose,
  };
}
