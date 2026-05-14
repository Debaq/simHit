import { SerialPort } from 'tauri-plugin-serialplugin';

const FIRMWARE_BAUD = 460800;
// ESP32 hace autoreset al abrir DTR; esperar a "SimHit start" o este timeout.
const BOOT_TIMEOUT_MS = 3000;
const STORAGE_KEY = 'simhit:sensorAxes';
// Tiempo de escucha por puerto al sondear con HELLO. El ESP32 puede estar
// reiniciandose por el DTR al abrir el puerto, asi que damos margen para el
// banner de boot ademas de la respuesta directa a HELLO.
const PROBE_TIMEOUT_MS = 2000;

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

// Sensor identificado por el firmware en el banner de boot. addr y whoami son
// strings hex (p.ej. '0x6B', '0xD7') tal como el firmware los emite, para que
// la UI los muestre sin reformatear. `family` clasifica para tablas y
// comparaciones contra referencias (datasheets) en el módulo de métricas.
export type DetectedSensor = {
  addr: string;
  whoami: string;
  name: string;
  family: 'L3G4200D' | 'L3GD20' | 'L3GD20H' | 'ICM-42688' | 'MPU9250' | 'BNO055' | 'MPU-6050' | 'ITG-3205' | 'ICM-20948' | 'unknown';
  raw: string;
};

// Estado de calibración IMU reportado por el firmware (>= v1.2.0) vía las
// líneas estructuradas "IMU CAL JSON {...}" (post-CAL) y "IMU STATUS JSON {...}"
// (post-conexión). Todos los valores son los del firmware sin re-procesar.
export type ImuCalState = {
  bias_dps: [number, number, number];
  sd_dps: [number, number, number];
  accel_mag_ms2: number;
  accel_sd_ms2: number;
  temp_c: number | null;
  // ts_ms en el dominio millis() del firmware (post-boot). cal_ts_ms aparece
  // solo en IMU STATUS JSON; en IMU CAL JSON el campo se llama ts_ms.
  cal_ts_ms: number;
  // En STATUS llega también now_ms (millis al momento del query) para que
  // el cliente calcule edad de la CAL sin asumir relojes alineados.
  now_ms?: number;
  samples?: number;
  odr_ms?: number;
  fw_hash?: string;
  driver?: number;
  // Wall-clock del host al recibir el mensaje, para reportar "última CAL hace X".
  received_at: number;
};

// Razones de fallo estructuradas para la UI. Vienen del firmware como
// "IMU CAL fail <reason> <kv pairs>".
export type ImuCalFailure = {
  reason: 'motion' | 'preheat' | 'repeats' | 'gravity' | 'accel_noise' | 'unknown';
  raw: string;
  // Subset de campos que algunos modos exponen.
  sd_dps?: [number, number, number];
  limit_dps?: number;
  remain_ms?: number;
  boot_ms?: number;
  accel_mag_ms2?: number;
  accel_sd_ms2?: number;
  repeats?: number;
  total?: number;
};

// Muestra cruda emitida en cada parseLine() exitoso. Sin mapeo de ejes:
// los componentes son los del sensor físico tal como los provee el firmware.
export type RawSample = {
  ax: number; ay: number; az: number;     // orientación (°)
  gx: number; gy: number; gz: number;     // velocidad angular (°/s)
  aax: number; aay: number; aaz: number;  // aceleración angular (°/s²), 0 en legacy
  lax: number; lay: number; laz: number;  // aceleración lineal (m/s²), 0 en legacy
  mx: number; my: number; mz: number;     // magnetómetro (µT), NaN si no soportado
  tempC: number;                           // temperatura del chip (°C), NaN si no soportada
  tsMs: number;                            // timestamp del firmware (ms desde boot)
};
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

// Serializa AxesConfig al formato compacto de 12 chars que entiende el
// firmware (cmd "AXES SET"). Orden: pose.yaw, pose.pitch, pose.roll,
// gyro.yaw, gyro.pitch, gyro.roll. Cada par es <axis><sign> ej. "x+".
export function serializeAxes12(c: AxesConfig): string {
  const enc = (m: AxisMap) => m.axis + (m.sign === 1 ? '+' : '-');
  return enc(c.pose.yaw) + enc(c.pose.pitch) + enc(c.pose.roll)
       + enc(c.gyro.yaw) + enc(c.gyro.pitch) + enc(c.gyro.roll);
}

