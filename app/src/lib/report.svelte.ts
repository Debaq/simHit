// Canal del impulso. Histórico solo LL/RL (horizontal); a partir de #13 incluye
// los 4 canales verticales (LARP: LA/RP; RALP: RA/LP). El tipo se mantiene con
// el nombre `Side` por compatibilidad con código consumidor.
export type Side = 'LL' | 'RL' | 'LA' | 'RP' | 'RA' | 'LP';

export type ImpulseSnapshot = {
  id: number;
  side: Side;
  t: number[];      // ms relativo al pico
  head: number[];   // °/s
  eye: number[];    // °/s
  gain: number;
};

/** Subconjuntos para iterar / filtrar. */
export const REPORT_HORIZONTAL_SIDES: Side[] = ['LL', 'RL'];
export const REPORT_VERTICAL_SIDES: Side[] = ['LA', 'RP', 'RA', 'LP'];
export const REPORT_ALL_SIDES: Side[] = [...REPORT_HORIZONTAL_SIDES, ...REPORT_VERTICAL_SIDES];

/** Etiqueta humana por canal (espejo de `CHANNEL_LABELS` en scenario). */
export const SIDE_LABELS: Record<Side, string> = {
  LL: 'Lateral izq.',
  RL: 'Lateral der.',
  LA: 'Anterior izq.',
  RP: 'Posterior der.',
  RA: 'Anterior der.',
  LP: 'Posterior izq.',
};

/** Color CSS por canal. Horizontales usan los tokens existentes; verticales
 * comparten color por lado (izq vs der) para mantener consistencia visual. */
export const SIDE_COLOR: Record<Side, string> = {
  LL: 'var(--side-ll)',
  RL: 'var(--side-rl)',
  LA: 'var(--side-ll)',
  LP: 'var(--side-ll)',
  RA: 'var(--side-rl)',
  RP: 'var(--side-rl)',
};

/** Signo del eje X para el plot: izquierdos → -1, derechos → +1. */
export function sideFlip(s: Side): -1 | 1 {
  return s.startsWith('L') ? -1 : 1;
}

export type Findings = {
  normal: boolean;
  hipofuncion_left: boolean;
  hipofuncion_right: boolean;
  bilateral: boolean;
  saccades_covert: boolean;
  saccades_overt: boolean;
  artifacts: boolean;
  // TODO[#13 F8 diag]: ampliar a hipofunción anterior/posterior por lado
  // (LA/RA/LP/RP) para diagnóstico automático de planos verticales. Por ahora
  // los counts/gains verticales se exhiben pero no alimentan Findings/Diagnosis.
};

export type Diagnosis =
  | ''
  | 'normal'
  | 'unilateral_left'
  | 'unilateral_right'
  | 'bilateral'
  | 'compensated'
  | 'inconclusive';

export const DIAGNOSIS_LABELS: Record<Exclude<Diagnosis, ''>, string> = {
  normal: 'Función vestibular normal',
  unilateral_left: 'Hipofunción vestibular unilateral izquierda',
  unilateral_right: 'Hipofunción vestibular unilateral derecha',
  bilateral: 'Hipofunción vestibular bilateral',
  compensated: 'Hipofunción compensada',
  inconclusive: 'Estudio no concluyente',
};

export type Report = {
  id: string;
  examenCode: string;        // "Examen 03"
  scenarioId: string;

  // Profesional responsable
  examiner: string;          // nombre y apellido
  examinerTitle: string;     // título / cargo
  institution: string;       // centro / institución

  // Paciente
  patientName: string;
  patientId: string;         // RUT / ficha
  patientAge: string;
  patientReason: string;     // motivo de consulta / antecedentes

  date: number;              // creación

  // snapshot examen
  impulses: ImpulseSnapshot[];
  // Horizontales (siempre presentes; informes pre-#13 sólo tenían éstos).
  gainLL: number;
  gainRL: number;
  countLL: number;
  countRL: number;
  // Verticales (introducidos en #13). En informes legacy se completan con 0
  // al cargar — ver `normalizeReport` más abajo. Los consumidores deben
  // tratar count=0 como "sin datos" y mostrar "—".
  gainLA: number;
  gainRP: number;
  gainRA: number;
  gainLP: number;
  countLA: number;
  countRP: number;
  countRA: number;
  countLP: number;

  // diagnóstico
  findings: Findings;
  interpretation: string;
  diagnosis: Diagnosis;
  comments: string;

  submitted: boolean;
  submittedAt?: number;
};

