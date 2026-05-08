// Sistema multi-set de ojos (v2).
// Estructura: cada set tiene un frame central, 8 rayos (4 cardinales + 4 diagonales)
// y una secuencia lineal de parpadeo. Cada rayo y el parpadeo aceptan frames
// intermedios dinámicos (insertar entre adyacentes con "+").
//
// Convención de rayos (mirada del paciente):
//   up/down/left/right/upLeft/upRight/downLeft/downRight
// El editor presenta los rayos en convención espejo (vista observador):
//   ray 'right' (paciente mira a su derecha) → lado IZQUIERDO de la pantalla.
//
// Storage:
//   eyesets/<setId>/meta.json
//   eyesets/<setId>/frames/<frameId>.bin
//
// Builtin: 36 frames JPG individuales en /eye/frames/<H>-<V>.jpg.
//   centro 0-0, rayos cardinales y diagonales con magnitudes p1..p3 / n1..n3,
//   parpadeo c-0..c-4. Render via `url`.

import { storage } from './storage';
import type { ArtifactConfig } from './scenario.svelte';

export type FrameAnnotation = { pupilX: number; pupilY: number };

export type Frame = {
  id: string;
  pupilX: number;
  pupilY: number;
  // Runtime: builtin → url estática (/eye/frames/...); custom → url blob;
  // legacy sprite WebP usa spriteY (% de background-position-y).
  url?: string;
  spriteY?: number;
};

export const RAY_KEYS = [
  'up', 'down', 'left', 'right',
  'upLeft', 'upRight', 'downLeft', 'downRight',
] as const;
export type RayKey = typeof RAY_KEYS[number];

export const RAY_LABELS: Record<RayKey, string> = {
  up: 'Arriba',
  down: 'Abajo',
  left: 'Izquierda',
  right: 'Derecha',
  upLeft: 'Sup. izq.',
  upRight: 'Sup. der.',
  downLeft: 'Inf. izq.',
  downRight: 'Inf. der.',
};

export type EyeSet = {
  id: string;
  name: string;
  builtin: boolean;
  spriteUrl?: string;
  centerFrame: Frame | null;
  rays: Record<RayKey, Frame[]>;
  blink: Frame[];
  // Artefactos por defecto del set. Cada impulso que use este set hereda esta lista,
  // salvo que el nodo impulse defina su propio override.
  artifacts: ArtifactConfig[];
};

const EYESETS_DIR = 'eyesets';
const KEY_ACTIVE = 'simhit:eyeset:active';
const LEGACY_USER_SETS = 'simhit:eyeset:user-sets';
const LEGACY_BUILTIN_PUPILS = 'simhit:eyeset:builtin-pupils';
const LEGACY_OLD_PUPILS = 'simhit:eyeset:default';

const BUILTIN_ID = 'builtin-default';

// ── Builtin layout ───────────────────────────────────────────────────────────
// Convención: nombre archivo `<V>-<H>.jpg` (primer token vertical, segundo horizontal).
//   '0' = central; 'p1..p3' = positivo magnitud 1..3; 'n1..n3' = negativo.
//   Set corresponde al OJO IZQUIERDO. n horizontal → paciente mira a su DERECHA
//   (= nasal para ojo izq); p horizontal → paciente IZQUIERDA (temporal).
//   p vertical → ARRIBA. c-0..c-4 = parpadeo.
const SPRITE_FRAMES = 12; // sólo para legacy migration
const FRAME_BASE = '/eye/frames';
const mkFrame = (name: string): Frame => ({
  id: `b-${name}`,
  pupilX: 0,
  pupilY: 0,
  url: `${FRAME_BASE}/${name}.jpg`,
});

