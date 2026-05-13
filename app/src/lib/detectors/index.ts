// Registry de detectores y resolución por nivel.
//
// El pipeline aplica TODOS los detectores activos para un nivel dado, los
// detectores deshabilitados (stubs) no se ejecutan. Esto permite agregar
// nuevos detectores sin tocar el evaluador.

import type { Detector, LevelId } from './types';
import { poseInitialDetector } from './pose-initial';
import { peakVelocityDetector } from './peak-velocity';
import { amplitudeDetector } from './amplitude';
import { durationDetector } from './duration';
import { accelDetector } from './accel';
import {
  overshootDetector,
  oscillationDetector,
  activeMovementDetector,
  fixationLossDetector,
} from './stubs';

export const ALL_DETECTORS: Detector[] = [
  poseInitialDetector,
  peakVelocityDetector,
  amplitudeDetector,
  durationDetector,
  accelDetector,
  overshootDetector,
  oscillationDetector,
  activeMovementDetector,
  fixationLossDetector,
];

export function getDetectorsForLevel(levelId: LevelId): Detector[] {
  return ALL_DETECTORS.filter((d) => d.enabledForLevel(levelId));
}

export { POSE_TARGETS } from './pose-initial';
export type { Detector, DetectorContext, DetectorResult, DetectorSeverity, LevelId } from './types';
