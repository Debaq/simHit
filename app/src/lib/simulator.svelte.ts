// vHIT simulator: genera streams head/eye velocity y eventos de impulsos.
// Usa interval a 200Hz; los gráficos leen los buffers en su propio rAF.

export type Impulse = {
  id: number;
  side: 'LL' | 'RL';
  t: Float64Array;     // ms relativo al pico
  head: Float64Array;  // °/s (signed por dirección)
  eye: Float64Array;   // °/s (signed)
  gain: number;
};

const FS = 200;                 // Hz
const WINDOW_S = 5;
const N = FS * WINDOW_S;        // 1000 muestras
const IMP_DURATION_MS = 350;
const IMP_PEAK_OFFSET = 110;    // ms del pico desde inicio
const IMP_SIGMA = 35;           // ms

class Simulator {
  // estado expuesto a UI
  connected = $state(false);
  running = $state(false);
  gaze = $state(0);                       // -3..3
  blinkFrame = $state<number | null>(null);
  impulsesLL = $state<Impulse[]>([]);
  impulsesRL = $state<Impulse[]>([]);
  // contador de muestras (para charts si lo necesitan)
  rev = $state(0);

  // buffers (no reactivos: uPlot los lee directo)
  tBuf = new Float64Array(N);
  headBuf = new Float64Array(N);
  eyeBuf = new Float64Array(N);

  private startMs = 0;
  private interval?: ReturnType<typeof setInterval>;
  private blinkTimeout?: ReturnType<typeof setTimeout>;
  private impulseStartMs = 0;
  private impulseDir = 0;
  private impulsePeak = 0;
  private impulseGain = 0.9;
  private impulseEyeDelayMs = 7;
  private capturing: null | {
    side: 'LL' | 'RL';
    t: number[];
    head: number[];
    eye: number[];
  } = null;
  private nextImpulseMs = 0;
  private impulseId = 1;

  connect() {
    if (this.connected) return;
    this.connected = true;
    this.startMs = performance.now();
    this.tBuf.fill(0);
    this.headBuf.fill(0);
    this.eyeBuf.fill(0);
    this.interval = setInterval(() => this.tick(), 1000 / FS);
    this.scheduleBlink();
  }

  disconnect() {
    this.connected = false;
    this.running = false;
    clearInterval(this.interval);
    clearTimeout(this.blinkTimeout);
    this.interval = undefined;
    this.blinkTimeout = undefined;
    this.gaze = 0;
    this.blinkFrame = null;
    this.capturing = null;
  }

  startRunning() {
    if (!this.connected) return;
    this.running = true;
    this.scheduleNextImpulse();
  }

  stopRunning() {
    this.running = false;
    this.capturing = null;
    this.gaze = 0;
  }

  clearImpulses() {
    this.impulsesLL = [];
    this.impulsesRL = [];
  }

  private tick() {
    const now = performance.now();
    const tSec = (now - this.startMs) / 1000;

    // ruido de fondo
    let head = (Math.random() - 0.5) * 5;
    let eye = (Math.random() - 0.5) * 3;

    if (this.running) {
      // captura post-impulso
      if (this.capturing && now - this.impulseStartMs > IMP_DURATION_MS + 50) {
        this.commitImpulse();
        this.scheduleNextImpulse();
      }

      // disparar próximo
      if (!this.capturing && now >= this.nextImpulseMs) {
        this.startImpulse();
      }

      // si hay impulso activo, sumar componente determinista
      if (this.capturing && now < this.impulseStartMs + IMP_DURATION_MS) {
        const center = this.impulseStartMs + IMP_PEAK_OFFSET;
        const dt = now - center;
        const bell = Math.exp(-(dt * dt) / (2 * IMP_SIGMA * IMP_SIGMA));
        const headSig = this.impulseDir * this.impulsePeak * bell;

        const dtEye = (now - this.impulseEyeDelayMs) - center;
        const bellEye = Math.exp(-(dtEye * dtEye) / (2 * IMP_SIGMA * IMP_SIGMA));
        const eyeSig = -this.impulseDir * this.impulsePeak * this.impulseGain * bellEye;

        head += headSig;
        eye += eyeSig;

        // gaze para animación del ojo (-3..3)
        const phase = (now - this.impulseStartMs) / IMP_DURATION_MS; // 0..1
        if (phase > 0 && phase < 1) {
          this.gaze = -this.impulseDir * 3 * Math.sin(Math.PI * phase);
        }

        // captura para overlay
        this.capturing.t.push(dt);
        this.capturing.head.push(headSig);
        this.capturing.eye.push(eyeSig);
      } else if (!this.capturing) {
        this.gaze = 0;
      }
    } else {
      this.gaze = 0;
    }

    // shift ring buffer
    this.tBuf.copyWithin(0, 1);
    this.headBuf.copyWithin(0, 1);
    this.eyeBuf.copyWithin(0, 1);
    this.tBuf[N - 1] = tSec;
    this.headBuf[N - 1] = head;
    this.eyeBuf[N - 1] = eye;
    this.rev++;
  }

  private startImpulse() {
    this.impulseDir = Math.random() < 0.5 ? -1 : 1;
    this.impulsePeak = 140 + Math.random() * 80;        // 140–220 °/s
    this.impulseGain = 0.78 + Math.random() * 0.18;     // 0.78–0.96
    this.impulseStartMs = performance.now();
    this.capturing = {
      side: this.impulseDir < 0 ? 'LL' : 'RL',
      t: [],
      head: [],
      eye: [],
    };
  }

  private commitImpulse() {
    if (!this.capturing) return;
    const c = this.capturing;
    const peakHead = Math.max(...c.head.map(Math.abs));
    const peakEye = Math.max(...c.eye.map(Math.abs));
    const gain = peakHead > 0 ? peakEye / peakHead : 0;
    const imp: Impulse = {
      id: this.impulseId++,
      side: c.side,
      t: Float64Array.from(c.t),
      head: Float64Array.from(c.head),
      eye: Float64Array.from(c.eye),
      gain,
    };
    if (c.side === 'LL') this.impulsesLL = [...this.impulsesLL, imp].slice(-15);
    else this.impulsesRL = [...this.impulsesRL, imp].slice(-15);
    this.capturing = null;
  }

  private scheduleNextImpulse() {
    this.nextImpulseMs = performance.now() + 2500 + Math.random() * 3500;
  }

  private scheduleBlink() {
    if (!this.connected) return;
    const wait = 2800 + Math.random() * 3200;
    this.blinkTimeout = setTimeout(() => this.runBlink(), wait);
  }

  private runBlink() {
    if (!this.connected) return;
    const seq = [0, 1, 2, 3, 4, 4, 3, 2, 1, 0];
    let i = 0;
    const step = () => {
      if (!this.connected) { this.blinkFrame = null; return; }
      this.blinkFrame = seq[i];
      i++;
      if (i < seq.length) {
        this.blinkTimeout = setTimeout(step, 55);
      } else {
        this.blinkFrame = null;
        this.scheduleBlink();
      }
    };
    step();
  }
}

export const sim = new Simulator();