function makeBuiltin(): EyeSet {
  return {
    id: BUILTIN_ID,
    name: 'Por defecto',
    builtin: true,
    centerFrame: mkFrame('0-0'),
    rays: {
      right: ['0-n1', '0-n2', '0-n3'].map(mkFrame),
      left: ['0-p1', '0-p2', '0-p3'].map(mkFrame),
      up: ['p1-0', 'p2-0'].map(mkFrame),
      down: ['n1-0', 'n2-0'].map(mkFrame),
      upRight: ['p1-n1', 'p1-n2', 'p1-n3', 'p2-n1', 'p2-n2'].map(mkFrame),
      upLeft: ['p1-p1', 'p1-p2', 'p1-p3', 'p2-p1', 'p2-p2'].map(mkFrame),
      downRight: ['n1-n1', 'n1-n2', 'n1-n3', 'n2-n1', 'n2-n2'].map(mkFrame),
      downLeft: ['n1-p1', 'n1-p2', 'n1-p3', 'n2-p1', 'n2-p2'].map(mkFrame),
    },
    blink: ['c-0', 'c-1', 'c-2', 'c-3', 'c-4'].map(mkFrame),
    artifacts: [],
  };
}

function emptyRays(): Record<RayKey, Frame[]> {
  return {
    up: [], down: [], left: [], right: [],
    upLeft: [], upRight: [], downLeft: [], downRight: [],
  };
}

type StoredFrame = { id: string; pupilX: number; pupilY: number };
type StoredEyeSetMetaV2 = {
  version: 2;
  id: string;
  name: string;
  centerFrame: StoredFrame | null;
  rays: Record<RayKey, StoredFrame[]>;
  blink: StoredFrame[];
  artifacts?: ArtifactConfig[];
};
// V1 (legacy) format
type StoredEyeSetMetaV1 = {
  id: string;
  name: string;
  pupils: (FrameAnnotation | null)[];
  hasFrame: boolean[];
};

function toStored(f: Frame): StoredFrame {
  return { id: f.id, pupilX: f.pupilX, pupilY: f.pupilY };
}

class EyeSetStore {
  sets = $state<EyeSet[]>([makeBuiltin()]);
  activeId = $state<string>(BUILTIN_ID);
  loaded = $state(false);

  active = $derived(this.sets.find((s) => s.id === this.activeId) ?? this.sets[0] ?? null);

  async load() {
    const builtin = makeBuiltin();
    await this.applyBuiltinPupils(builtin);
    await this.loadBuiltinArtifacts(builtin);

    // migrar custom sets desde localStorage si fs vacío
    const dirEntries = await storage.list(EYESETS_DIR);
    const userDirs = dirEntries.filter((n) => n !== BUILTIN_ID);
    if (userDirs.length === 0) {
      await this.migrateLegacyLocalStorage();
    }

    const userSets: EyeSet[] = [];
    for (const dirName of (await storage.list(EYESETS_DIR)).filter((n) => n !== BUILTIN_ID)) {
      const meta = await storage.readJson<StoredEyeSetMetaV2 | StoredEyeSetMetaV1>(
        `${EYESETS_DIR}/${dirName}/meta.json`,
      );
      if (!meta) continue;
      const set = await this.materializeSet(dirName, meta);
      if (set) userSets.push(set);
    }
    this.sets = [builtin, ...userSets];

    try { this.activeId = localStorage.getItem(KEY_ACTIVE) || BUILTIN_ID; } catch {}
    if (!this.sets.find((s) => s.id === this.activeId)) this.activeId = BUILTIN_ID;
    this.loaded = true;
  }

  private async applyBuiltinPupils(builtin: EyeSet) {
    // Las pupilas builtin se persisten como mapping {key: {pupilX,pupilY}}
    // Soporta legacy v1 (array de 12 indexada).
    const path = `${EYESETS_DIR}/${BUILTIN_ID}/pupils.json`;
    const data = await storage.readJson<unknown>(path);
    if (data && !Array.isArray(data)) {
      const map = data as Record<string, FrameAnnotation>;
      const apply = (f: Frame) => {
        const m = map[f.id];
        if (m) { f.pupilX = m.pupilX; f.pupilY = m.pupilY; }
      };
      if (builtin.centerFrame) apply(builtin.centerFrame);
      for (const k of RAY_KEYS) builtin.rays[k].forEach(apply);
      builtin.blink.forEach(apply);
      return;
    }
    if (Array.isArray(data) && data.length === SPRITE_FRAMES) {
      this.applyLegacyPupilArray(builtin, data as (FrameAnnotation | null)[]);
      // re-persistir en formato v2
      void this.persistBuiltinPupils(builtin);
      return;
    }
    // legacy localStorage
    const legacy = localStorage.getItem(LEGACY_BUILTIN_PUPILS) || localStorage.getItem(LEGACY_OLD_PUPILS);
    if (legacy) {
      try {
        const parsed = JSON.parse(legacy);
        if (Array.isArray(parsed) && parsed.length === SPRITE_FRAMES) {
          this.applyLegacyPupilArray(builtin, parsed);
          void this.persistBuiltinPupils(builtin);
        }
      } catch {}
    }
  }

