// Cliente de los comandos de análisis del backend (sampling.rs, allan.rs).
// Procesa el CSV cerrado de una sesión de captura.

import { invoke } from '@tauri-apps/api/core';

export type SamplingResult = {
  declared_hz: number;
  measured_hz: number;
  mean_dt_us: number;
  stdev_dt_us: number;
  p50_dt_us: number;
  p99_dt_us: number;
  max_dt_us: number;
  samples_lost_estimate: number;
  histogram_dt_us: [number, number][];
  n_samples: number;
  passes_vhit_criterion: boolean;
};

export type AllanResult = {
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

export type AnalysisState = 'idle' | 'running' | 'done' | 'error';

class AnalysisStore {
  state = $state<AnalysisState>('idle');
  error = $state<string | null>(null);
  sampling = $state<SamplingResult | null>(null);
  allan = $state<AllanResult | null>(null);
  csvPath = $state<string | null>(null);

  async run(csvPath: string, declaredHz: number) {
    this.state = 'running';
    this.error = null;
    this.csvPath = csvPath;
    try {
      const [s, a] = await Promise.all([
        invoke<SamplingResult>('analyze_sampling', {
          config: { csv_path: csvPath, declared_hz: declaredHz },
        }),
        invoke<AllanResult>('analyze_allan_variance', {
          config: {
            csv_path: csvPath,
            min_tau_s: 1.0 / declaredHz,
            max_tau_s: 1000.0,
            n_points: 80,
          },
        }),
      ]);
      this.sampling = s;
      this.allan = a;
      this.state = 'done';
    } catch (e) {
      this.error = String(e);
      this.state = 'error';
    }
  }

  reset() {
    this.state = 'idle';
    this.error = null;
    this.sampling = null;
    this.allan = null;
    this.csvPath = null;
  }
}

export const analysis = new AnalysisStore();
