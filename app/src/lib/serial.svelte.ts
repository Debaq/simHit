import { SerialPort } from 'tauri-plugin-serialplugin';

const FIRMWARE_BAUD = 460800;
// ESP32 hace autoreset al abrir DTR; esperar a "SimHit start" o este timeout.
const BOOT_TIMEOUT_MS = 3000;
const STORAGE_KEY = 'simhit:sensorAxes';

// CRC-16 CCITT (poly 0x1021, init 0xFFFF, sin reflexion). Replica el calculo
// del firmware. Aplicado sobre el payload (todo lo previo al ;CRC final).
function crc16Ccitt(s: string): number {
  let crc = 0xffff;
  for (let i = 0; i < s.length; i++) {
    crc ^= (s.charCodeAt(i) & 0xff) << 8;
    for (let b = 0; b < 8; b++) {
      crc = (crc & 0x8000) ? (((crc << 1) ^ 0x1021) & 0xffff) : ((crc << 1) & 0xffff);
    }
  }
  return crc & 0xffff;
}

export type FirmwareVersion = 'legacy' | 'extended' | 'unknown';
export type AccelFilterMode = 'SG' | 'IIR' | 'NONE';

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
  // true tras "IMU CAL done"; false al conectar/desconectar
  calibrated = $state(false);
  // valores parseados (yaw/pitch/roll + gyro xyz, ya en ° y °/s)
  angle = $state<{ x: number; y: number; z: number }>({ x: 0, y: 0, z: 0 });
  gyro = $state<{ x: number; y: number; z: number }>({ x: 0, y: 0, z: 0 });
  // Aceleracion angular (°/s²) provista por el firmware extendido. En
  // firmware legacy queda en 0 y firmwareVersion === 'legacy'.
  angularAccelX = $state(0);
  angularAccelY = $state(0);
  angularAccelZ = $state(0);
  // Aceleracion lineal del LSM303 (m/s²). Vector crudo del cuerpo: NO se
  // aplica el mapeo de ejes 'axes' (eso es para orientacion / vel angular).
  linearAccelX = $state(0);
  linearAccelY = $state(0);
  linearAccelZ = $state(0);
  // Timestamp del firmware (ms desde boot) reportado en la ultima trama.
  fwTimestamp = $state(0);
  // Diagnostico
  crcErrors = $state(0);
  firmwareVersion = $state<FirmwareVersion>('unknown');
  // Cola de muestras gyro desde el último drenado por simulator. Evita
  // pérdidas por bursts USB y jitter del setInterval del tick.
  private gyroQueue: Array<{ x: number; y: number; z: number }> = [];
  // Cola de aceleracion angular alineada muestra a muestra con gyroQueue.
  // Cuando llega firmware legacy, los valores son 0 (no usados).
  private angAccelQueue: Array<{ x: number; y: number; z: number }> = [];
  // Cola de aceleracion lineal alineada con las anteriores.
  private linAccelQueue: Array<{ x: number; y: number; z: number }> = [];
  // Rate-limit de warnings por linea malformada (1/seg).
  private lastBadLineWarnMs = 0;
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
  // Aceleracion angular mapeada (misma convencion de ejes que el gyro: es
  // su derivada temporal, mismas componentes fisicas).
  get angularAccelYaw()   { const m = this.axes.gyro.yaw;   return this.angAccelVec[m.axis] * m.sign; }
  get angularAccelPitch() { const m = this.axes.gyro.pitch; return this.angAccelVec[m.axis] * m.sign; }
  get angularAccelRoll()  { const m = this.axes.gyro.roll;  return this.angAccelVec[m.axis] * m.sign; }
  private get angAccelVec() {
    return { x: this.angularAccelX, y: this.angularAccelY, z: this.angularAccelZ };
  }

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
    this.calibrated = false;
    this.firmwareVersion = 'unknown';
    this.crcErrors = 0;
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
    this.calibrated = false;
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
      if (line.startsWith('IMU CAL done')) this.calibrated = true;
      else if (line.startsWith('IMU CAL fail')) this.calibrated = false;
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
        line.startsWith('Accel filter') ||
        line.startsWith('IMU STATUS') || line.startsWith('MAG STATUS') ||
        line.startsWith('IMU CLR') || line.startsWith('MAG CLR') || line === 'HELLO') {
      return;
    }
    if (line.startsWith('FILTER ')) {
      // Respuesta a "FILTER STATUS" o eco de set: "FILTER STATUS SG" o "FILTER SG".
      const rest = line.slice(7).trim();
      const tokens = rest.split(/\s+/);
      const modeToken = tokens[tokens.length - 1];
      if (modeToken === 'SG' || modeToken === 'IIR' || modeToken === 'NONE') {
        this.filterStatusResolve?.(modeToken);
      }
      return;
    }
    const parts = line.split(';');
    // Formato legacy: 6 floats (angX/Y/Z, gyroX/Y/Z).
    // Formato extendido: 14 campos (12 floats + tsMs uint + crc hex).
    if (parts.length === 6) {
      // Si todavia no detectamos version, este es el primer paquete: legacy.
      if (this.firmwareVersion === 'unknown') {
        this.firmwareVersion = 'legacy';
        console.info('[serial] firmware legacy detectado (6 campos)');
      }
      const nums = parts.map((p) => Number(p));
      if (nums.some((n) => Number.isNaN(n))) return;
      const [ax, ay, az, gx, gy, gz] = nums;
      this.applySample(ax, ay, az, gx, gy, gz, 0, 0, 0, 0, 0, 0, 0);
      return;
    }
    if (parts.length === 14) {
      // Validar CRC: payload son los primeros 13 campos unidos por ';'.
      const crcStr = parts[13];
      const payload = parts.slice(0, 13).join(';');
      const crcExpected = crc16Ccitt(payload);
      const crcReceived = parseInt(crcStr, 16);
      if (!Number.isFinite(crcReceived) || crcReceived !== crcExpected) {
        this.crcErrors++;
        return;
      }
      const ax = Number(parts[0]),  ay = Number(parts[1]),  az = Number(parts[2]);
      const gx = Number(parts[3]),  gy = Number(parts[4]),  gz = Number(parts[5]);
      const aax = Number(parts[6]), aay = Number(parts[7]), aaz = Number(parts[8]);
      const lax = Number(parts[9]), lay = Number(parts[10]), laz = Number(parts[11]);
      const ts  = Number(parts[12]);
      if ([ax, ay, az, gx, gy, gz, aax, aay, aaz, lax, lay, laz, ts].some(Number.isNaN)) return;
      if (this.firmwareVersion !== 'extended') {
        this.firmwareVersion = 'extended';
        console.info('[serial] firmware extendido detectado (14 campos + CRC)');
      }
      this.applySample(ax, ay, az, gx, gy, gz, aax, aay, aaz, lax, lay, laz, ts);
      return;
    }
    // Recuento de campos no reconocido: ignorar con warn rate-limited.
    const nowMs = Date.now();
    if (nowMs - this.lastBadLineWarnMs > 1000) {
      this.lastBadLineWarnMs = nowMs;
      console.warn(`[serial] linea con ${parts.length} campos ignorada`);
    }
  }

  // Aplica una muestra parseada al estado reactivo y a las colas internas.
  // Los argumentos de aceleracion van en 0 cuando el firmware es legacy.
  private applySample(
    ax: number, ay: number, az: number,
    gx: number, gy: number, gz: number,
    aax: number, aay: number, aaz: number,
    lax: number, lay: number, laz: number,
    ts: number,
  ) {
    this.angle = { x: ax, y: ay, z: az };
    this.gyro  = { x: gx, y: gy, z: gz };
    this.angularAccelX = aax; this.angularAccelY = aay; this.angularAccelZ = aaz;
    this.linearAccelX  = lax; this.linearAccelY  = lay; this.linearAccelZ  = laz;
    this.fwTimestamp = ts;
    this.gyroQueue.push({ x: gx, y: gy, z: gz });
    this.angAccelQueue.push({ x: aax, y: aay, z: aaz });
    this.linAccelQueue.push({ x: lax, y: lay, z: laz });
    // Cap defensivo: si nadie drena (sim parado), no crecer sin límite.
    // Las tres colas se mantienen alineadas: si truncamos una, truncamos
    // las tres por el mismo lado.
    if (this.gyroQueue.length > 256) {
      const excess = this.gyroQueue.length - 256;
      this.gyroQueue.splice(0, excess);
      this.angAccelQueue.splice(0, excess);
      this.linAccelQueue.splice(0, excess);
    }
  }

  // Drena cola de gyro (yaw + pitch en paralelo) desde último tick.
  // Devuelve dos arrays alineados muestra a muestra. Si nadie llama a
  // drainGyroYaw/Pitch entre ticks, el simulator consume ambos canales en
  // un mismo drenaje para garantizar el alineamiento.
  drainGyro(): { yaw: number[]; pitch: number[] } {
    const my = this.axes.gyro.yaw;
    const mp = this.axes.gyro.pitch;
    const yaw = this.gyroQueue.map((s) => s[my.axis] * my.sign);
    const pitch = this.gyroQueue.map((s) => s[mp.axis] * mp.sign);
    this.gyroQueue.length = 0;
    // Mantener angAccel/linAccel alineadas con gyro: drainGyro las descarta.
    // Quien quiera consumir la accel angular debe usar drainAll().
    this.angAccelQueue.length = 0;
    this.linAccelQueue.length = 0;
    return { yaw, pitch };
  }

  // Drena gyro + aceleracion angular + aceleracion lineal en paralelo. Las
  // tres listas quedan alineadas muestra a muestra (mismo largo). Vacia las
  // colas. Usado por el simulador cuando necesita capturar accel junto al
  // gyro durante un impulso.
  drainAll(): {
    yaw: number[]; pitch: number[];
    angAccelYaw: number[]; angAccelPitch: number[];
    linAccel: Array<{ x: number; y: number; z: number }>;
  } {
    const my = this.axes.gyro.yaw;
    const mp = this.axes.gyro.pitch;
    const yaw = this.gyroQueue.map((s) => s[my.axis] * my.sign);
    const pitch = this.gyroQueue.map((s) => s[mp.axis] * mp.sign);
    const angAccelYaw   = this.angAccelQueue.map((s) => s[my.axis] * my.sign);
    const angAccelPitch = this.angAccelQueue.map((s) => s[mp.axis] * mp.sign);
    const linAccel = this.linAccelQueue.map((s) => ({ x: s.x, y: s.y, z: s.z }));
    this.gyroQueue.length = 0;
    this.angAccelQueue.length = 0;
    this.linAccelQueue.length = 0;
    return { yaw, pitch, angAccelYaw, angAccelPitch, linAccel };
  }

  // Drains individuales de aceleracion angular (mismos ejes que el gyro).
  // No usar junto con drainGyro/drainAll en el mismo tick: cada drain vacia.
  drainGyroAccelX(): number[] {
    const out = this.angAccelQueue.map((s) => s.x);
    this.angAccelQueue.length = 0;
    return out;
  }
  drainGyroAccelY(): number[] {
    const out = this.angAccelQueue.map((s) => s.y);
    this.angAccelQueue.length = 0;
    return out;
  }
  drainGyroAccelZ(): number[] {
    const out = this.angAccelQueue.map((s) => s.z);
    this.angAccelQueue.length = 0;
    return out;
  }

  // Drena la aceleracion lineal cruda (sin mapear por axes; es un vector
  // fisico del cuerpo, no orientacion).
  drainLinearAccel(): Array<{ x: number; y: number; z: number }> {
    const out = this.linAccelQueue.map((s) => ({ x: s.x, y: s.y, z: s.z }));
    this.linAccelQueue.length = 0;
    return out;
  }

  // Selecciona el modo de filtro de la derivada del gyro en el firmware.
  // El firmware persiste el valor en NVS; este metodo solo envia el comando.
  async setAccelFilter(mode: AccelFilterMode): Promise<void> {
    await this.sendCommand(`FILTER ${mode}`);
  }

  // Pide el modo actual al firmware. Espera la respuesta "FILTER STATUS X"
  // hasta 500 ms. Retorna null si timeout o firmware legacy.
  async getAccelFilter(): Promise<AccelFilterMode | null> {
    if (!this.sp) return null;
    return new Promise<AccelFilterMode | null>((resolve) => {
      const timeout = setTimeout(() => {
        this.filterStatusResolve = null;
        resolve(null);
      }, 500);
      this.filterStatusResolve = (mode) => {
        clearTimeout(timeout);
        this.filterStatusResolve = null;
        resolve(mode);
      };
      void this.sendCommand('FILTER STATUS');
    });
  }

  private filterStatusResolve: ((mode: AccelFilterMode | null) => void) | null = null;

  // Drena cola de gyro (mapeada a yaw del eje configurado) desde último tick.
  // Conservado para compatibilidad con llamadores que no consumen pitch.
  // Vacía la cola, igual que drainGyro.
  drainGyroYaw(): number[] {
    const m = this.axes.gyro.yaw;
    const out = this.gyroQueue.map((s) => s[m.axis] * m.sign);
    this.gyroQueue.length = 0;
    return out;
  }

  // Drena cola de gyro mapeada a pitch. Análogo a drainGyroYaw.
  // No usar junto con drainGyroYaw en el mismo tick: cada drain vacía la
  // cola. Para consumo combinado usar drainGyro().
  drainGyroPitch(): number[] {
    const m = this.axes.gyro.pitch;
    const out = this.gyroQueue.map((s) => s[m.axis] * m.sign);
    this.gyroQueue.length = 0;
    return out;
  }
}

export const serial = new SerialStore();