  private applyLegacyPupilArray(set: EyeSet, arr: (FrameAnnotation | null)[]) {
    // 0-2: izq extrema/media/leve, 3: centro, 4-6: der leve/media/extrema, 7-11: parpadeo
    // rays.left = [leve, media, extremo] → [arr[2], arr[1], arr[0]]
    // rays.right = [arr[4], arr[5], arr[6]]
    const at = (i: number) => arr[i] ?? null;
    if (set.centerFrame && at(3)) {
      set.centerFrame.pupilX = at(3)!.pupilX;
      set.centerFrame.pupilY = at(3)!.pupilY;
    }
    const leftSrc = [at(2), at(1), at(0)];
    set.rays.left.forEach((f, i) => {
      const a = leftSrc[i];
      if (a) { f.pupilX = a.pupilX; f.pupilY = a.pupilY; }
    });
    const rightSrc = [at(4), at(5), at(6)];
    set.rays.right.forEach((f, i) => {
      const a = rightSrc[i];
      if (a) { f.pupilX = a.pupilX; f.pupilY = a.pupilY; }
    });
    set.blink.forEach((f, i) => {
      const a = at(7 + i);
      if (a) { f.pupilX = a.pupilX; f.pupilY = a.pupilY; }
    });
  }

  private async migrateLegacyLocalStorage() {
    const legacy = localStorage.getItem(LEGACY_USER_SETS);
    if (!legacy) return;
    try {
      const arr: { id: string; name: string; framesData?: string[]; pupils: (FrameAnnotation | null)[] }[] =
        JSON.parse(legacy);
      for (const old of arr) {
        // construir set v2 desde el legacy de 12 índices
        const set: EyeSet = {
          id: old.id,
          name: old.name,
          builtin: false,
          centerFrame: null,
          rays: emptyRays(),
          blink: [],
          artifacts: [],
        };
        const newId = () => crypto.randomUUID();
        const mkFrame = async (idx: number, pupil: FrameAnnotation | null): Promise<Frame | null> => {
          const du = old.framesData?.[idx];
          if (!du) {
            if (!pupil) return null;
            // sin imagen pero con anotación: ignoramos (no se puede mostrar)
            return null;
          }
          const id = newId();
          await storage.writeDataUrl(`${EYESETS_DIR}/${set.id}/frames/${id}.bin`, du);
          return {
            id,
            pupilX: pupil?.pupilX ?? 0,
            pupilY: pupil?.pupilY ?? 0,
          };
        };
        // 3 = centro
        set.centerFrame = await mkFrame(3, old.pupils?.[3] ?? null);
        // izq: leve(2), media(1), extremo(0)
        for (const i of [2, 1, 0]) {
          const f = await mkFrame(i, old.pupils?.[i] ?? null);
          if (f) set.rays.left.push(f);
        }
        // der: leve(4), media(5), extremo(6)
        for (const i of [4, 5, 6]) {
          const f = await mkFrame(i, old.pupils?.[i] ?? null);
          if (f) set.rays.right.push(f);
        }
        // parpadeo: 7..11
        for (let i = 7; i < 12; i++) {
          const f = await mkFrame(i, old.pupils?.[i] ?? null);
          if (f) set.blink.push(f);
        }
        await this.persistMeta(set);
      }
      localStorage.removeItem(LEGACY_USER_SETS);
    } catch (e) {
      console.warn('migración legacy eyesets', e);
    }
  }

