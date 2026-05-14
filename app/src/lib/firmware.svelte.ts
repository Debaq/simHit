// Cliente del manifest de firmwares (firmware/manifest.json en el repo).
//
// Compara la versión reportada por el firmware conectado (serial.firmwareVersionString)
// contra la versión "latest" del manifest publicado en main y, si difieren,
// reporta una actualización disponible. No flashea por ahora; eso vendrá con
// flash.rs + espflash. Esta capa solo provee la inteligencia de detección.

import { serial } from './serial.svelte';

// URLs de búsqueda, en orden de preferencia. Primero raw.githubusercontent
// (siempre actualizado) y luego el archivo dentro del bundle empaquetado
// (fallback offline desde la app instalada).
const REMOTE_URLS = [
  'https://raw.githubusercontent.com/Debaq/simHit/main/firmware/manifest.json',
];

export type FirmwareArtifact = {
  board: string;
  sensor?: string;          // slug del driver (p.ej. 'l3g-lsm303')
  image_type?: 'merged' | 'app';
  flash_address?: number;
  url: string;
  sha256: string | null;
  size_bytes?: number;
};

export type SupportedSensor = {
  slug: string;
  label: string;
  families: string[];     // nombres concretos (p.ej. ['L3GD20H','L3GD20','L3G4200D'])
  who_am_i: string[];
  default?: boolean;
  // false = el driver está implementado pero nunca fue probado en hardware real.
  validated?: boolean;
};

export type FirmwareManifestEntry = {
  version: string;
  channel: 'stable' | 'beta' | string;
  released_at: string;
  notes: string;
  min_compatible_app: string;
  artifacts: FirmwareArtifact[];
};

export type FirmwareManifest = {
  schema_version: string;
  supported_sensors?: SupportedSensor[];
  latest: FirmwareManifestEntry;
  history: FirmwareManifestEntry[];
};

export type UpdateStatus =
  | 'unknown'           // sin información (no conectado o no chequeado)
  | 'up-to-date'        // versión actual == latest
  | 'update-available'  // versión actual < latest
  | 'newer-than-remote' // versión actual > latest (dev build)
  | 'check-failed';     // error al consultar manifest

// Compara dos versiones semver de forma laxa. Devuelve -1/0/1 según a<b, a==b, a>b.
// Ignora suffix de pre-release: 1.0.0-beta == 1.0.0. Es suficiente para nuestro caso.
export function compareVersions(a: string, b: string): number {
  const norm = (s: string) => s.split(/[-+]/)[0].split('.').map((x) => Number.parseInt(x, 10) || 0);
  const pa = norm(a);
  const pb = norm(b);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const xa = pa[i] ?? 0;
    const xb = pb[i] ?? 0;
    if (xa < xb) return -1;
    if (xa > xb) return 1;
  }
  return 0;
}

class FirmwareStore {
  manifest = $state<FirmwareManifest | null>(null);
  checking = $state(false);
  lastChecked = $state<Date | null>(null);
  lastError = $state<string | null>(null);

  // Estado derivado: relación entre la versión conectada y la del manifest.
  get status(): UpdateStatus {
    const current = serial.firmwareVersionString;
    if (!current) return 'unknown';
    if (this.lastError) return 'check-failed';
    if (!this.manifest) return 'unknown';
    const cmp = compareVersions(current, this.manifest.latest.version);
    if (cmp === 0) return 'up-to-date';
    if (cmp < 0) return 'update-available';
    return 'newer-than-remote';
  }

  // Consulta el manifest remoto. Idempotente: si ya hay manifest cargado lo
  // refresca solo cuando el llamador lo pide explícitamente.
  async check(force = false): Promise<void> {
    if (this.checking) return;
    if (this.manifest && !force) return;
    this.checking = true;
    this.lastError = null;
    try {
      let lastError: string | null = null;
      for (const url of REMOTE_URLS) {
        try {
          // Cache-bust con query timestamp por si la CDN o el webview cachean.
          const r = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' });
          if (!r.ok) { lastError = `HTTP ${r.status} en ${url}`; continue; }
          const json = (await r.json()) as FirmwareManifest;
          if (!json.latest?.version) {
            lastError = `manifest sin campo latest.version en ${url}`;
            continue;
          }
          this.manifest = json;
          this.lastChecked = new Date();
          this.lastError = null;
          return;
        } catch (e) {
          lastError = `${url}: ${String(e)}`;
        }
      }
      this.lastError = lastError ?? 'No se pudo consultar el manifest';
    } finally {
      this.checking = false;
    }
  }
}

export const firmware = new FirmwareStore();
