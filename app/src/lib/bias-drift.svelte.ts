// Monitor de drift del bias del giroscopio durante una sesión.
//
// Premisa: el firmware ya emite gyro post-bias (le restó gx_bias del IMU CAL).
// Si en una ventana sostenida de quietud (todos los ejes |gyro| < umbral
// durante > 2 s) el promedio NO es ≈ 0, eso indica que el bias derivó
// desde la última CAL — típicamente por temperatura.
//
// El monitor corre client-side enganchado al captureSink de serial; no
// requiere cambios en firmware. Saltar a alertar 'aged' o 'thermal-drift'
// debería bastar para que el clínico recalibre antes de notar el drift.

import { serial, type RawSample } from './serial.svelte';

// "Quietud": cada eje |gyro_dps| < este umbral.
const QUIET_THRESHOLD_DPS = 1.5;
// Ventana sostenida mínima para considerar la quietud válida.
const QUIET_WINDOW_S = 2.0;
// Si el promedio en la ventana excede este valor (módulo por eje), drift.
const DRIFT_FLAG_DPS = 0.3;
// Resampling esperado para dimensionar el ring buffer.
const ASSUMED_RATE_HZ = 200;

class BiasDriftMonitor {
  enabled = $state(false);
  // Última ventana de quietud detectada — promedio gyro por eje (°/s).
  // Si alguno está por encima de DRIFT_FLAG_DPS, drift.
  lastQuietMean = $state<[number, number, number] | null>(null);
  lastQuietTimeMs = $state<number | null>(null);
  driftDetected = $state(false);
  // Pico de drift detectado en la sesión actual (worst-case por eje).
  driftPeak = $state<[number, number, number]>([0, 0, 0]);

  private unsubscribe: (() => void) | null = null;
  private ringSum: [number, number, number] = [0, 0, 0];
  private ring: Array<{ gx: number; gy: number; gz: number }> = [];
  private ringMax = Math.ceil(QUIET_WINDOW_S * ASSUMED_RATE_HZ);

  start() {
    if (this.enabled) return;
    this.enabled = true;
    this.unsubscribe = serial.addCaptureSink((s) => this.onSample(s));
  }

  stop() {
    if (this.unsubscribe) { this.unsubscribe(); this.unsubscribe = null; }
    this.enabled = false;
    this.ring = [];
    this.ringSum = [0, 0, 0];
  }

  reset() {
    this.ring = [];
    this.ringSum = [0, 0, 0];
    this.lastQuietMean = null;
    this.lastQuietTimeMs = null;
    this.driftDetected = false;
    this.driftPeak = [0, 0, 0];
  }

  private onSample(s: RawSample) {
    // Filtrar muestras no-quietas: si cualquier eje excede el umbral,
    // descartar el ring entero (no es una ventana de quietud).
    if (Math.abs(s.gx) > QUIET_THRESHOLD_DPS
        || Math.abs(s.gy) > QUIET_THRESHOLD_DPS
        || Math.abs(s.gz) > QUIET_THRESHOLD_DPS) {
      this.ring = [];
      this.ringSum = [0, 0, 0];
      return;
    }
    this.ring.push({ gx: s.gx, gy: s.gy, gz: s.gz });
    this.ringSum[0] += s.gx; this.ringSum[1] += s.gy; this.ringSum[2] += s.gz;
    if (this.ring.length > this.ringMax) {
      const old = this.ring.shift()!;
      this.ringSum[0] -= old.gx; this.ringSum[1] -= old.gy; this.ringSum[2] -= old.gz;
    }
    if (this.ring.length === this.ringMax) {
      const n = this.ring.length;
      const mx = this.ringSum[0] / n;
      const my = this.ringSum[1] / n;
      const mz = this.ringSum[2] / n;
      this.lastQuietMean = [mx, my, mz];
      this.lastQuietTimeMs = Date.now();
      const hit = Math.abs(mx) > DRIFT_FLAG_DPS
                || Math.abs(my) > DRIFT_FLAG_DPS
                || Math.abs(mz) > DRIFT_FLAG_DPS;
      if (hit) {
        this.driftDetected = true;
        this.driftPeak = [
          Math.max(this.driftPeak[0], Math.abs(mx)),
          Math.max(this.driftPeak[1], Math.abs(my)),
          Math.max(this.driftPeak[2], Math.abs(mz)),
        ];
      }
    }
  }
}

export const biasDrift = new BiasDriftMonitor();