  private async materializeSet(
    dirName: string,
    meta: StoredEyeSetMetaV2 | StoredEyeSetMetaV1,
  ): Promise<EyeSet | null> {
    if ('version' in meta && meta.version === 2) {
      return this.materializeV2(dirName, meta);
    }
    // v1 → migrar in-place
    return this.migrateMetaV1(dirName, meta as StoredEyeSetMetaV1);
  }

  private async materializeV2(dirName: string, meta: StoredEyeSetMetaV2): Promise<EyeSet> {
    const loadFrame = async (sf: StoredFrame): Promise<Frame> => {
      const url = await storage.readAsBlobUrl(`${EYESETS_DIR}/${dirName}/frames/${sf.id}.bin`, '') ?? undefined;
      return { id: sf.id, pupilX: sf.pupilX, pupilY: sf.pupilY, url };
    };
    const set: EyeSet = {
      id: meta.id,
      name: meta.name,
      builtin: false,
      centerFrame: meta.centerFrame ? await loadFrame(meta.centerFrame) : null,
      rays: emptyRays(),
      blink: [],
      artifacts: Array.isArray(meta.artifacts) ? meta.artifacts.map((a) => ({ ...a })) : [],
    };
    for (const k of RAY_KEYS) {
      const arr = meta.rays?.[k] ?? [];
      for (const sf of arr) set.rays[k].push(await loadFrame(sf));
    }
    for (const sf of meta.blink ?? []) set.blink.push(await loadFrame(sf));
    return set;
  }

  private async migrateMetaV1(dirName: string, meta: StoredEyeSetMetaV1): Promise<EyeSet> {
    const has = meta.hasFrame ?? Array(SPRITE_FRAMES).fill(false);
    const set: EyeSet = {
      id: meta.id,
      name: meta.name,
      builtin: false,
      centerFrame: null,
      rays: emptyRays(),
      blink: [],
      artifacts: [],
    };
    const moveFrame = async (idx: number): Promise<Frame | null> => {
      if (!has[idx]) return null;
      const oldPath = `${EYESETS_DIR}/${dirName}/frames/${idx}.bin`;
      const bin = await storage.readBinary(oldPath);
      if (!bin) return null;
      const newId = crypto.randomUUID();
      await storage.writeBinary(`${EYESETS_DIR}/${dirName}/frames/${newId}.bin`, bin);
      await storage.remove(oldPath);
      const url = await storage.readAsBlobUrl(`${EYESETS_DIR}/${dirName}/frames/${newId}.bin`, '') ?? undefined;
      const p = meta.pupils?.[idx] ?? null;
      return { id: newId, pupilX: p?.pupilX ?? 0, pupilY: p?.pupilY ?? 0, url };
    };
    set.centerFrame = await moveFrame(3);
    for (const i of [2, 1, 0]) { const f = await moveFrame(i); if (f) set.rays.left.push(f); }
    for (const i of [4, 5, 6]) { const f = await moveFrame(i); if (f) set.rays.right.push(f); }
    for (let i = 7; i < SPRITE_FRAMES; i++) { const f = await moveFrame(i); if (f) set.blink.push(f); }
    await this.persistMeta(set);
    return set;
  }

  // ── Activo / sets CRUD ────────────────────────────────────────────────────

  setActive(id: string) {
    if (!this.sets.find((s) => s.id === id)) return;
    this.activeId = id;
    try { localStorage.setItem(KEY_ACTIVE, id); } catch {}
  }

  createCustom(name = 'Set nuevo'): EyeSet {
    const s: EyeSet = {
      id: crypto.randomUUID(),
      name,
      builtin: false,
      centerFrame: null,
      rays: emptyRays(),
      blink: [],
      artifacts: [],
    };
    this.sets = [...this.sets, s];
    this.activeId = s.id;
    try { localStorage.setItem(KEY_ACTIVE, s.id); } catch {}
    void this.persistMeta(s);
    return s;
  }

