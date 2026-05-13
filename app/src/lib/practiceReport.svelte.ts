// Informes de práctica: persistencia en disco de cada sesión finalizada
// (o detenida con intentos). Guarda un JSON con metadatos + métricas y,
// opcionalmente, el PDF generado en binario adjunto.
//
// Layout en AppData:
//   informes/practica/<id>.json
//   informes/practica/<id>.pdf       (opcional, generado al cerrar la sesión)
//
// El shape evita persistir las trazas crudas por defecto (pueden ser pesadas).
// El listado en /informes lee solo los .json.

import { storage } from './storage';
import type { Achievements } from './practice.svelte';

const PRACTICE_DIR = 'informes/practica';

export interface PracticeAttemptSummary {
  itemIdx: number;
  acceptanceId: string;
  side: 'LL' | 'RL';
  ok: boolean;
  peak: number;
  gain: number;
  durMs: number;
  amp: number;
  reasons: string[];
  ts: number;
  impulseId: number;
}

export interface PracticeReport {
  id: string;
  kind: 'practica';
  /** true si la sesión se cerró sin completar todos los objetivos. */
  partial: boolean;
  /** Marca temporal ISO al guardar. */
  ts: string;
  /** Compat con guardado anterior (ms epoch). */
  date: number;
  practitioner: string;
  bundleId: string;
  bundleName: string;
  variant: 'horiz' | 'vert';
  mode: 'attempts' | 'hits';
  startedMs: number;
  endedMs: number;
  attempts: PracticeAttemptSummary[];
  achievements: Achievements;
  /** Indica si junto al JSON hay un PDF binario en disco. */
  hasPdf: boolean;
}

class PracticeReportStore {
  list = $state<PracticeReport[]>([]);
  loaded = $state(false);

  async load() {
    const items: PracticeReport[] = [];
    const filenames = await storage.list(PRACTICE_DIR);
    for (const fn of filenames.filter((n) => n.endsWith('.json'))) {
      const r = await storage.readJson<PracticeReport>(`${PRACTICE_DIR}/${fn}`);
      if (!r) continue;
      // Backfill por compatibilidad con guardados previos sin `date` ni `hasPdf`.
      if (!r.date) {
        const t = Date.parse(r.ts ?? '') || r.endedMs || r.startedMs || Date.now();
        r.date = t;
      }
      if (typeof r.hasPdf !== 'boolean') r.hasPdf = false;
      items.push(r);
    }
    this.list = items.sort((a, b) => b.date - a.date);
    this.loaded = true;
  }

  async upsert(r: PracticeReport) {
    const idx = this.list.findIndex((x) => x.id === r.id);
    if (idx >= 0) this.list = this.list.map((x, i) => (i === idx ? r : x));
    else this.list = [r, ...this.list];
    await storage.writeJson(`${PRACTICE_DIR}/${r.id}.json`, r);
  }

  async remove(id: string) {
    this.list = this.list.filter((x) => x.id !== id);
    await storage.remove(`${PRACTICE_DIR}/${id}.json`);
    await storage.remove(`${PRACTICE_DIR}/${id}.pdf`);
  }

  get(id: string): PracticeReport | null {
    return this.list.find((x) => x.id === id) ?? null;
  }

  async writePdf(id: string, bytes: Uint8Array) {
    await storage.writeBinary(`${PRACTICE_DIR}/${id}.pdf`, bytes);
    const r = this.get(id);
    if (r && !r.hasPdf) {
      const updated: PracticeReport = { ...r, hasPdf: true };
      await this.upsert(updated);
    }
  }

  async readPdfBlobUrl(id: string): Promise<string | null> {
    return await storage.readAsBlobUrl(`${PRACTICE_DIR}/${id}.pdf`, 'application/pdf');
  }

  async readPdfBytes(id: string): Promise<Uint8Array | null> {
    return await storage.readBinary(`${PRACTICE_DIR}/${id}.pdf`);
  }
}

export const practiceReports = new PracticeReportStore();

/** Helpers compartidos para nombres de archivo legibles. */
function pad2(n: number) { return String(n).padStart(2, '0'); }
export function humanStamp(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}_${pad2(d.getHours())}h${pad2(d.getMinutes())}`;
}
export function slugName(s: string) {
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'sin_nombre';
}