import { storage } from './storage';

// Layout actual: informes/simulacion/<id>.json (PDF opcional como <id>.pdf).
// Layout legacy: reports/<id>.json — se migra automáticamente al cargar.
const REPORTS_DIR = 'informes/simulacion';
const LEGACY_DIR = 'reports';
const LEGACY_KEY = 'simhit:reports';

/**
 * Rellena con 0 los campos verticales que un informe legacy no trae. No
 * reescribe disco automáticamente: si el usuario edita y guarda, queda
 * actualizado en el próximo `upsert`.
 */
export function normalizeReport(r: Report): Report {
  // `as any` porque los Report legacy no declaran las claves verticales.
  const raw = r as Partial<Report> & Record<string, unknown>;
  if (typeof raw.gainLA !== 'number') (r as Report).gainLA = 0;
  if (typeof raw.gainRP !== 'number') (r as Report).gainRP = 0;
  if (typeof raw.gainRA !== 'number') (r as Report).gainRA = 0;
  if (typeof raw.gainLP !== 'number') (r as Report).gainLP = 0;
  if (typeof raw.countLA !== 'number') (r as Report).countLA = 0;
  if (typeof raw.countRP !== 'number') (r as Report).countRP = 0;
  if (typeof raw.countRA !== 'number') (r as Report).countRA = 0;
  if (typeof raw.countLP !== 'number') (r as Report).countLP = 0;
  return r;
}

export function emptyFindings(): Findings {
  return {
    normal: false,
    hipofuncion_left: false,
    hipofuncion_right: false,
    bilateral: false,
    saccades_covert: false,
    saccades_overt: false,
    artifacts: false,
  };
}

class ReportStore {
  list = $state<Report[]>([]);
  loaded = $state(false);

  async load() {
    // Migración: directorio legacy reports/ -> informes/simulacion/
    const filenamesNew = await storage.list(REPORTS_DIR);
    if (filenamesNew.length === 0) {
      const legacyFiles = await storage.list(LEGACY_DIR);
      for (const fn of legacyFiles.filter((n) => n.endsWith('.json'))) {
        const r = await storage.readJson<Report>(`${LEGACY_DIR}/${fn}`);
        if (r) await storage.writeJson(`${REPORTS_DIR}/${fn}`, r);
      }
      // Migración legacy localStorage
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) {
        try {
          const arr: Report[] = JSON.parse(legacy);
          for (const r of arr) await storage.writeJson(`${REPORTS_DIR}/${r.id}.json`, r);
          localStorage.removeItem(LEGACY_KEY);
        } catch (e) { console.warn('migración informes', e); }
      }
    }
    const items: Report[] = [];
    for (const fn of (await storage.list(REPORTS_DIR)).filter((n) => n.endsWith('.json'))) {
      const r = await storage.readJson<Report>(`${REPORTS_DIR}/${fn}`);
      if (r) items.push(normalizeReport(r));
    }
    this.list = items.sort((a, b) => b.date - a.date);
    this.loaded = true;
  }

  /** Guarda el PDF generado de un informe junto al JSON. */
  async writePdf(id: string, bytes: Uint8Array) {
    await storage.writeBinary(`${REPORTS_DIR}/${id}.pdf`, bytes);
  }

  async readPdfBlobUrl(id: string): Promise<string | null> {
    return await storage.readAsBlobUrl(`${REPORTS_DIR}/${id}.pdf`, 'application/pdf');
  }

  async readPdfBytes(id: string): Promise<Uint8Array | null> {
    return await storage.readBinary(`${REPORTS_DIR}/${id}.pdf`);
  }

  upsert(r: Report) {
    const idx = this.list.findIndex((x) => x.id === r.id);
    if (idx >= 0) {
      this.list[idx] = r;
      this.list = [...this.list];
    } else {
      this.list = [r, ...this.list];
    }
    void storage.writeJson(`${REPORTS_DIR}/${r.id}.json`, r);
  }

  remove(id: string) {
    this.list = this.list.filter((x) => x.id !== id);
    void storage.remove(`${REPORTS_DIR}/${id}.json`);
    void storage.remove(`${REPORTS_DIR}/${id}.pdf`);
  }

  get(id: string): Report | null {
    return this.list.find((x) => x.id === id) ?? null;
  }
}

export const reports = new ReportStore();