  duplicate(id: string): EyeSet | null {
    const src = this.sets.find((x) => x.id === id);
    if (!src) return null;
    const copy: EyeSet = {
      id: crypto.randomUUID(),
      name: src.name.replace(/ \(copia\)$/, '') + ' (copia)',
      builtin: false,
      centerFrame: src.centerFrame ? { ...src.centerFrame, id: crypto.randomUUID(), url: undefined } : null,
      rays: emptyRays(),
      blink: [],
      artifacts: src.artifacts.map((a) => ({ ...a })),
    };
    for (const k of RAY_KEYS) {
      copy.rays[k] = src.rays[k].map((f) => ({ ...f, id: crypto.randomUUID(), url: undefined }));
    }
    copy.blink = src.blink.map((f) => ({ ...f, id: crypto.randomUUID(), url: undefined }));

    this.sets = [...this.sets, copy];
    this.activeId = copy.id;
    try { localStorage.setItem(KEY_ACTIVE, copy.id); } catch {}
    void this.persistMeta(copy);
    if (!src.builtin) void this.copyBinaries(src, copy);
    return copy;
  }

  private async copyBinaries(src: EyeSet, dst: EyeSet) {
    const pairs: Array<[Frame | null, Frame | null]> = [];
    pairs.push([src.centerFrame, dst.centerFrame]);
    for (const k of RAY_KEYS) {
      src.rays[k].forEach((f, i) => pairs.push([f, dst.rays[k][i] ?? null]));
    }
    src.blink.forEach((f, i) => pairs.push([f, dst.blink[i] ?? null]));
    for (const [a, b] of pairs) {
      if (!a || !b) continue;
      const bin = await storage.readBinary(`${EYESETS_DIR}/${src.id}/frames/${a.id}.bin`);
      if (!bin) continue;
      await storage.writeBinary(`${EYESETS_DIR}/${dst.id}/frames/${b.id}.bin`, bin);
      const url = await storage.readAsBlobUrl(`${EYESETS_DIR}/${dst.id}/frames/${b.id}.bin`, '');
      if (url) b.url = url;
    }
    this.sets = [...this.sets];
  }

  remove(id: string) {
    const s = this.sets.find((x) => x.id === id);
    if (!s || s.builtin) return;
    this.sets = this.sets.filter((x) => x.id !== id);
    if (this.activeId === id) this.activeId = BUILTIN_ID;
    try { localStorage.setItem(KEY_ACTIVE, this.activeId); } catch {}
    void storage.remove(`${EYESETS_DIR}/${id}`);
  }

  rename(id: string, name: string) {
    const s = this.sets.find((x) => x.id === id);
    if (!s) return;
    s.name = name;
    this.sets = [...this.sets];
    void this.persistMeta(s);
  }

  // ── Helpers de localización de frames ─────────────────────────────────────

  /**
   * Una FrameRef identifica un frame dentro del set:
   *  { kind:'center' }
   *  { kind:'ray', ray:'right', index:2 }
   *  { kind:'blink', index:0 }
   */
  getFrame(set: EyeSet, ref: FrameRef): Frame | null {
    if (ref.kind === 'center') return set.centerFrame;
    if (ref.kind === 'ray') return set.rays[ref.ray]?.[ref.index] ?? null;
    if (ref.kind === 'blink') return set.blink[ref.index] ?? null;
    return null;
  }

  setFrameAt(set: EyeSet, ref: FrameRef, frame: Frame | null) {
    if (ref.kind === 'center') set.centerFrame = frame;
    else if (ref.kind === 'ray') {
      const arr = [...set.rays[ref.ray]];
      if (frame) arr[ref.index] = frame;
      set.rays = { ...set.rays, [ref.ray]: arr };
    } else if (ref.kind === 'blink') {
      const arr = [...set.blink];
      if (frame) arr[ref.index] = frame;
      set.blink = arr;
    }
  }

  // ── Operaciones de frames (pupila / imagen) ───────────────────────────────

