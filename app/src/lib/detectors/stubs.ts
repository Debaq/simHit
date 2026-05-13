// Detectores stub: declarados para el pipeline pero sin lógica real.
// Cada uno devuelve severity='pass' con peso 0 (no influye en el veredicto).
// La implementación real queda pendiente para milestones futuros.

import type { Detector, DetectorContext, DetectorResult } from './types';

function passStub(id: string, message: string): DetectorResult {
  return { id, severity: 'pass', measured: null, expected: {}, message, weight: 0 };
}

// TODO: implementar en milestone X (detección de rebote post-impulso).
export const overshootDetector: Detector = {
  id: 'overshoot',
  category: 'kinematic',
  enabledForLevel: () => false,
  run(_ctx: DetectorContext): DetectorResult {
    return passStub('overshoot', 'overshoot no evaluado (stub)');
  },
};

// TODO: implementar en milestone X (oscilación residual / múltiples picos).
export const oscillationDetector: Detector = {
  id: 'oscillation',
  category: 'kinematic',
  enabledForLevel: () => false,
  run(_ctx: DetectorContext): DetectorResult {
    return passStub('oscillation', 'oscilación no evaluada (stub)');
  },
};

// TODO: implementar en milestone X (movimiento activo del paciente,
// no impulso pasivo del examinador).
export const activeMovementDetector: Detector = {
  id: 'active-movement',
  category: 'behavioral',
  enabledForLevel: () => false,
  run(_ctx: DetectorContext): DetectorResult {
    return passStub('active-movement', 'movimiento activo no evaluado (stub)');
  },
};

// TODO: implementar en milestone X (pérdida de fijación visual durante el hit).
export const fixationLossDetector: Detector = {
  id: 'fixation-loss',
  category: 'artifact',
  enabledForLevel: () => false,
  run(_ctx: DetectorContext): DetectorResult {
    return passStub('fixation-loss', 'pérdida de fijación no evaluada (stub)');
  },
};
