import { SerialPort } from 'tauri-plugin-serialplugin';

const FIRMWARE_BAUD = 460800;
// ESP32 hace autoreset al abrir DTR; esperar a "SimHit start" o este timeout.
const BOOT_TIMEOUT_MS = 3000;
const STORAGE_KEY = 'simhit:sensorAxes';

export type Axis = 'x' | 'y' | 'z';
export type AxisMap = { axis: Axis; sign: 1 | -1 };
export type AxesConfig = {
  // Mapeo de los ejes del sensor (angX/Y/Z = yaw/pitch/roll del firmware)
  // a los DOF de cabeza usados por el simulador.
  pose: { yaw: AxisMap; pitch: AxisMap; roll: AxisMap };
  // Velocidad angular: gyroX/Y/Z del sensor → yaw/pitch/roll del simulador.
  gyro: { yaw: AxisMap; pitch: AxisMap; roll: AxisMap };
};

// Default: firmware emite angX=yaw, angY=pitch, angZ=roll → identidad.
// gyro: yaw=Z (montaje plano sobre cabeza), pitch=X, roll=Y.
const DEFAULT_AXES: AxesConfig = {
  pose: {
    yaw:   { axis: 'x', sign: 1 },
    pitch: { axis: 'y', sign: 1 },
    roll:  { axis: 'z', sign: 1 },
  },
  gyro: {
    yaw:   { axis: 'z', sign: 1 },
    pitch: { axis: 'x', sign: 1 },
    roll:  { axis: 'y', sign: 1 },
  },
};

function loadAxes(): AxesConfig {
  if (typeof localStorage === 'undefined') return DEFAULT_AXES;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_AXES;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_AXES, ...parsed, pose: { ...DEFAULT_AXES.pose, ...(parsed.pose ?? {}) }, gyro: { ...DEFAULT_AXES.gyro, ...(parsed.gyro ?? {}) } };
  } catch {
    return DEFAULT_AXES;
  }
}

class SerialStore {
  connected = $state(false);
  connecting = $state(false);
  portPath = $state<string | null>(null);
  ports = $state<string[]>([]);
  lastError = $state<string | null>(null);
  // última línea leída del firmware (debug)
  lastLine = $state<string>('');
  // última respuesta CAL recibida (no se sobreescribe por tramas IMU)
  lastCalLine = $state<string>('');
  // log completo de la última corrida de MAG CAL (para diagnóstico)
  magCalLog = $state<string[]>([]);
  // valores parseados (yaw/pitch/roll + gyro xyz, ya en ° y °/s)
  angle = $state<{ x: number; y: number; z: number }>({ x: 0, y: 0, z: 0 });
  gyro = $state<{ x: number; y: number; z: number }>({ x: 0, y: 0, z: 0 });
  // Cola de muestras gyro desde el último drenado por simulator. Evita
  // pérdidas por bursts USB y jitter del setInterval del tick.
  private gyroQueue: Array<{ x: number; y: number; z: number }> = [];
  // mapeo configurable de ejes
  axes = $state<AxesConfig>(loadAxes());

  private sp: SerialPort | null = null;
  private buffer = '';
  private bootResolve: (() => void) | null = null;

  // Getters mapeados según axes
  get poseYaw()   { const m = this.axes.pose.yaw;   return this.angle[m.axis] * m.sign; }
  get posePitch() { const m = this.axes.pose.pitch; return this.angle[m.axis] * m.sign; }
  get poseRoll()  { const m = this.axes.pose.roll;  return this.angle[m.axis] * m.sign; }
  get gyroYaw()   { const m = this.axes.gyro.yaw;   return this.gyro[m.axis] * m.sign; }
  get gyroPitch() { const m = this.axes.gyro.pitch; return this.gyro[m.axis] * m.sign; }
  get gyroRoll()  { const m = this.axes.gyro.roll;  return this.gyro[m.axis] * m.sign; }

  setAxes(next: AxesConfig) {
    this.axes = next;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }

  resetAxes() {
    this.setAxes(structuredClone(DEFAULT_AXES));
  }