  setPupil(ref: FrameRef, a: FrameAnnotation | null) {
    const s = this.active;
    if (!s) return;
    const f = this.getFrame(s, ref);
    if (!f) return;
    f.pupilX = a?.pupilX ?? 0;
    f.pupilY = a?.pupilY ?? 0;
    if (a === null) { f.pupilX = 0; f.pupilY = 0; }
    this.sets = [...this.sets];
    if (s.builtin) void this.persistBuiltinPupils(s);
    else void this.persistMeta(s);
  }

  clearPupil(ref: FrameRef) { this.setPupil(ref, null); }

  async replaceFrameImage(ref: FrameRef, file: File) {
    const s = this.active;
    if (!s || s.builtin) return;
    const target = this.getFrame(s, ref);
    if (!target) return;
    const buf = new Uint8Array(await file.arrayBuffer());
    await storage.writeBinary(`${EYESETS_DIR}/${s.id}/frames/${target.id}.bin`, buf);
    if (target.url) URL.revokeObjectURL(target.url);
    target.url = URL.createObjectURL(new Blob([new Uint8Array(buf)]));
    this.sets = [...this.sets];
    void this.persistMeta(s);
  }

  /**
   * Crear un nuevo frame (con imagen) e insertarlo en `position`.
   *   - center: reemplaza al central (si ya existía, se borra el anterior)
   *   - ray: inserta en el rayo en la posición `index` (0..length)
   *   - blink: inserta en blink en la posición `index` (0..length)
   */
  async addFrame(ref: FrameInsertRef, file: File): Promise<Frame | null> {
    const s = this.active;
    if (!s || s.builtin) return null;
    const id = crypto.randomUUID();
    const buf = new Uint8Array(await file.arrayBuffer());
    await storage.writeBinary(`${EYESETS_DIR}/${s.id}/frames/${id}.bin`, buf);
    const url = URL.createObjectURL(new Blob([new Uint8Array(buf)]));
    const frame: Frame = { id, pupilX: 0, pupilY: 0, url };
    if (ref.kind === 'center') {
      if (s.centerFrame) {
        const old = s.centerFrame;
        if (old.url) URL.revokeObjectURL(old.url);
        void storage.remove(`${EYESETS_DIR}/${s.id}/frames/${old.id}.bin`);
      }
      s.centerFrame = frame;
    } else if (ref.kind === 'ray') {
      const arr = [...s.rays[ref.ray]];
      arr.splice(ref.index, 0, frame);
      s.rays = { ...s.rays, [ref.ray]: arr };
    } else if (ref.kind === 'blink') {
      const arr = [...s.blink];
      arr.splice(ref.index, 0, frame);
      s.blink = arr;
    }
    this.sets = [...this.sets];
    void this.persistMeta(s);
    return frame;
  }

  removeFrame(ref: FrameRef) {
    const s = this.active;
    if (!s || s.builtin) return;
    const target = this.getFrame(s, ref);
    if (!target) return;
    if (target.url) URL.revokeObjectURL(target.url);
    void storage.remove(`${EYESETS_DIR}/${s.id}/frames/${target.id}.bin`);
    if (ref.kind === 'center') s.centerFrame = null;
    else if (ref.kind === 'ray') {
      const arr = [...s.rays[ref.ray]];
      arr.splice(ref.index, 1);
      s.rays = { ...s.rays, [ref.ray]: arr };
    } else if (ref.kind === 'blink') {
      const arr = [...s.blink];
      arr.splice(ref.index, 1);
      s.blink = arr;
    }
    this.sets = [...this.sets];
    void this.persistMeta(s);
  }

  clearActiveMarkers() {
    const s = this.active;
    if (!s) return;
    if (s.centerFrame) { s.centerFrame.pupilX = 0; s.centerFrame.pupilY = 0; }
    for (const k of RAY_KEYS) for (const f of s.rays[k]) { f.pupilX = 0; f.pupilY = 0; }
    for (const f of s.blink) { f.pupilX = 0; f.pupilY = 0; }
    this.sets = [...this.sets];
    if (s.builtin) void this.persistBuiltinPupils(s);
    else void this.persistMeta(s);
  }