// Parsea el JSON emitido por el firmware ≥ 1.4.0 en respuesta a AXES GET y en
// boot ("AXES JSON {...}"). Retorna null si la estructura es inválida.
function parseAxesJsonPayload(jsonStr: string): AxesConfig | null {
  try {
    const obj = JSON.parse(jsonStr);
    const validAxis = (a: unknown): a is Axis => a === 'x' || a === 'y' || a === 'z';
    const validSign = (s: unknown): s is 1 | -1 => s === 1 || s === -1;
    const parseMap = (m: unknown): AxisMap | null => {
      if (!m || typeof m !== 'object') return null;
      const o = m as { axis?: unknown; sign?: unknown };
      if (!validAxis(o.axis) || !validSign(o.sign)) return null;
      return { axis: o.axis, sign: o.sign };
    };
    const parseTriple = (t: unknown) => {
      if (!t || typeof t !== 'object') return null;
      const o = t as Record<string, unknown>;
      const yaw = parseMap(o.yaw), pitch = parseMap(o.pitch), roll = parseMap(o.roll);
      if (!yaw || !pitch || !roll) return null;
      return { yaw, pitch, roll };
    };
    const pose = parseTriple(obj.pose);
    const gyro = parseTriple(obj.gyro);
    if (!pose || !gyro) return null;
    return { pose, gyro };
  } catch {
    return null;
  }
}

class SerialStore {
  connected = $state(false);
  connecting = $state(false);
  // True mientras refreshAndAutoSelect() esta sondeando puertos con HELLO.
  // La UI deshabilita el dropdown / boton refresh durante este lapso.
  probing = $state(false);
  portPath = $state<string | null>(null);
  // Lista mostrada en la UI: solo puertos confirmados como SimHIT (post-probe)
  // o todos los disponibles si todavia no se sondeo (fallback de listPorts).
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
  // Snapshot estructurado de la CAL IMU (firmware ≥ 1.2.0). Null en firmwares
  // viejos o cuando no hay CAL persistida.
  imuCal = $state<ImuCalState | null>(null);
  // Razón del último fail de CAL, si lo hubo. Se limpia al iniciar un nuevo
  // intento o al desconectar.
  imuCalFailure = $state<ImuCalFailure | null>(null);
  // Temperatura del chip leída en la última muestra IMU. NaN si el sensor
  // no la expone. Permite detectar drift térmico entre CALs.
  currentTempC = $state<number>(NaN);
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
  // Sensor giroscopio detectado por el firmware en el banner de boot.
  // Null hasta que se reciba la primera línea "Gyro WHO_AM_I ...".
  detectedSensor = $state<DetectedSensor | null>(null);
  // Versión del firmware (semver) reportada por el banner "SimHit FW x.y.z"
  // o por la respuesta a "VERSION". Null mientras no se haya recibido.
  firmwareVersionString = $state<string | null>(null);
  // MAC del ESP32 (chip-id). Reportado en el banner como "SimHit MAC AA:BB:..."
  espMacAddress = $state<string | null>(null);
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
  // Sumideros de captura raw: callbacks que reciben cada muestra completa
  // tal cual la emite el firmware (sin mapeo de ejes). Usado por el módulo
  // de métricas para persistir a CSV sin pasar por las colas del simulador.
  private captureSinks: Array<(s: RawSample) => void> = [];
  // mapeo configurable de ejes
  axes = $state<AxesConfig>(loadAxes());
  // True después de recibir un "AXES JSON" del firmware ≥ 1.4.0. La UI lo usa
  // para indicar que el mapeo está persistido en NVS y se comparte entre PCs.
  axesFromFirmware = $state(false);

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

  // Persiste el mapeo en el NVS del firmware (≥ 1.4.0). Actualiza también el
  // estado local cuando el firmware confirma (vía "AXES JSON" en respuesta).
  // En firmwares viejos el comando se ignora silenciosamente: caemos a
  // localStorage como antes.
  async writeAxesToFirmware(next: AxesConfig) {
    this.setAxes(next);
    if (!this.sp) return;
    await this.sendCommand(`AXES SET ${serializeAxes12(next)}`);
  }