  async listPorts() {
    try {
      const result = await SerialPort.available_ports();
      this.ports = Object.keys(result ?? {}).filter((p) => !/ttyS\d+$/i.test(p));
      this.lastError = null;
    } catch (e) {
      this.lastError = String(e);
      this.ports = [];
    }
  }

  async connect(path: string) {
    if (this.connected || this.connecting) return;
    this.connecting = true;
    this.lastError = null;
    try {
      this.sp = new SerialPort({ path, baudRate: FIRMWARE_BAUD });
      await this.sp.open();
      await this.sp.startListening();
      await this.sp.listen((data) => this.onData(data), false);
      this.portPath = path;
      this.connected = true;

      // Esperar a que el ESP32 termine su boot ("SimHit start") o timeout.
      await this.waitForBoot();
      // Activar emisión de tramas IMU
      await this.sendCommand('IMU ON');
    } catch (e) {
      this.lastError = String(e);
      this.sp = null;
    } finally {
      this.connecting = false;
    }
  }

  async disconnect() {
    if (!this.connected) return;
    try {
      await this.sendCommand('IMU OFF');
      await this.sp?.stopListening();
      await this.sp?.close();
    } catch (e) {
      this.lastError = String(e);
    }
    this.sp = null;
    this.connected = false;
    this.portPath = null;
    this.buffer = '';
  }

  async sendCommand(cmd: string) {
    if (!this.sp) return;
    try {
      await this.sp.write(cmd + '\n');
    } catch (e) {
      this.lastError = String(e);
    }
  }

  private waitForBoot(): Promise<void> {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => { if (done) return; done = true; this.bootResolve = null; resolve(); };
      this.bootResolve = finish;
      setTimeout(finish, BOOT_TIMEOUT_MS);
    });
  }

  // El firmware emite "angX;angY;angZ;gyroX;gyroY;gyroZ\n"
  private onData(data: Uint8Array | string) {
    let chunk = '';
    if (typeof data === 'string') chunk = data;
    else chunk = new TextDecoder().decode(data);
    this.buffer += chunk;
    let nl;
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (line) this.parseLine(line);
    }
  }

  private parseLine(line: string) {
    this.lastLine = line;
    if (line.startsWith('IMU CAL ') || line.startsWith('MAG CAL ')) {
      this.lastCalLine = line;
      // Capturar todas las líneas de MAG CAL para diagnóstico.
      if (line.startsWith('MAG CAL ')) {
        const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
        this.magCalLog = [...this.magCalLog, `${ts} | ${line}`];
      }
      return;
    }
    if (line === 'SimHit start') {
      this.bootResolve?.();
      return;
    }
    if (line.startsWith('SimHit') || line.startsWith('No ') || line.startsWith('Init') ||
        line.startsWith('Gyro WHO') || line.startsWith('Mag cal') ||
        line.startsWith('IMU STATUS') || line.startsWith('MAG STATUS') ||
        line.startsWith('IMU CLR') || line.startsWith('MAG CLR') || line === 'HELLO') {
      return;
    }
    const parts = line.split(';');
    if (parts.length < 6) return;
    const nums = parts.map((p) => Number(p));
    if (nums.some((n) => Number.isNaN(n))) return;
    const [ax, ay, az, gx, gy, gz] = nums;
    this.angle = { x: ax, y: ay, z: az };
    this.gyro = { x: gx, y: gy, z: gz };
    this.gyroQueue.push({ x: gx, y: gy, z: gz });
    // Cap defensivo: si nadie drena (sim parado), no crecer sin límite
    if (this.gyroQueue.length > 256) this.gyroQueue.splice(0, this.gyroQueue.length - 256);
  }

  // Drena cola de gyro (mapeada a yaw del eje configurado) desde último tick.
  drainGyroYaw(): number[] {
    const m = this.axes.gyro.yaw;
    const out = this.gyroQueue.map((s) => s[m.axis] * m.sign);
    this.gyroQueue.length = 0;
    return out;
  }
}

export const serial = new SerialStore();
