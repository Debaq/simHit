// Cliente del módulo de captura del backend (src-tauri/src/metrics/capture.rs).
//
// Responsabilidad: registrar un sumidero en el serial store, bufferear muestras
// en memoria, y enviarlas a Rust en batches para minimizar overhead de IPC.
// Rust se encarga de persistir CSV + SHA-256 + session.json.

import { invoke } from '@tauri-apps/api/core';
import { downloadDir } from '@tauri-apps/api/path';
import { serial, type RawSample } from './serial.svelte';

export type CaptureStage = 'idle' | 'preheat' | 'recording' | 'flushing' | 'done' | 'error';

export type StartConfig = {
  durationSeconds: number;
  preheatSeconds: number;
  sensorLabel: string;
  ambientTempC: number;
  sampleRateHz: number;
  outputDir?: string;
};

type StartReply = {
  id: string;
  csv_path: string;
  metadata_path: string;
  started_at_utc: string;
};

type Progress = {
  session_id: string;
  elapsed_s: number;
  total_s: number;
  samples_written: number;
  samples_lost: number;
  bytes_written: number;
};

type Summary = {
  session_id: string;
  csv_path: string;
  metadata_path: string;
  samples_written: number;
  samples_lost: number;
  bytes_written: number;
  duration_s: number;
  csv_sha256: string;
  status: string;
};

type BackendSample = {
  timestamp_us: number;
  gyro_x_dps: number;
  gyro_y_dps: number;
  gyro_z_dps: number;
  accel_x_g: number;
  accel_y_g: number;
  accel_z_g: number;
  mag_x_ut: number | null;
  mag_y_ut: number | null;
  mag_z_ut: number | null;
  temp_c: number | null;
};

const G = 9.80665;
const BATCH_INTERVAL_MS = 250;

class CaptureStore {
  stage = $state<CaptureStage>('idle');
  sessionId = $state<string | null>(null);
  csvPath = $state<string | null>(null);
  metadataPath = $state<string | null>(null);

  preheatElapsed = $state(0);
  preheatTotal = $state(0);
  recElapsed = $state(0);
  recTotal = $state(0);

  samplesWritten = $state(0);
  samplesLost = $state(0);
  bytesWritten = $state(0);

  summary = $state<Summary | null>(null);
  error = $state<string | null>(null);

  // Buffers / handles internos.
  private buffer: BackendSample[] = [];
  private unsubscribeSink: (() => void) | null = null;
  private tsZeroMs: number | null = null;
  // Rate-limit de timestamp: si el firmware repite o retrocede, dejamos pasar
  // la muestra pero respetamos el orden mínimo de 1µs para el CSV.
  private lastTsUs = -1;
  private wallClockBaseMs = 0; // para legacy sin timestamp del firmware
  private preheatTimer: ReturnType<typeof setInterval> | null = null;
  private recTimer: ReturnType<typeof setInterval> | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private progressTimer: ReturnType<typeof setInterval> | null = null;

  async start(cfg: StartConfig) {
    if (this.stage !== 'idle' && this.stage !== 'done' && this.stage !== 'error') {
      throw new Error('Captura ya en curso');
    }
    if (!serial.connected) {
      throw new Error('SimHIT no está conectado');
    }
    this.reset();

    const outputDir = cfg.outputDir ?? (await downloadDir());

    this.stage = 'preheat';
    this.preheatTotal = cfg.preheatSeconds;
    this.recTotal = cfg.durationSeconds;

    if (cfg.preheatSeconds > 0) {
      await this.runPreheat(cfg.preheatSeconds);
    }

    // Iniciar sesión en backend ya con todo configurado.
    const reply = await invoke<StartReply>('start_static_capture', {
      config: {
        duration_seconds: cfg.durationSeconds,
        output_dir: outputDir,
        sensor_label: cfg.sensorLabel,
        ambient_temp_c_start: cfg.ambientTempC,
        preheat_minutes: Math.round(cfg.preheatSeconds / 60),
        serial_port: serial.portPath ?? '',
        baud_rate: 460800,
        sample_rate_declared_hz: cfg.sampleRateHz,
        firmware_version: serial.firmwareVersion,
      },
    });
    this.sessionId = reply.id;
    this.csvPath = reply.csv_path;
    this.metadataPath = reply.metadata_path;

    this.stage = 'recording';
    this.tsZeroMs = null;
    this.wallClockBaseMs = Date.now();

    // Suscribirse al stream serial.
    this.unsubscribeSink = serial.addCaptureSink((s) => this.onSample(s));

    // Flush periódico a Rust.
    this.flushTimer = setInterval(() => { void this.flushBuffer(); }, BATCH_INTERVAL_MS);

    // Reloj de grabación + poll de progreso desde backend.
    this.recElapsed = 0;
    this.recTimer = setInterval(() => {
      this.recElapsed += 0.25;
      if (this.recElapsed >= cfg.durationSeconds) {
        void this.stop('complete');
      }
    }, 250);
    this.progressTimer = setInterval(() => { void this.pollProgress(); }, 1000);
  }

