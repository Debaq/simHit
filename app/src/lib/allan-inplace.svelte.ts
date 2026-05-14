// Allan variance corto in-situ post-CAL.
//
// Tras una IMU CAL exitosa el sensor está estático y caliente. Acumular N
// segundos extra de muestras permite computar ARW y bias instability en el
// momento, sin requerir la sesión completa del módulo de métricas.
//
// El cómputo va al backend (analyze_allan_in_place) que reusa el motor de
// allan.rs ya validado. Acá solo recolectamos del sink de serial.

import { invoke } from '@tauri-apps/api/core';
import { serial, type RawSample } from './serial.svelte';

export type AllanInPlaceResult = {
  tau_s: number[];
  sigma_x_dps: number[];
  sigma_y_dps: number[];
  sigma_z_dps: number[];
  arw_deg_sqrt_hr: [number, number, number];
  bias_instability_deg_hr: [number, number, number];
  tau_at_min_s: [number, number, number];
  n_samples_total: number;
  duration_s: number;
  sample_rate_hz: number;
};

export type AllanInPlaceStage = 'idle' | 'collecting' | 'computing' | 'done' | 'error';

class AllanInPlaceStore {
  stage = $state<AllanInPlaceStage>('idle');
  // Progreso 0..1 durante 'collecting'.
  progress = $state(0);
  collectedSamples = $state(0);
  result = $state<AllanInPlaceResult | null>(null);
  error = $state<string | null>(null);

  private unsubscribe: (() => void) | null = null;

  // Captura `seconds` segundos de muestras del firmware estático, después
  // delega al backend Rust para computar Allan overlapping. La gafa debe estar
  // INMÓVIL durante toda la ventana — no se valida acá, es responsabilidad
  // del flujo previo (IMU CAL ya garantizó quietud al momento t=0).
  async run(seconds: number = 10): Promise<AllanInPlaceResult | null> {
    if (this.stage === 'collecting' || this.stage === 'computing') {
      throw new Error('Allan in-situ ya en curso');
    }
    if (!serial.connected) {
      this.fail('SimHIT no está conectado');
      return null;
    }
    this.reset();

    // Recolección: buffer en memoria. Para 10 s a 200 Hz = 2000 muestras
    // × 4 floats × 8B ≈ 64 KiB. Holgado.
    const ts: number[] = [];
    const gx: number[] = [];
    const gy: number[] = [];
    const gz: number[] = [];
    let tsZeroMs: number | null = null;
    let lastTsUs = -1;

    this.stage = 'collecting';
    const sink = (s: RawSample) => {
      let tsUs: number;
      if (s.tsMs > 0) {
        if (tsZeroMs === null) tsZeroMs = s.tsMs;
        tsUs = Math.round((s.tsMs - tsZeroMs) * 1000);
      } else {
        // Fallback: wall-clock relativa (legacy sin tsMs).
        tsUs = (ts.length === 0 ? 0 : ts[ts.length - 1] + 5000);
      }
      // Monotonicidad estricta para satisfacer el chequeo del backend.
      if (tsUs <= lastTsUs) tsUs = lastTsUs + 1;
      lastTsUs = tsUs;
      ts.push(tsUs);
      gx.push(s.gx);
      gy.push(s.gy);
      gz.push(s.gz);
      this.collectedSamples = ts.length;
    };
    this.unsubscribe = serial.addCaptureSink(sink);

    const tStart = Date.now();
    const total = seconds * 1000;
    while (Date.now() - tStart < total) {
      this.progress = Math.min(1, (Date.now() - tStart) / total);
      await new Promise((r) => setTimeout(r, 100));
    }
    this.progress = 1;

    if (this.unsubscribe) { this.unsubscribe(); this.unsubscribe = null; }

    if (ts.length < 200) {
      this.fail(`Pocas muestras (${ts.length}). ¿La gafa estaba emitiendo IMU?`);
      return null;
    }

    this.stage = 'computing';
    try {
      // Configuración: τ desde 1/fs hasta la mitad de la ventana, 30 puntos.
      // El backend valida que max_tau_s ≤ duration/2.5 y ajusta si hace falta.
      const fs = ts.length / seconds;
      const result = await invoke<AllanInPlaceResult>('analyze_allan_in_place', {
        config: {
          timestamps_us: ts,
          gx_dps: gx, gy_dps: gy, gz_dps: gz,
          min_tau_s: 1.0 / fs,
          max_tau_s: seconds / 3,
          n_points: 30,
        },
      });
      this.result = result;
      this.stage = 'done';
      return result;
    } catch (e) {
      this.fail(String(e));
      return null;
    }
  }

  reset() {
    if (this.unsubscribe) { this.unsubscribe(); this.unsubscribe = null; }
    this.stage = 'idle';
    this.progress = 0;
    this.collectedSamples = 0;
    this.result = null;
    this.error = null;
  }

  private fail(msg: string) {
    if (this.unsubscribe) { this.unsubscribe(); this.unsubscribe = null; }
    this.error = msg;
    this.stage = 'error';
  }
}

export const allanInPlace = new AllanInPlaceStore();
