// Capa de almacenamiento sobre Tauri fs (AppData) con fallback a localStorage
// para entornos web (vite preview / SvelteKit SSR build).
//
// Layout en disco (~/.local/share/com.nick.app/):
//   scenarios/<id>.json
//   reports/<id>.json
//   eyesets/<id>/meta.json
//   eyesets/<id>/frames/<n>.<ext>
//
// Las funciones devuelven Promises. Si Tauri fs no está disponible (web puro)
// caen a localStorage con prefijo "simhit:fs:<path>".

import {
  BaseDirectory,
  exists,
  mkdir,
  readDir,
  readFile,
  readTextFile,
  remove,
  writeFile,
  writeTextFile,
} from '@tauri-apps/plugin-fs';

const BASE = BaseDirectory.AppData;

let _hasFs: boolean | null = null;
async function hasFs(): Promise<boolean> {
  if (_hasFs !== null) return _hasFs;
  try {
    await exists('', { baseDir: BASE });
    _hasFs = true;
  } catch {
    _hasFs = false;
  }
  return _hasFs;
}

async function ensureDir(path: string) {
  try {
    if (!(await exists(path, { baseDir: BASE }))) {
      await mkdir(path, { baseDir: BASE, recursive: true });
    }
  } catch (e) {
    console.warn('mkdir', path, e);
  }
}

function lsKey(path: string) { return 'simhit:fs:' + path; }

export const storage = {
  async readJson<T>(path: string): Promise<T | null> {
    if (await hasFs()) {
      try {
        if (!(await exists(path, { baseDir: BASE }))) return null;
        const txt = await readTextFile(path, { baseDir: BASE });
        return JSON.parse(txt) as T;
      } catch (e) { console.warn('readJson', path, e); return null; }
    }
    try {
      const raw = localStorage.getItem(lsKey(path));
      return raw ? (JSON.parse(raw) as T) : null;
    } catch { return null; }
  },

  async writeJson(path: string, data: unknown): Promise<void> {
    const txt = JSON.stringify(data, null, 2);
    if (await hasFs()) {
      const dir = path.split('/').slice(0, -1).join('/');
      if (dir) await ensureDir(dir);
      await writeTextFile(path, txt, { baseDir: BASE });
      return;
    }
    try { localStorage.setItem(lsKey(path), txt); } catch (e) { console.warn(e); }
  },

  async writeBinary(path: string, data: Uint8Array): Promise<void> {
    if (await hasFs()) {
      const dir = path.split('/').slice(0, -1).join('/');
      if (dir) await ensureDir(dir);
      await writeFile(path, data, { baseDir: BASE });
      return;
    }
    // localStorage fallback: base64
    const b64 = btoa(String.fromCharCode(...data));
    try { localStorage.setItem(lsKey(path), b64); } catch (e) { console.warn(e); }
  },

  async readBinary(path: string): Promise<Uint8Array | null> {
    if (await hasFs()) {
      try {
        if (!(await exists(path, { baseDir: BASE }))) return null;
        return await readFile(path, { baseDir: BASE });
      } catch (e) { console.warn('readBinary', path, e); return null; }
    }
    try {
      const b64 = localStorage.getItem(lsKey(path));
      if (!b64) return null;
      return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    } catch { return null; }
  },

  async list(path: string): Promise<string[]> {
    if (await hasFs()) {
      try {
        if (!(await exists(path, { baseDir: BASE }))) return [];
        const entries = await readDir(path, { baseDir: BASE });
        return entries.map((e) => e.name).filter((n): n is string => !!n);
      } catch (e) { console.warn('list', path, e); return []; }
    }
    // localStorage fallback: enumerar claves con prefijo
    const prefix = lsKey(path + '/');
    const out: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) {
        const rest = k.slice(prefix.length);
        if (!rest.includes('/')) out.push(rest);
      }
    }
    return out;
  },

  async remove(path: string): Promise<void> {
    if (await hasFs()) {
      try {
        if (await exists(path, { baseDir: BASE })) {
          await remove(path, { baseDir: BASE, recursive: true });
        }
      } catch (e) { console.warn('remove', path, e); }
      return;
    }
    try { localStorage.removeItem(lsKey(path)); } catch {}
  },

  // dataURL helpers para frames de imagen
  async writeDataUrl(path: string, dataUrl: string): Promise<void> {
    const m = dataUrl.match(/^data:[^;]+;base64,(.+)$/);
    if (!m) throw new Error('dataURL inválido');
    const bin = Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0));
    await this.writeBinary(path, bin);
  },

  async readAsBlobUrl(path: string, mime = 'image/webp'): Promise<string | null> {
    const bin = await this.readBinary(path);
    if (!bin) return null;
    const blob = new Blob([new Uint8Array(bin)], { type: mime });
    return URL.createObjectURL(blob);
  },
};

// Migración: copiar una clave de localStorage a fs si todavía no está en fs
export async function migrateLocalStorage(lsRawKey: string, fsPath: string): Promise<boolean> {
  try {
    if (await hasFs()) {
      // si ya está en fs no hace falta
      const existing = await storage.readJson(fsPath);
      if (existing !== null) return false;
    }
    const raw = localStorage.getItem(lsRawKey);
    if (!raw) return false;
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { parsed = raw; }
    await storage.writeJson(fsPath, parsed);
    return true;
  } catch (e) {
    console.warn('migrate', lsRawKey, e);
    return false;
  }
}
