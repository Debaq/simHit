// Configuración general persistida (modo docente).
import { storage } from './storage';

const PATH = 'settings.json';

export type LaserMode = 'off' | 'on' | 'armed';

type Persisted = { debug?: boolean; laserMode?: LaserMode };

class Settings {
  debug = $state(false);
  laserMode = $state<LaserMode>('off');
  private loaded = false;

  async load() {
    if (this.loaded) return;
    this.loaded = true;
    const data = await storage.readJson<Persisted>(PATH);
    if (data && typeof data.debug === 'boolean') this.debug = data.debug;
    if (data && (data.laserMode === 'off' || data.laserMode === 'on' || data.laserMode === 'armed')) {
      this.laserMode = data.laserMode;
    }
  }

  async save() {
    await storage.writeJson(PATH, {
      debug: this.debug,
      laserMode: this.laserMode,
    } satisfies Persisted);
  }

  async setDebug(v: boolean) {
    this.debug = v;
    await this.save();
  }

  // El $effect del layout aplica el comando al firmware cuando este state cambia.
  async setLaserMode(m: LaserMode) {
    this.laserMode = m;
    await this.save();
  }
}

export const settings = new Settings();
