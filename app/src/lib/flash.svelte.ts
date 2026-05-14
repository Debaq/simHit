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
import { firmware, type FirmwareArtifact, type FirmwareManifest } from './firmware.svelte';

// Resuelve qué .bin descargar dado el sensor objetivo. Prefiere merged
// (escritura al addr 0x0 incluye bootloader + particiones). Si no encuentra
// uno para el slug exacto, cae al sensor default; finalmente al primer
// artifact disponible.
function pickArtifact(manifest: FirmwareManifest, preferredSlug?: string): FirmwareArtifact | null {
  const artifacts = manifest.latest.artifacts;
  const tryFind = (slug: string | undefined) => {
    if (!slug) return null;
    return artifacts.find((a) => a.sensor === slug && a.image_type === 'merged')
        ?? artifacts.find((a) => a.sensor === slug)
        ?? null;
  };
  // 1) Slug explícito
  let a = tryFind(preferredSlug);
  if (a) return a;
  // 2) Familia del firmware actualmente corriendo (mapeo familia→slug)
  const detectedFamily = serial.detectedSensor?.family;
  if (detectedFamily) {
    const supported = manifest.supported_sensors ?? [];
    const match = supported.find((s) => s.families?.includes(detectedFamily));
    a = tryFind(match?.slug);
    if (a) return a;
  }
  // 3) Sensor default declarado en el manifest
  const def = (manifest.supported_sensors ?? []).find((s) => s.default);
  a = tryFind(def?.slug);
  if (a) return a;
  // 4) Cualquier artifact merged; último recurso, cualquiera.
  return artifacts.find((a) => a.image_type === 'merged') ?? artifacts[0] ?? null;
}

export type FlashStage = 'idle' | 'downloading' | 'verifying' | 'connecting' | 'writing' | 'resetting' | 'done' | 'error';

export type UsbSerialPort = {
  port_name: string;
  vid: number;
  pid: number;
  manufacturer: string | null;
  product: string | null;
  serial_number: string | null;
};

type ProgressEvent = {
  phase: string;
  current: number;
  total: number;
  message: string | null;
};

class FlashStore {
  stage = $state<FlashStage>('idle');
  // Progreso 0..1 del paso actual (download o flash); -1 si indeterminado.
  progress = $state(-1);
  message = $state<string | null>(null);
  error = $state<string | null>(null);
  downloadedBytes = $state(0);
  totalBytes = $state(0);

  private unlisten: UnlistenFn | null = null;

  // Lista puertos USB-Serial visibles para que el usuario elija manualmente.
  // Útil cuando el dispositivo está virgen (no responde al probe HELLO).
  async listPorts(): Promise<UsbSerialPort[]> {
    return await invoke<UsbSerialPort[]>('list_serial_ports');
  }

  // Si se pasa `port`, lo usa explícitamente; si no, intenta serial.portPath.
  // `sensorSlug` fuerza un driver específico cuando lo necesita el usuario
  // (instalación desde cero, sin firmware previo para autodetectar).
  // Permite flashear dispositivos sin firmware previo (el ROM bootloader del
  // ESP entra al modo descarga vía DTR/RTS sin importar si hay handshake).
  async start(port?: string, sensorSlug?: string) {
    if (this.stage !== 'idle' && this.stage !== 'done' && this.stage !== 'error') {
      throw new Error('Flasheo ya en curso');
    }
    this.reset();

    if (!firmware.manifest) {
      this.fail('No hay manifest cargado. Refresque el chequeo de actualización primero.');
      return;
    }
    const targetPort = port ?? serial.portPath;
    if (!targetPort) {
      this.fail('Seleccione un puerto USB-Serial.');
      return;
    }
    // Elegir el artifact correcto:
    //   1) Si el firmware conectado reporta familia de sensor → usar ese slug.
    //   2) Si no, usar el sensor marcado default en supported_sensors.
    //   3) Último fallback: primer artifact merged disponible.
    const artifact = pickArtifact(firmware.manifest, sensorSlug);
    if (!artifact) {
      this.fail('El manifest no incluye artifacts compatibles con el sensor detectado.');
      return;
    }

    // Si el puerto elegido coincide con el SimHIT conectado, liberar el
    // recurso para que espflash pueda tomarlo en exclusivo.
    if (serial.connected && serial.portPath === targetPort) {
      await serial.disconnect();
    }

    try {
      // Subscribe a eventos de progreso del backend ANTES de la descarga para
      // capturar también las fases 'downloading'.
      this.unlisten = await listen<ProgressEvent>('flash://progress', (e) => this.onProgress(e.payload));

      this.stage = 'downloading';
      this.message = `Descargando ${artifact.url.split('/').pop()}…`;
      // La descarga la hace Rust con reqwest: bypasea CORS del webview y
      // valida SHA-256 inline si el manifest lo provee.
      const bytes = new Uint8Array(await invoke<number[]>('download_firmware', {
        url: artifact.url,
        expectedSha256: artifact.sha256,
      }));

      this.stage = 'connecting';
      this.message = 'Conectando al ESP…';
      const flashAddr = (artifact as { flash_address?: number }).flash_address ?? 0;
      await invoke('flash_firmware', {
        port: targetPort,
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

  private onProgress(e: ProgressEvent) {
    if (e.phase === 'downloading') this.stage = 'downloading';
    else if (e.phase === 'connect') this.stage = 'connecting';
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