  // ── Persistencia ─────────────────────────────────────────────────────────

  private async persistBuiltinPupils(s: EyeSet) {
    const map: Record<string, FrameAnnotation> = {};
    const add = (f: Frame | null) => { if (f) map[f.id] = { pupilX: f.pupilX, pupilY: f.pupilY }; };
    add(s.centerFrame);
    for (const k of RAY_KEYS) s.rays[k].forEach(add);
    s.blink.forEach(add);
    await storage.writeJson(`${EYESETS_DIR}/${BUILTIN_ID}/pupils.json`, map);
  }

  private async persistMeta(s: EyeSet) {
    if (s.builtin) return;
    const meta: StoredEyeSetMetaV2 = {
      version: 2,
      id: s.id,
      name: s.name,
      centerFrame: s.centerFrame ? toStored(s.centerFrame) : null,
      rays: {
        up: s.rays.up.map(toStored),
        down: s.rays.down.map(toStored),
        left: s.rays.left.map(toStored),
        right: s.rays.right.map(toStored),
        upLeft: s.rays.upLeft.map(toStored),
        upRight: s.rays.upRight.map(toStored),
        downLeft: s.rays.downLeft.map(toStored),
        downRight: s.rays.downRight.map(toStored),
      },
      blink: s.blink.map(toStored),
      artifacts: s.artifacts.map((a) => ({ ...a })),
    };
    await storage.writeJson(`${EYESETS_DIR}/${s.id}/meta.json`, meta);
  }

  // ── Artefactos ───────────────────────────────────────────────────────────

  private async persistArtifacts(s: EyeSet) {
    if (s.builtin) {
      await storage.writeJson(`${EYESETS_DIR}/${BUILTIN_ID}/artifacts.json`, s.artifacts);
    } else {
      await this.persistMeta(s);
    }
  }

  addArtifact(setId: string, cfg: ArtifactConfig) {
    const s = this.sets.find((x) => x.id === setId);
    if (!s) return;
    s.artifacts = [...s.artifacts, { ...cfg }];
    this.sets = [...this.sets];
    void this.persistArtifacts(s);
  }
  updateArtifact(setId: string, index: number, patch: Partial<ArtifactConfig>) {
    const s = this.sets.find((x) => x.id === setId);
    if (!s) return;
    const arr = [...s.artifacts];
    if (!arr[index]) return;
    arr[index] = { ...arr[index], ...patch };
    s.artifacts = arr;
    this.sets = [...this.sets];
    void this.persistArtifacts(s);
  }
  removeArtifact(setId: string, index: number) {
    const s = this.sets.find((x) => x.id === setId);
    if (!s) return;
    s.artifacts = s.artifacts.filter((_, i) => i !== index);
    this.sets = [...this.sets];
    void this.persistArtifacts(s);
  }

  private async loadBuiltinArtifacts(builtin: EyeSet) {
    const arr = await storage.readJson<ArtifactConfig[]>(`${EYESETS_DIR}/${BUILTIN_ID}/artifacts.json`);
    if (Array.isArray(arr)) builtin.artifacts = arr.map((a) => ({ ...a }));
  }
}

export type FrameRef =
  | { kind: 'center' }
  | { kind: 'ray'; ray: RayKey; index: number }
  | { kind: 'blink'; index: number };

export type FrameInsertRef =
  | { kind: 'center' }
  | { kind: 'ray'; ray: RayKey; index: number }
  | { kind: 'blink'; index: number };

export function frameRefEq(a: FrameRef | null, b: FrameRef | null): boolean {
  if (!a || !b) return a === b;
  if (a.kind !== b.kind) return false;
  if (a.kind === 'center') return true;
  if (a.kind === 'ray' && b.kind === 'ray') return a.ray === b.ray && a.index === b.index;
  if (a.kind === 'blink' && b.kind === 'blink') return a.index === b.index;
  return false;
}

export const eyeset = new EyeSetStore();