  async resetAxesOnFirmware() {
    if (!this.sp) {
      this.resetAxes();
      return;
    }
    await this.sendCommand('AXES RESET');
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

  // Intenta identificar un puerto como SimHIT abriendolo, enviando "HELLO\n"
  // y observando si responde con "HELLO" o con el banner de boot del firmware
  // (cuando el ESP32 esta reiniciando por el DTR al abrir el puerto).
  // No deja el puerto abierto: siempre cierra antes de retornar.
  private async probeOne(path: string): Promise<boolean> {
    // Pequenio retry si el puerto reporta ocupado justo despues de cerrarse
    // en el probe anterior (algunos backends del plugin tardan en liberar fd).
    let sp: SerialPort | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        sp = new SerialPort({ path, baudRate: FIRMWARE_BAUD });
        await sp.open();
        break;
      } catch (e) {
        sp = null;
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 100));
          continue;
        }
        // Puerto inaccesible (ocupado, sin permiso, no existe): no es SimHIT.
        console.info(`[serial probe] no se pudo abrir ${path}:`, String(e));
        return false;
      }
    }
    if (!sp) return false;

    let buffer = '';
    let matched = false;
    const onLine = (line: string) => {
      // Match estricto: respuesta directa a HELLO o banner del firmware.
      // El firmware imprime exactamente "HELLO" tras recibir el comando,
      // y "SimHit configure" / "SimHit start" durante el setup.
      if (line === 'HELLO' || line.includes('HELLO')) {
        matched = true;
        return;
      }
      if (line.includes('SimHit configure') || line.includes('SimHit start')) {
        matched = true;
      }
    };
    const onData = (data: Uint8Array | string) => {
      const chunk = typeof data === 'string' ? data : new TextDecoder().decode(data);
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) onLine(line);
      }
    };

    try {
      await sp.startListening();
      await sp.listen(onData, false);
      // Si el ESP32 ya esta corriendo (no se reseteo), HELLO obtiene
      // respuesta inmediata. Si se acaba de resetear por DTR, el banner
      // de boot llega solo, tambien contara como match.
      try { await sp.write('HELLO\n'); } catch { /* puerto puede haber muerto */ }

      const t0 = Date.now();
      while (Date.now() - t0 < PROBE_TIMEOUT_MS) {
        if (matched) break;
        await new Promise((r) => setTimeout(r, 50));
      }
    } catch (e) {
      console.info(`[serial probe] error sondeando ${path}:`, String(e));
    } finally {
      try { await sp.stopListening(); } catch { /* ignore */ }
      try { await sp.close(); } catch { /* ignore */ }
    }
    return matched;
  }

  // Sondea secuencialmente cada puerto disponible (excluidos ttyS*) y
  // devuelve la lista con el flag isSimHit. Secuencial para evitar contencion
  // de recursos del plugin serial.
  async probePorts(): Promise<{ path: string; isSimHit: boolean }[]> {
    let candidates: string[] = [];
    try {
      const result = await SerialPort.available_ports();
      candidates = Object.keys(result ?? {}).filter((p) => !/ttyS\d+$/i.test(p));
      this.lastError = null;
    } catch (e) {
      this.lastError = `Error al listar puertos: ${String(e)}`;
      return [];
    }
    const out: { path: string; isSimHit: boolean }[] = [];
    for (const path of candidates) {
      const isSimHit = await this.probeOne(path);
      out.push({ path, isSimHit });
    }
    return out;
  }

  // Refresca la lista de puertos sondeando cada uno con HELLO y autoselecciona
  // si hay exactamente un SimHIT detectado. NO conecta automaticamente: la
  // conexion sigue siendo manual via connect().
  async refreshAndAutoSelect(): Promise<void> {
    // No tocar puertos durante una conexion activa: cerrar/abrir interrumpiria
    // la sesion en curso.
    if (this.connected || this.connecting) return;
    if (this.probing) return;
    this.probing = true;
    try {
      const results = await this.probePorts();
      const simhitPaths = results.filter((r) => r.isSimHit).map((r) => r.path);
      this.ports = simhitPaths;
      if (simhitPaths.length === 1) {
        this.portPath = simhitPaths[0];
      } else if (this.portPath && !simhitPaths.includes(this.portPath)) {
        // La seleccion previa ya no esta disponible.
        this.portPath = null;
      }
    } finally {
      this.probing = false;
    }
  }

  async connect(path: string) {
    if (this.connected || this.connecting) return;
    this.connecting = true;
    this.lastError = null;
    this.calibrated = false;
    this.firmwareVersion = 'unknown';
    this.crcErrors = 0;
    this.detectedSensor = null;
    this.firmwareVersionString = null;
    this.espMacAddress = null;
    this.axesFromFirmware = false;
    try {
      this.sp = new SerialPort({ path, baudRate: FIRMWARE_BAUD });
      await this.sp.open();
      await this.sp.startListening();
      await this.sp.listen((data) => this.onData(data), false);
      this.portPath = path;
      this.connected = true;

      // Esperar a que el ESP32 termine su boot ("SimHit start") o timeout.
      await this.waitForBoot();
      // Si el banner del boot llegó antes de que adjuntáramos el listener,
      // detectedSensor queda null. Pedir explícitamente al firmware que
      // re-emita el WHO_AM_I (firmware ≥ 1.1.1; en versiones previas se ignora).
      if (!this.detectedSensor) {
        await this.sendCommand('SENSOR');
        // Pequeña ventana para que llegue la respuesta antes de continuar.
        for (let i = 0; i < 10 && !this.detectedSensor; i++) {
          await new Promise((r) => setTimeout(r, 50));
        }
      }
      // Hidratar el snapshot de la CAL IMU persistida (firmware ≥ 1.2.0).
      // En firmwares viejos no llega "IMU STATUS JSON" y queda en null.
      await this.sendCommand('IMU STATUS');
      for (let i = 0; i < 6 && !this.imuCal; i++) {
        await new Promise((r) => setTimeout(r, 50));
      }
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
    this.detectedSensor = null;
    this.firmwareVersionString = null;
    this.espMacAddress = null;
    this.axesFromFirmware = false;
    this.imuCal = null;
    this.imuCalFailure = null;
    this.currentTempC = NaN;
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
    // Líneas JSON estructuradas del firmware ≥ 1.2.0. Se procesan antes del
    // bloque textual para que el snapshot estructurado quede actualizado
    // aunque el cliente ya marcó calibrated=true por la línea textual previa.
    if (line.startsWith('IMU CAL JSON ')) {
      this.parseImuCalJson(line.slice('IMU CAL JSON '.length), false);
      return;
    }
    if (line.startsWith('IMU STATUS JSON ')) {
      this.parseImuCalJson(line.slice('IMU STATUS JSON '.length), true);
      return;
    }
    // Mapeo de ejes persistido por el firmware (≥ 1.4.0). Llega al boot tras
    // el banner MAC y también como respuesta a "AXES GET" o "AXES SET".
    // Sincroniza el estado del cliente: el firmware es la fuente de verdad si
    // el equipo SimHIT se compartió entre PCs.
    if (line.startsWith('AXES JSON ')) {
      const parsed = parseAxesJsonPayload(line.slice('AXES JSON '.length));
      if (parsed) {
        this.axes = parsed;
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed)); } catch { /* ignore */ }
        this.axesFromFirmware = true;
      }
      return;
    }
    if (line.startsWith('AXES SET fail')) {
      this.lastError = line;
      return;
    }

    if (line.startsWith('IMU CAL ') || line.startsWith('MAG CAL ')) {
      this.lastCalLine = line;
      if (line.startsWith('IMU CAL done')) {
        this.calibrated = true;
        this.imuCalFailure = null;
      } else if (line.startsWith('IMU CAL fail')) {
        this.calibrated = false;
        this.parseImuCalFailure(line);
      }
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
    // Banner de versión: "SimHit FW 1.0.0" (boot) o "VERSION 1.0.0" (query).
    {
      const m = line.match(/^(?:SimHit FW|VERSION)\s+(\d+\.\d+\.\d+(?:[-+][\w.]+)?)\s*$/);
      if (m) {
        this.firmwareVersionString = m[1];
        return;
      }
    }
    // Banner de MAC del ESP32: "SimHit MAC AA:BB:CC:DD:EE:FF".
    {
      const m = line.match(/^SimHit MAC\s+([0-9A-Fa-f:]{17})\s*$/);
      if (m) {
        this.espMacAddress = m[1].toUpperCase();
        return;
      }
    }
    // Banner del firmware: "Gyro WHO_AM_I @0x6B = 0xD7 (L3GD20H)".
    // Capturamos el primer match válido (descarta candidatos sin respuesta).
    if (line.startsWith('Gyro WHO_AM_I')) {
      const m = line.match(/@0x([0-9A-Fa-f]{1,2})\s*=\s*0x([0-9A-Fa-f]{1,2})\s*\(([^)]+)\)/);
      if (m) {
        const name = m[3].trim();
        const family: DetectedSensor['family'] =
          name.includes('L3GD20H')   ? 'L3GD20H'   :
          name.includes('L3GD20')    ? 'L3GD20'    :
          name.includes('L3G4200D')  ? 'L3G4200D'  :
          name.includes('ICM-20948') ? 'ICM-20948' :
          name.includes('ICM-42688') ? 'ICM-42688' :
          name.includes('MPU-6050')  ? 'MPU-6050'  :
          name.includes('MPU9250')   ? 'MPU9250'   :
          name.includes('BNO055')    ? 'BNO055'    :
          name.includes('ITG-3205')  ? 'ITG-3205'  : 'unknown';
        // Solo registrar identificaciones reconocidas (descarta "desconocido").
        if (family !== 'unknown') {
          this.detectedSensor = {
            addr: '0x' + m[1].toUpperCase(),
            whoami: '0x' + m[2].toUpperCase(),
            name,
            family,
            raw: line,
          };
        }
      }
      return;
    }
    if (line.startsWith('SimHit') || line.startsWith('No ') || line.startsWith('Init') ||
        line.startsWith('Mag cal') ||
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
      this.applySample(ax, ay, az, gx, gy, gz, 0, 0, 0, 0, 0, 0, NaN, NaN, NaN, NaN, 0);
      return;
    }
    if (parts.length === 18) {
      // Formato v1.1: 12 floats originales + magX/Y/Z + tempC + tsMs + CRC.
      const crcStr = parts[17];
      const payload = parts.slice(0, 17).join(';');
      const crcExpected = crc16Ccitt(payload);
      const crcReceived = parseInt(crcStr, 16);
      if (!Number.isFinite(crcReceived) || crcReceived !== crcExpected) {
        this.crcErrors++;
        return;
      }
      const f = (i: number) => Number(parts[i]);
      const ax = f(0), ay = f(1), az = f(2);
      const gx = f(3), gy = f(4), gz = f(5);
      const aax = f(6), aay = f(7), aaz = f(8);
      const lax = f(9), lay = f(10), laz = f(11);
      const mx = f(12), my = f(13), mz = f(14);
      const tempC = f(15);
      const ts = f(16);
      // Mag/temp pueden ser NaN deliberadamente; chequear solo los obligatorios.
      if ([ax, ay, az, gx, gy, gz, aax, aay, aaz, lax, lay, laz, ts].some(Number.isNaN)) return;
      if (this.firmwareVersion !== 'extended') {
        this.firmwareVersion = 'extended';
        console.info('[serial] firmware v1.1 detectado (18 campos con mag+temp)');
      }
      this.applySample(ax, ay, az, gx, gy, gz, aax, aay, aaz, lax, lay, laz, mx, my, mz, tempC, ts);
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
        console.info('[serial] firmware v1.0 detectado (14 campos)');
      }
      this.applySample(ax, ay, az, gx, gy, gz, aax, aay, aaz, lax, lay, laz, NaN, NaN, NaN, NaN, ts);
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
    mx: number, my: number, mz: number,
    tempC: number,
    ts: number,
  ) {
    this.angle = { x: ax, y: ay, z: az };
    this.gyro  = { x: gx, y: gy, z: gz };
    this.angularAccelX = aax; this.angularAccelY = aay; this.angularAccelZ = aaz;
    this.linearAccelX  = lax; this.linearAccelY  = lay; this.linearAccelZ  = laz;
    this.fwTimestamp = ts;
    if (Number.isFinite(tempC)) this.currentTempC = tempC;
    this.gyroQueue.push({ x: gx, y: gy, z: gz });
    this.angAccelQueue.push({ x: aax, y: aay, z: aaz });
    this.linAccelQueue.push({ x: lax, y: lay, z: laz });
    // Notificar a sumideros de captura. Wrapping en try para que una captura
    // que falle no rompa el stream principal del simulador.
    if (this.captureSinks.length > 0) {
      const raw: RawSample = { ax, ay, az, gx, gy, gz, aax, aay, aaz, lax, lay, laz, mx, my, mz, tempC, tsMs: ts };
      for (const sink of this.captureSinks) {
        try { sink(raw); } catch (e) { console.warn('[serial] captureSink error', e); }
      }
    }
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

  // Registra un sumidero de captura raw. Devuelve una función para desregistrar.
  // Las muestras llegan en el orden en que el firmware las emitió, sin mapeo
  // de ejes y sin filtrado del simulador.
  addCaptureSink(sink: (s: RawSample) => void): () => void {
    this.captureSinks.push(sink);
    return () => {
      const i = this.captureSinks.indexOf(sink);
      if (i >= 0) this.captureSinks.splice(i, 1);
    };
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

  // Parser de "IMU CAL JSON {...}" y "IMU STATUS JSON {...}". Conserva NaN-safe
  // y tolera campos faltantes: el cliente nunca debe romperse por un firmware
  // futuro que agregue claves nuevas.
  private parseImuCalJson(payload: string, isStatus: boolean) {
    let obj: Record<string, unknown>;
    try { obj = JSON.parse(payload); }
    catch (e) { console.warn('[serial] IMU CAL JSON inválido', payload, e); return; }
    const arr3 = (k: string): [number, number, number] | null => {
      const v = obj[k];
      if (!Array.isArray(v) || v.length !== 3) return null;
      return [Number(v[0]), Number(v[1]), Number(v[2])];
    };
    const num = (k: string): number => {
      const v = obj[k];
      return typeof v === 'number' ? v : Number(v);
    };
    const numOrNull = (k: string): number | null => {
      const v = obj[k];
      if (v === null || v === undefined) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const bias = arr3('bias_dps');
    const sd = arr3('sd_dps');
    if (!bias || !sd) return;
    this.imuCal = {
      bias_dps: bias,
      sd_dps: sd,
      accel_mag_ms2: num('accel_mag_ms2'),
      accel_sd_ms2: num('accel_sd_ms2'),
      temp_c: numOrNull('temp_c'),
      // STATUS usa cal_ts_ms; CAL usa ts_ms.
      cal_ts_ms: num(isStatus ? 'cal_ts_ms' : 'ts_ms'),
      now_ms: isStatus ? num('now_ms') : undefined,
      samples: numOrNull('samples') ?? undefined,
      odr_ms: numOrNull('odr_ms') ?? undefined,
      fw_hash: typeof obj.fw_hash === 'string' ? obj.fw_hash : undefined,
      driver: numOrNull('driver') ?? undefined,
      received_at: Date.now(),
    };
    if (!isStatus) {
      // CAL exitosa implica calibrated=true; limpiar cualquier failure previa.
      this.calibrated = true;
      this.imuCalFailure = null;
    }
  }

  // Parser de "IMU CAL fail <reason> <k=v ...>". Devuelve siempre un objeto
  // (con reason='unknown' si no parseó). Las claves específicas varían por modo.
  private parseImuCalFailure(line: string) {
    const body = line.slice('IMU CAL fail '.length).trim();
    const reasonMatch = body.match(/^(motion|preheat|repeats|gravity|accel_noise)\b/);
    const reason = (reasonMatch?.[1] ?? 'unknown') as ImuCalFailure['reason'];
    const f: ImuCalFailure = { reason, raw: line };
    const numKv = (key: string): number | undefined => {
      const m = body.match(new RegExp(`\\b${key}=([\\d.eE+\\-]+)`));
      return m ? Number(m[1]) : undefined;
    };
    const tripleKv = (key: string): [number, number, number] | undefined => {
      const m = body.match(new RegExp(`\\b${key}=([\\d.eE+\\-]+),([\\d.eE+\\-]+),([\\d.eE+\\-]+)`));
      return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
    };
    if (reason === 'motion') {
      f.sd_dps = tripleKv('sd');
      f.limit_dps = numKv('limit');
    } else if (reason === 'preheat') {
      f.remain_ms = numKv('remain_ms');
      f.boot_ms = numKv('boot_ms');
    } else if (reason === 'repeats') {
      // "repeats=N/total"
      const m = body.match(/repeats=(\d+)\/(\d+)/);
      if (m) { f.repeats = Number(m[1]); f.total = Number(m[2]); }
    } else if (reason === 'gravity') {
      f.accel_mag_ms2 = numKv('mag');
    } else if (reason === 'accel_noise') {
      f.accel_sd_ms2 = numKv('sd');
      f.limit_dps = numKv('limit'); // reusa el campo, units m/s²
    }
    this.imuCalFailure = f;
  }

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
