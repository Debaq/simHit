// Configuración general persistida (modo docente).
import { storage } from './storage';

const PATH = 'settings.json';

type Persisted = { debug?: boolean };

class Settings {
  debug = $state(false);
  private loaded = false;

  async load() {
    if (this.loaded) return;
    this.loaded = true;
    const data = await storage.readJson<Persisted>(PATH);
    if (data && typeof data.debug === 'boolean') this.debug = data.debug;
  }

  async save() {
    await storage.writeJson(PATH, { debug: this.debug } satisfies Persisted);
  }

  async setDebug(v: boolean) {
    this.debug = v;
    await this.save();
  }
}

export const settings = new Settings();