  // Detener manualmente. Si la captura llegó a término natural, llamar con
  // 'complete'; si fue interrumpida (USB desconectado, cancelación), 'incomplete'.
  async stop(status: 'complete' | 'incomplete' = 'complete') {
    if (this.stage !== 'recording' && this.stage !== 'flushing') return;
    this.stage = 'flushing';
    this.stopTimers();
    if (this.unsubscribeSink) {
      this.unsubscribeSink();
      this.unsubscribeSink = null;
    }
    // Flush final del buffer pendiente.
    await this.flushBuffer();

    try {
      const summary = await invoke<Summary>('stop_capture', {
        sessionId: this.sessionId,
        status,
      });
      this.summary = summary;
      this.samplesWritten = summary.samples_written;
      this.samplesLost = summary.samples_lost;
      this.bytesWritten = summary.bytes_written;
      this.stage = 'done';
    } catch (e) {
      this.error = String(e);
      this.stage = 'error';
    }
  }

  // Cancelación rápida (no espera al backend). Útil si el frontend detecta
  // desconexión del USB y quiere abortar limpiamente.
  async cancel() {
    await this.stop('incomplete');
  }

  reset() {
    this.stopTimers();
    if (this.unsubscribeSink) { this.unsubscribeSink(); this.unsubscribeSink = null; }
    this.buffer = [];
    this.tsZeroMs = null;
    this.lastTsUs = -1;
    this.preheatElapsed = 0;
    this.recElapsed = 0;
    this.samplesWritten = 0;
    this.samplesLost = 0;
    this.bytesWritten = 0;
    this.sessionId = null;
    this.csvPath = null;
    this.metadataPath = null;
    this.summary = null;
    this.error = null;
    this.stage = 'idle';
  }

  // ───────── internos ─────────

  private stopTimers() {
    if (this.preheatTimer) { clearInterval(this.preheatTimer); this.preheatTimer = null; }
    if (this.recTimer) { clearInterval(this.recTimer); this.recTimer = null; }
    if (this.flushTimer) { clearInterval(this.flushTimer); this.flushTimer = null; }
    if (this.progressTimer) { clearInterval(this.progressTimer); this.progressTimer = null; }
  }

  private runPreheat(seconds: number): Promise<void> {
    return new Promise((resolve) => {
      this.preheatElapsed = 0;
      this.preheatTimer = setInterval(() => {
        this.preheatElapsed += 1;
        if (this.preheatElapsed >= seconds) {
          if (this.preheatTimer) { clearInterval(this.preheatTimer); this.preheatTimer = null; }
          resolve();
        }
      }, 1000);
    });
  }

  private onSample(s: RawSample) {
    // Timestamp en µs relativo a la primera muestra de la sesión.
    let tsUs: number;
    if (s.tsMs > 0) {
      if (this.tsZeroMs === null) this.tsZeroMs = s.tsMs;
      tsUs = Math.round((s.tsMs - this.tsZeroMs) * 1000);
    } else {
      tsUs = (Date.now() - this.wallClockBaseMs) * 1000;
    }
    // Forzar monotonicidad estricta para mantener la integridad del CSV.
    if (tsUs <= this.lastTsUs) tsUs = this.lastTsUs + 1;
    this.lastTsUs = tsUs;

    this.buffer.push({
      timestamp_us: tsUs,
      gyro_x_dps: s.gx, gyro_y_dps: s.gy, gyro_z_dps: s.gz,
      accel_x_g: s.lax / G, accel_y_g: s.lay / G, accel_z_g: s.laz / G,
      mag_x_ut: null, mag_y_ut: null, mag_z_ut: null,
      temp_c: null,
    });
  }

  private async flushBuffer() {
    if (!this.sessionId || this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];
    try {
      await invoke<number>('append_samples', {
        sessionId: this.sessionId,
        samples: batch,
      });
    } catch (e) {
      console.error('[capture] append_samples falló', e);
      // Re-encolar para reintentar en el próximo flush. Si el backend está
      // muerto, el siguiente intento también fallará y stop() lo detectará.
      this.buffer = batch.concat(this.buffer);
    }
  }

  private async pollProgress() {
    if (!this.sessionId) return;
    try {
      const p = await invoke<Progress>('get_capture_progress', { sessionId: this.sessionId });
      this.samplesWritten = p.samples_written;
      this.samplesLost = p.samples_lost;
      this.bytesWritten = p.bytes_written;
    } catch { /* ignore: la captura puede haber terminado entre tick y tick */ }
  }
}

export const capture = new CaptureStore();
