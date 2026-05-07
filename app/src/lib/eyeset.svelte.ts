// Sistema multi-set de ojos.
// Built-in: sprite WebP en /static/eye/sprite.webp.
// Custom: meta.json + frames/<idx>.bin en AppData (vía storage).

import { storage } from './storage';

export const FRAMES_COUNT = 12;
export const HORIZ_FRAMES = 7;
export const BLINK_FRAMES = 5;

export const FRAME_LABELS: string[] = [
  'Extremo izquierda',
  'Izquierda media',
  'Izquierda leve',
  'Centro',
  'Derecha leve',
  'Derecha media',
  'Extremo derecha',
  'Parpadeo 0 (abierto)',
  'Parpadeo 1',
  'Parpadeo 2',
  'Parpadeo 3',
  'Parpadeo 4 (cerrado)',
];

export type FrameAnnotation = { pupilX: number; pupilY: number };

export type EyeSet = {
  id: string;
  name: string;
  builtin: boolean;
  spriteUrl?: string;
  pupils: (FrameAnnotation | null)[];
  // runtime: blob URLs por frame (sólo custom)
  frameUrls?: (string | null)[];
};

const EYESETS_DIR = 'eyesets';
const KEY_ACTIVE = 'simhit:eyeset:active';
const LEGACY_USER_SETS = 'simhit:eyeset:user-sets';
const LEGACY_BUILTIN_PUPILS = 'simhit:eyeset:builtin-pupils';
const LEGACY_OLD_PUPILS = 'simhit:eyeset:default';

const BUILTIN_ID = 'builtin-default';

function makeBuiltin(): EyeSet {
  return {
    id: BUILTIN_ID,
    name: 'Por defecto',
    builtin: true,
    spriteUrl: '/eye/sprite.webp',
    pupils: Array(FRAMES_COUNT).fill(null),
  };
}

type StoredEyeSetMeta = {
  id: string;
  name: string;
  pupils: (FrameAnnotation | null)[];
  hasFrame: boolean[];
};

class EyeSetStore {
  sets = $state<EyeSet[]>([makeBuiltin()]);
  activeId = $state<string>(BUILTIN_ID);
  loaded = $state(false);

  active = $derived(this.sets.find((s) => s.id === this.activeId) ?? this.sets[0] ?? null);

  async load() {
    const builtin = makeBuiltin();

    // pupilas builtin (2 keys legacy posibles)
    const builtinPath = `${EYESETS_DIR}/${BUILTIN_ID}/pupils.json`;
    const builtinFs = await storage.readJson<(FrameAnnotation | null)[]>(builtinPath);
    if (builtinFs) builtin.pupils = builtinFs;
    else {
      const legacy = localStorage.getItem(LEGACY_BUILTIN_PUPILS) || localStorage.getItem(LEGACY_OLD_PUPILS);
      if (legacy) {
        try {
          const parsed = JSON.parse(legacy);
          if (Array.isArray(parsed) && parsed.length === FRAMES_COUNT) {
            builtin.pupils = parsed;
            await storage.writeJson(builtinPath, builtin.pupils);
          }
        } catch {}
      }
    }

    // migración custom sets desde localStorage si fs vacío
    const dirEntries = await storage.list(EYESETS_DIR);
    const userDirs = dirEntries.filter((n) => n !== BUILTIN_ID);
    if (userDirs.length === 0) {
      const legacy = localStorage.getItem(LEGACY_USER_SETS);
      if (legacy) {
        try {
          const arr: { id: string; name: string; framesData?: string[]; pupils: (FrameAnnotation | null)[] }[] =
            JSON.parse(legacy);
          for (const old of arr) {
            const meta: StoredEyeSetMeta = {
              id: old.id,
              name: old.name,
              pupils: old.pupils ?? Array(FRAMES_COUNT).fill(null),
              hasFrame: Array(FRAMES_COUNT).fill(false),
            };
            await storage.writeJson(`${EYESETS_DIR}/${old.id}/meta.json`, meta);
            if (old.framesData) {
              for (let i = 0; i < Math.min(old.framesData.length, FRAMES_COUNT); i++) {
                const du = old.framesData[i];
                if (du && du.startsWith('data:')) {
                  await storage.writeDataUrl(`${EYESETS_DIR}/${old.id}/frames/${i}.bin`, du);
                  meta.hasFrame[i] = true;
                }
              }
              await storage.writeJson(`${EYESETS_DIR}/${old.id}/meta.json`, meta);
            }
          }
          localStorage.removeItem(LEGACY_USER_SETS);
        } catch (e) { console.warn('migración eyesets', e); }
      }
    }

    // leer custom sets desde fs
    const userSets: EyeSet[] = [];
    for (const dirName of (await storage.list(EYESETS_DIR)).filter((n) => n !== BUILTIN_ID)) {
      const meta = await storage.readJson<StoredEyeSetMeta>(`${EYESETS_DIR}/${dirName}/meta.json`);
      if (!meta) continue;
      const set: EyeSet = {
        id: meta.id,
        name: meta.name,
        builtin: false,
        pupils: meta.pupils,
        frameUrls: Array(FRAMES_COUNT).fill(null),
      };
      // cargar blob URLs para frames presentes
      const has = meta.hasFrame ?? Array(FRAMES_COUNT).fill(false);
      for (let i = 0; i < FRAMES_COUNT; i++) {
        if (has[i]) {
          const url = await storage.readAsBlobUrl(`${EYESETS_DIR}/${meta.id}/frames/${i}.bin`, '');
          set.frameUrls![i] = url;
        }
      }
      userSets.push(set);
    }
    this.sets = [builtin, ...userSets];

    try { this.activeId = localStorage.getItem(KEY_ACTIVE) || BUILTIN_ID; } catch {}
    if (!this.sets.find((s) => s.id === this.activeId)) this.activeId = BUILTIN_ID;
    this.loaded = true;
  }

