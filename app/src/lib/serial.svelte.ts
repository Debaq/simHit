import { SerialPort } from 'tauri-plugin-serialplugin';

const FIRMWARE_BAUD = 460800;

class SerialStore {
  connected = $state(false);
  connecting = $state(false);
  portPath = $state<string | null>(null);
  ports = $state<string[]>([]);
  lastError = $state<string | null>(null);
  // última línea leída del firmware (debug)
  lastLine = $state<string>('');
  // valores parseados (yaw/pitch/roll + gyro xyz)
  angle = $state<{ x: number; y: number; z: number }>({ x: 0, y: 0, z: 0 });
  gyro = $state<{ x: number; y: number; z: number }>({ x: 0, y: 0, z: 0 });

  private sp: SerialPort | null = null;
  private buffer = '';

  async listPorts() {
    try {
      const result = await SerialPort.available_ports();
      this.ports = Object.keys(result ?? {});
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
    if (!this.connected || !this.sp) return;
    try {
      await this.sp.write(cmd + '\n');
    } catch (e) {
      this.lastError = String(e);
    }
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
    if (line.startsWith('SimHit') || line.startsWith('No ') || line.startsWith('Init')) return;
    const parts = line.split(';');
    if (parts.length < 6) return;
    const nums = parts.map((p) => Number(p));
    if (nums.some((n) => Number.isNaN(n))) return;
    const [ax, ay, az, gx, gy, gz] = nums;
    this.angle = { x: ax, y: ay, z: az };
    this.gyro = { x: gx, y: gy, z: gz };
  }
}

export const serial = new SerialStore();
