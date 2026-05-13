// Cliente del módulo de flasheo (src-tauri/src/metrics/flash.rs).
//
// Flujo:
//   1) Buscar el primer artifact "merged" en firmware.manifest.latest
//   2) Descargar el .bin desde la URL del manifest, validar SHA-256
//   3) Llamar a serial.disconnect() para liberar el puerto
//   4) invoke('flash_firmware', { port, bytes, flash_address })
//   5) Escuchar eventos 'flash://progress' y reflejarlos en el store
//   6) Al terminar, re-conectar el puerto vía serial.connect()
// Cualquier paso que falle deja el store en stage='error' con error.

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { serial } from './serial.svelte';
import { firmware } from './firmware.svelte';

export type FlashStage = 'idle' | 'downloading' | 'verifying' | 'connecting' | 'writing' | 'resetting' | 'done' | 'error';

type ProgressEvent = {
  phase: string;
  current: number;
  total: number;
  message: string | null;
};

function hex(buf: ArrayBuffer): string {
  const arr = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < arr.length; i++) s += arr[i].toString(16).padStart(2, '0');
  return s;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  return hex(buf);
}

class FlashStore {
  stage = $state<FlashStage>('idle');
  // Progreso 0..1 del paso actual (download o flash); -1 si indeterminado.
  progress = $state(-1);
  message = $state<string | null>(null);
  error = $state<string | null>(null);
  downloadedBytes = $state(0);
  totalBytes = $state(0);

  private unlisten: UnlistenFn | null = null;

  async start() {
    if (this.stage !== 'idle' && this.stage !== 'done' && this.stage !== 'error') {
      throw new Error('Flasheo ya en curso');
    }
    this.reset();

    if (!firmware.manifest) {
      this.fail('No hay manifest cargado. Refresque el chequeo de actualización primero.');
      return;
    }
    if (!serial.portPath) {
      this.fail('No hay puerto SimHIT seleccionado.');
      return;
    }
    const artifact = firmware.manifest.latest.artifacts.find((a) => a.board === 'esp32-c3-supermini' && (a as { image_type?: string }).image_type === 'merged')
      ?? firmware.manifest.latest.artifacts[0];
    if (!artifact) {
      this.fail('El manifest no incluye artifacts.');
      return;
    }

    const port = serial.portPath;
    // El plugin serial mantiene el puerto abierto; espflash necesita acceso
    // exclusivo. Liberamos antes de pasar el path al backend.
    await serial.disconnect();

    try {
      this.stage = 'downloading';
      this.message = `Descargando ${artifact.url.split('/').pop()}…`;
      const bytes = await this.download(artifact.url);

      if (artifact.sha256) {
        this.stage = 'verifying';
        this.message = 'Verificando SHA-256';
        const got = await sha256(bytes);
        if (got !== artifact.sha256.toLowerCase()) {
          this.fail(`SHA-256 no coincide. Esperado ${artifact.sha256}, obtenido ${got}`);
          return;
        }
      }

      // Subscribe a eventos de progreso del backend.
      this.unlisten = await listen<ProgressEvent>('flash://progress', (e) => this.onProgress(e.payload));

      this.stage = 'connecting';
      this.message = 'Conectando al ESP…';
      const flashAddr = (artifact as { flash_address?: number }).flash_address ?? 0;
      await invoke('flash_firmware', {
        port,
        bytes: Array.from(bytes),
        flashAddress: flashAddr,
      });

      this.stage = 'done';
      this.message = 'Firmware flasheado. Reconectando…';
      // Pequeña pausa para que el ESP termine el reset; luego reconectar.
      await new Promise((r) => setTimeout(r, 1500));
      await serial.refreshAndAutoSelect();
      if (serial.portPath) {
        await serial.connect(serial.portPath);
      }
    } catch (e) {
      this.fail(String(e));
    } finally {
      if (this.unlisten) { this.unlisten(); this.unlisten = null; }
    }
  }

  private async download(url: string): Promise<Uint8Array> {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status} al descargar ${url}`);
    const total = Number(r.headers.get('content-length') ?? 0);
    this.totalBytes = total;

    if (!r.body) {
      const buf = await r.arrayBuffer();
      this.downloadedBytes = buf.byteLength;
      return new Uint8Array(buf);
    }

    const reader = r.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        received += value.length;
        this.downloadedBytes = received;
        if (total > 0) this.progress = received / total;
      }
    }
    const out = new Uint8Array(received);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return out;
  }

  private onProgress(e: ProgressEvent) {
    if (e.phase === 'connect') this.stage = 'connecting';
    else if (e.phase === 'write') this.stage = 'writing';
    else if (e.phase === 'reset') this.stage = 'resetting';
    else if (e.phase === 'done') this.stage = 'done';
    if (e.message) this.message = e.message;
    if (e.total > 0) this.totalBytes = e.total;
    if (e.current > 0) {
      this.downloadedBytes = e.current;
      if (this.totalBytes > 0) this.progress = e.current / this.totalBytes;
    }
  }

  private fail(msg: string) {
    this.error = msg;
    this.stage = 'error';
  }

  reset() {
    this.stage = 'idle';
    this.progress = -1;
    this.message = null;
    this.error = null;
    this.downloadedBytes = 0;
    this.totalBytes = 0;
    if (this.unlisten) { this.unlisten(); this.unlisten = null; }
  }
}

export const flash = new FlashStore();
