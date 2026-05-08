export type Side = 'LL' | 'RL';

export type ImpulseSnapshot = {
  id: number;
  side: Side;
  t: number[];      // ms relativo al pico
  head: number[];   // °/s
  eye: number[];    // °/s
  gain: number;
};

export type Findings = {
  normal: boolean;
  hipofuncion_left: boolean;
  hipofuncion_right: boolean;
  bilateral: boolean;
  saccades_covert: boolean;
  saccades_overt: boolean;
  artifacts: boolean;
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
  gainLL: number;
  gainRL: number;
  countLL: number;
  countRL: number;

  // diagnóstico
  findings: Findings;
  interpretation: string;
  diagnosis: Diagnosis;
  comments: string;

  submitted: boolean;
  submittedAt?: number;
};

import { storage } from './storage';

const REPORTS_DIR = 'reports';
const LEGACY_KEY = 'simhit:reports';

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
    // migración legacy
    const filenames = await storage.list(REPORTS_DIR);
    if (filenames.length === 0) {
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
      if (r) items.push(r);
    }
    this.list = items.sort((a, b) => b.date - a.date);
    this.loaded = true;
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
  }

  get(id: string): Report | null {
    return this.list.find((x) => x.id === id) ?? null;
  }
}

export const reports = new ReportStore();