  setActive(id: string) {
    if (!this.sets.find((s) => s.id === id)) return;
    this.activeId = id;
    try { localStorage.setItem(KEY_ACTIVE, id); } catch {}
  }

  setMarker(idx: number, a: FrameAnnotation | null) {
    const s = this.active;
    if (!s) return;
    const next = [...s.pupils];
    next[idx] = a;
    s.pupils = next;
    this.sets = [...this.sets];
    this.persistMeta(s);
  }

  clearActiveMarkers() {
    const s = this.active;
    if (!s) return;
    s.pupils = Array(FRAMES_COUNT).fill(null);
    this.sets = [...this.sets];
    this.persistMeta(s);
  }

  createCustom(name = 'Set nuevo'): EyeSet {
    const s: EyeSet = {
      id: crypto.randomUUID(),
      name,
      builtin: false,
      frameUrls: Array(FRAMES_COUNT).fill(null),
      pupils: Array(FRAMES_COUNT).fill(null),
    };
    this.sets = [...this.sets, s];
    this.activeId = s.id;
    try { localStorage.setItem(KEY_ACTIVE, s.id); } catch {}
    this.persistMeta(s);
    return s;
  }

  duplicate(id: string): EyeSet | null {
    const src = this.sets.find((x) => x.id === id);
    if (!src) return null;
    const copy: EyeSet = {
      id: crypto.randomUUID(),
      name: src.name.replace(/ \(copia\)$/, '') + ' (copia)',
      builtin: false,
      pupils: [...src.pupils],
      frameUrls: Array(FRAMES_COUNT).fill(null),
    };
    this.sets = [...this.sets, copy];
    this.activeId = copy.id;
    try { localStorage.setItem(KEY_ACTIVE, copy.id); } catch {}
    this.persistMeta(copy);
    // si el src era custom y tenía frames, copiarlos
    if (!src.builtin && src.frameUrls) {
      void this.copyFrames(src.id, copy.id);
    }
    return copy;
  }

  private async copyFrames(fromId: string, toId: string) {
    const fromMeta = await storage.readJson<StoredEyeSetMeta>(`${EYESETS_DIR}/${fromId}/meta.json`);
    if (!fromMeta) return;
    const has = fromMeta.hasFrame ?? Array(FRAMES_COUNT).fill(false);
    for (let i = 0; i < FRAMES_COUNT; i++) {
      if (!has[i]) continue;
      const bin = await storage.readBinary(`${EYESETS_DIR}/${fromId}/frames/${i}.bin`);
      if (bin) await storage.writeBinary(`${EYESETS_DIR}/${toId}/frames/${i}.bin`, bin);
    }
    const target = this.sets.find((s) => s.id === toId);
    if (target) {
      target.frameUrls = Array(FRAMES_COUNT).fill(null);
      for (let i = 0; i < FRAMES_COUNT; i++) {
        if (has[i]) {
          target.frameUrls[i] = await storage.readAsBlobUrl(`${EYESETS_DIR}/${toId}/frames/${i}.bin`, '');
        }
      }
      this.sets = [...this.sets];
      this.persistMeta(target);
    }
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
    this.persistMeta(s);
  }

  async setFrameFromFile(setId: string, idx: number, file: File) {
    const s = this.sets.find((x) => x.id === setId);
    if (!s || s.builtin) return;
    const buf = new Uint8Array(await file.arrayBuffer());
    await storage.writeBinary(`${EYESETS_DIR}/${setId}/frames/${idx}.bin`, buf);
    const url = URL.createObjectURL(new Blob([new Uint8Array(buf)]));
    if (!s.frameUrls) s.frameUrls = Array(FRAMES_COUNT).fill(null);
    if (s.frameUrls[idx]) URL.revokeObjectURL(s.frameUrls[idx]!);
    s.frameUrls[idx] = url;
    this.sets = [...this.sets];
    this.persistMeta(s);
  }

  private persistMeta(s: EyeSet) {
    if (s.builtin) {
      void storage.writeJson(`${EYESETS_DIR}/${BUILTIN_ID}/pupils.json`, s.pupils);
      return;
    }
    const meta: StoredEyeSetMeta = {
      id: s.id,
      name: s.name,
      pupils: s.pupils,
      hasFrame: (s.frameUrls ?? Array(FRAMES_COUNT).fill(null)).map((u) => !!u),
    };
    void storage.writeJson(`${EYESETS_DIR}/${s.id}/meta.json`, meta);
  }
}

export const eyeset = new EyeSetStore();
