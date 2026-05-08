import type { Scenario, ArtifactConfig, Channel, ChannelConfig } from '$lib/scenario.svelte';
import { eyeset } from '$lib/eyeset.svelte';
import { serial } from '$lib/serial.svelte';
import { acceptance } from '$lib/acceptance.svelte';

export type Impulse = {
  id: number;
  side: 'LL' | 'RL';
  t: Float64Array;
  head: Float64Array;
  eye: Float64Array;
  gain: number;
};

export type ImpulseTrigger = {
  side: 'L' | 'R' | 'random';
  gain: number;          // VOR gain 0..1.5
  peakVel: number;       // °/s
  saccade: 'none' | 'covert' | 'overt';
  artifact?: 'blink' | 'slip' | 'wrong_dir' | 'overshoot' | 'fixation_loss' | null;
};

const FS = 200;

// Integra |velocidad| trapezoidalmente para obtener desplazamiento (°).
function integrateAmplitude(t: Float64Array, head: Float64Array): number {
  if (t.length < 2) return 0;
  let acc = 0;
  for (let i = 1; i < t.length; i++) {
    const dt = (t[i] - t[i - 1]) / 1000; // ms -> s
    acc += 0.5 * (Math.abs(head[i]) + Math.abs(head[i - 1])) * dt;
  }
  return acc;
}

// Heurística simple de aceptación de impulso. Rangos configurables vía
// store `acceptance` (presets principiante / estándar / avanzado / custom).
function evaluateImpulse(imp: Impulse, peakHead: number, gain: number) {
  const cfg = acceptance.active;
  const reasons: string[] = [];
  if (peakHead < cfg.peakMin) reasons.push(`pico bajo (<${cfg.peakMin}°/s)`);
  if (peakHead > cfg.peakMax) reasons.push(`pico excesivo (>${cfg.peakMax}°/s)`);
  if (gain < cfg.gainMin) reasons.push('ganancia muy baja');
  if (gain > cfg.gainMax) reasons.push('ganancia anómala');
  const durMs = imp.t.length ? imp.t[imp.t.length - 1] - imp.t[0] : 0;
  if (durMs < cfg.durMinMs) reasons.push('duración corta');
  if (durMs > cfg.durMaxMs) reasons.push('duración larga');
  const amp = integrateAmplitude(imp.t, imp.head);
  if (amp < cfg.ampMin) reasons.push(`desplazamiento bajo (<${cfg.ampMin}°)`);
  if (amp > cfg.ampMax) reasons.push(`desplazamiento alto (>${cfg.ampMax}°)`);
  return { ok: reasons.length === 0, reasons, peak: peakHead, gain, amp };
}
const WINDOW_S = 5;
const N = FS * WINDOW_S;
const IMP_DURATION_MS = 350;
const IMP_PEAK_OFFSET = 110;
const IMP_SIGMA = 35;
const SACCADE_SIGMA = 16;
const COVERT_OFFSET = 95;     // ms desde inicio del impulso
const OVERT_OFFSET = 240;

// Detección de impulso real desde sensor (°/s)
const IMPULSE_START_THR = 50;
const IMPULSE_END_THR = 20;
const IMPULSE_END_HOLD_MS = 60;
const MIN_IMPULSE_MS = 60;
const MAX_IMPULSE_MS = 600;

class Simulator {
  connected = $state(false);
  cameraOn = $state(false);
  mode = $state<'idle' | 'free' | 'scenario'>('idle');
  currentScenarioName = $state<string | null>(null);
  currentStep = $state<string | null>(null);
  gaze = $state(0);
  blinkFrame = $state<number | null>(null);
  impulsesLL = $state<Impulse[]>([]);
  impulsesRL = $state<Impulse[]>([]);
  rev = $state(0);

  // Pose simulada de la cabeza (mock — luego vendrá del firmware)
  headYaw = $state(0);    // °, neutro = 0; izq < 0; der > 0
  headPitch = $state(0);  // °, lateral neutro ≈ 0; cabeza abajo > 0
  headRoll = $state(0);   // °, neutro = 0; oreja-hombro izq < 0; der > 0
  // Veredicto del último impulso capturado
  lastImpulse = $state<Impulse | null>(null);
  lastVerdict = $state<{ ok: boolean; reasons: string[]; peak: number; gain: number; amp: number } | null>(null);

  // alias para no romper API previa
  get running() { return this.mode !== 'idle'; }

  tBuf = new Float64Array(N);
  headBuf = new Float64Array(N);
  eyeBuf = new Float64Array(N);

  private startMs = 0;
  private interval?: ReturnType<typeof setInterval>;
  private blinkTimeout?: ReturnType<typeof setTimeout>;
  private nextImpulseMs = 0;
  private impulseId = 1;
  private cancelToken = 0;
  private activeScenario: Scenario | null = null;
  private belowSinceMs: number | null = null;

  // Estado suavizado para el plot (decoupling del batching del serial USB).
  // Crudo se mantiene para detección de impulso; este valor se almacena al headBuf.
  private smoothedHead = 0;

  // configuración del impulso activo
  private impCfg: {
    startMs: number;
    dir: number;
    peak: number;
    gain: number;
    saccade: 'none' | 'covert' | 'overt';
    artifact: ImpulseTrigger['artifact'];
  } | null = null;

  private capturing: null | {
    side: 'LL' | 'RL';
    t: number[];
    head: number[];
    eye: number[];
  } = null;

  connect() {
    if (this.connected) return;
    this.connected = true;
    this.resetBuffers();
    this.interval = setInterval(() => this.tick(), 1000 / FS);
    this.scheduleBlink();
  }

  disconnect() {
    this.connected = false;
    this.stop();
    clearInterval(this.interval);
    clearTimeout(this.blinkTimeout);
    this.interval = undefined;
    this.blinkTimeout = undefined;
    this.blinkFrame = null;
  }

  startFreeMode() {
    if (!this.connected) return;
    this.stop();
    this.resetBuffers();
    this.mode = 'free';
    this.currentScenarioName = 'Modo libre (random)';
    this.cancelToken++;
    this.scheduleNextRandom();
  }

  /**
   * Activa un "paciente virtual": la dirección del impulso (manual o desde
   * firmware) selecciona el canal correspondiente y aplica su config. Mock
   * actual: dispara impulsos random L/R hasta stop, leyendo LL/RL del escenario.
   * Cuando llegue firmware real, el trigger será el movimiento de cabeza.
   */
  async runScenario(scenario: Scenario) {
    if (!this.connected) return;
    this.stop();
    this.resetBuffers();
    this.mode = 'scenario';
    this.currentScenarioName = scenario.name;
    this.activeScenario = scenario;
    const token = ++this.cancelToken;

    if (serial.connected) {
      // Sensor real: la detección se hace en tick() por umbral de velocidad.
      this.currentStep = 'Esperando movimiento de cabeza';
      return;
    }

    // Sin sensor: scheduler random como mock.
    this.currentStep = 'Paciente activo (sin sensor)';
    while (token === this.cancelToken) {
      const side: 'L' | 'R' = Math.random() < 0.5 ? 'L' : 'R';
      const channel: Channel = side === 'L' ? 'LL' : 'RL';
      const cfg = scenario.channels[channel];
      this.triggerImpulse({
        side,
        gain: cfg.gain,
        peakVel: cfg.peakVel,
        saccade: cfg.saccade,
        artifact: rollArtifact(resolveArtifacts(cfg)),
      });
      await this.delay(IMP_DURATION_MS + 1500 + Math.random() * 1500, token);
    }
  }


  stop() {
    this.cancelToken++;
    this.mode = 'idle';
    this.currentStep = null;
    this.gaze = 0;
    if (this.capturing) this.commitImpulse();
    this.impCfg = null;
    this.activeScenario = null;
    this.belowSinceMs = null;
  }

  clearImpulses() {
    this.impulsesLL = [];
    this.impulsesRL = [];
  }

  triggerImpulse(opts: ImpulseTrigger) {
    if (!this.connected) return;
    if (this.capturing) this.commitImpulse();
    const dir =
      opts.side === 'random' ? (Math.random() < 0.5 ? -1 : 1) : opts.side === 'L' ? -1 : 1;
    const startMs = performance.now();
    this.impCfg = {
      startMs,
      dir,
      peak: opts.peakVel,
      gain: opts.gain,
      saccade: opts.saccade,
      artifact: opts.artifact ?? null,
    };
    this.capturing = {
      side: dir < 0 ? 'LL' : 'RL',
      t: [],
      head: [],
      eye: [],
    };

    // disparar parpadeo si artefacto = blink
    if (opts.artifact === 'blink') {
      setTimeout(() => this.runBlink(), 80 + Math.random() * 80);
    }
  }

  private resetBuffers() {
    // Pre-poblar el eje de tiempo con la ventana hacia atrás para que
    // el chart muestre una línea base plana (sin colapsar el rango X).
    for (let i = 0; i < N; i++) this.tBuf[i] = (i - N + 1) / FS;
    this.headBuf.fill(0);
    this.eyeBuf.fill(0);
    this.startMs = performance.now();
    this.rev++;
  }

  private tick() {
    // En idle: si hay sensor, igual reflejamos pose en vivo (para calibrar ejes
    // visualmente) sin acumular datos en el buffer ni detectar impulsos.
    if (this.mode === 'idle' && !this.impCfg) {
      if (serial.connected) {
        this.headYaw = serial.poseYaw;
        this.headPitch = serial.posePitch;
        this.headRoll = serial.poseRoll;
      }
      return;
    }

    if (serial.connected) { this.tickWithSensor(); return; }

    const now = performance.now();
    const tSec = (now - this.startMs) / 1000;

    let head = (Math.random() - 0.5) * 5;
    let eye = (Math.random() - 0.5) * 3;

    // commit + schedule next (sólo en modo free)
    if (this.impCfg && now - this.impCfg.startMs > IMP_DURATION_MS + 80) {
      this.commitImpulse();
      this.impCfg = null;
      if (this.mode === 'free') this.scheduleNextRandom();
    }

    // disparo random en modo free
    if (this.mode === 'free' && !this.impCfg && now >= this.nextImpulseMs) {
      this.triggerImpulse({
        side: 'random',
        gain: 0.85 + Math.random() * 0.1,
        peakVel: 150 + Math.random() * 80,
        saccade: 'none',
      });
    }

    if (this.impCfg) {
      const cfg = this.impCfg;
      const center = cfg.startMs + IMP_PEAK_OFFSET;
      const dt = now - center;
      const bell = Math.exp(-(dt * dt) / (2 * IMP_SIGMA * IMP_SIGMA));
      const headSig = cfg.dir * cfg.peak * bell;

      // ojo: VOR opuesto, posiblemente con artefacto wrong_dir
      let eyeDir = -cfg.dir;
      if (cfg.artifact === 'wrong_dir') eyeDir = cfg.dir;
      const dtEye = now - 7 - center;
      const bellEye = Math.exp(-(dtEye * dtEye) / (2 * IMP_SIGMA * IMP_SIGMA));
      let eyeSig = eyeDir * cfg.peak * cfg.gain * bellEye;

      // overshoot: aumentar amplitud del ojo
      if (cfg.artifact === 'overshoot') eyeSig *= 1.4;

      // fixation_loss: ruido extra en eye
      if (cfg.artifact === 'fixation_loss') {
        eyeSig += (Math.random() - 0.5) * 60;
      }

      // sacada cubierta: durante el impulso
      if (cfg.saccade === 'covert') {
        const sCenter = cfg.startMs + COVERT_OFFSET;
        const sdt = now - sCenter;
        const sBell = Math.exp(-(sdt * sdt) / (2 * SACCADE_SIGMA * SACCADE_SIGMA));
        const sAmp = cfg.peak * (1 - cfg.gain) * 1.2;
        eyeSig += -cfg.dir * sAmp * sBell;
      }
      // sacada manifiesta: después del impulso
      if (cfg.saccade === 'overt') {
        const sCenter = cfg.startMs + OVERT_OFFSET;
        const sdt = now - sCenter;
        const sBell = Math.exp(-(sdt * sdt) / (2 * SACCADE_SIGMA * SACCADE_SIGMA));
        const sAmp = cfg.peak * (1 - cfg.gain) * 1.5;
        eyeSig += -cfg.dir * sAmp * sBell;
      }

      head += headSig;
      eye += eyeSig;

      // animación gaze
      const phase = (now - cfg.startMs) / IMP_DURATION_MS;
      if (phase > 0 && phase < 1) {
        this.gaze = -cfg.dir * 3 * Math.sin(Math.PI * phase);
      } else {
        this.gaze = 0;
      }

      // captura
      if (this.capturing && now < cfg.startMs + IMP_DURATION_MS) {
        this.capturing.t.push(dt);
        this.capturing.head.push(headSig);
        this.capturing.eye.push(eyeSig);
      }
    } else {
      this.gaze = 0;
    }

    this.tBuf.copyWithin(0, 1);
    this.headBuf.copyWithin(0, 1);
    this.eyeBuf.copyWithin(0, 1);
    this.tBuf[N - 1] = tSec;
    this.headBuf[N - 1] = head;
    this.eyeBuf[N - 1] = eye;

    // ===== Pose mock =====
    // yaw: integramos velocidad cabeza durante el impulso; en idle vuelve a 0 lentamente
    const dt = 1 / FS;
    if (this.impCfg) {
      this.headYaw += head * dt; // °/s × s
    } else {
      this.headYaw *= 0.92;       // decae a 0
      this.headYaw += (Math.random() - 0.5) * 0.4; // micro-tremor
    }
    if (Math.abs(this.headYaw) < 0.05) this.headYaw = 0;
    // pitch: deriva lenta alrededor de 0 (lateral neutro)
    this.headPitch += (Math.random() - 0.5) * 0.15;
    this.headPitch *= 0.95;
    // roll: micro-oscilación alrededor de 0
    this.headRoll += (Math.random() - 0.5) * 0.18;
    this.headRoll *= 0.94;

    this.rev++;
  }

  private tickWithSensor() {
    const now = performance.now();
    const tSec = (now - this.startMs) / 1000;

    // Pose desde sensor (configurable por axes)
    this.headYaw = serial.poseYaw;
    this.headPitch = serial.posePitch;
    this.headRoll = serial.poseRoll;

    // Drenar todas las muestras gyro acumuladas desde el último tick. Evita
    // pérdidas/duplicados por bursts USB y jitter del setInterval.
    const samples = serial.drainGyroYaw();

    // Suavizado con dt fijo (1/FS) por muestra. τ=50ms.
    const SMOOTH_TAU_MS = 50;
    const SMOOTH_ALPHA = 1 - Math.exp(-(1000 / FS) / SMOOTH_TAU_MS);
    const SAMPLE_DT_MS = 1000 / FS;

    let eye = (Math.random() - 0.5) * 3;
    let lastEyeSig = 0;
    const N_S = samples.length;
    const smoothHistory = new Array<number>(N_S);
    const eyeHistory = new Array<number>(N_S);

    for (let i = 0; i < N_S; i++) {
      const head = samples[i];
      // Timestamp aproximado de esta muestra (asume cadencia uniforme 1/FS)
      const sampleNow = now - (N_S - 1 - i) * SAMPLE_DT_MS;
      this.smoothedHead += (head - this.smoothedHead) * SMOOTH_ALPHA;
      smoothHistory[i] = this.smoothedHead;

      // Inicio de impulso (solo en escenario)
      if (this.mode === 'scenario' && !this.impCfg && Math.abs(head) > IMPULSE_START_THR) {
        const dir = head > 0 ? 1 : -1;
        const channel: Channel = dir < 0 ? 'LL' : 'RL';
        const cfg = this.activeScenario?.channels[channel];
        if (cfg) {
          const artifact = rollArtifact(resolveArtifacts(cfg));
          this.impCfg = {
            startMs: sampleNow,
            dir,
            peak: Math.abs(head),
            gain: cfg.gain,
            saccade: cfg.saccade,
            artifact,
          };
          this.capturing = { side: channel, t: [], head: [], eye: [] };
          if (artifact === 'blink') {
            setTimeout(() => this.runBlink(), 80 + Math.random() * 80);
          }
        }
      }

      if (this.impCfg && this.capturing) {
        const cfg = this.impCfg;
        cfg.peak = Math.max(cfg.peak, Math.abs(head));
        const elapsed = sampleNow - cfg.startMs;

        let eyeSig = -cfg.dir * Math.abs(this.smoothedHead) * cfg.gain;
        if (cfg.artifact === 'wrong_dir') eyeSig = -eyeSig;
        if (cfg.artifact === 'overshoot') eyeSig *= 1.4;
        if (cfg.artifact === 'fixation_loss') eyeSig += (Math.random() - 0.5) * 60;

        if (cfg.saccade === 'covert') {
          const sdt = elapsed - COVERT_OFFSET;
          const sBell = Math.exp(-(sdt * sdt) / (2 * SACCADE_SIGMA * SACCADE_SIGMA));
          const sAmp = cfg.peak * (1 - cfg.gain) * 1.2;
          eyeSig += -cfg.dir * sAmp * sBell;
        }
        if (cfg.saccade === 'overt') {
          const sdt = elapsed - OVERT_OFFSET;
          const sBell = Math.exp(-(sdt * sdt) / (2 * SACCADE_SIGMA * SACCADE_SIGMA));
          const sAmp = cfg.peak * (1 - cfg.gain) * 1.5;
          eyeSig += -cfg.dir * sAmp * sBell;
        }

        this.capturing.t.push(elapsed - IMP_PEAK_OFFSET);
        this.capturing.head.push(this.smoothedHead);
        this.capturing.eye.push(eyeSig);
        lastEyeSig = eyeSig;
      }
      eyeHistory[i] = lastEyeSig;
    }

    // Para fin-de-impulso usar último valor disponible (puede ser stale si
    // este tick no recibió samples nuevos: en ese caso solo cuenta tiempo).
    const head = N_S > 0 ? samples[N_S - 1] : serial.gyroYaw;

    if (this.impCfg) {
      const cfg = this.impCfg;
      const elapsed = now - cfg.startMs;

      eye += lastEyeSig;

      // Animación gaze
      const phase = elapsed / IMP_DURATION_MS;
      this.gaze = (phase > 0 && phase < 1) ? -cfg.dir * 3 * Math.sin(Math.PI * phase) : 0;

      // Fin de impulso: bajo umbral sostenido o duración máxima
      const belowThr = Math.abs(head) < IMPULSE_END_THR;
      if (belowThr) {
        if (this.belowSinceMs === null) this.belowSinceMs = now;
        const ended = (now - this.belowSinceMs) >= IMPULSE_END_HOLD_MS;
        if (ended || elapsed > MAX_IMPULSE_MS) {
          if (elapsed >= MIN_IMPULSE_MS) this.commitImpulse();
          else this.capturing = null;
          this.impCfg = null;
          this.belowSinceMs = null;
        }
      } else {
        this.belowSinceMs = null;
      }
    } else {
      this.gaze = 0;
    }

    // Rotar buffers de plot una entrada por cada sample real recibido.
    // Si no hubo samples este tick, no rotar (evita plateaus en TraceChart).
    if (N_S > 0) {
      const k = Math.min(N_S, N);
      this.tBuf.copyWithin(0, k);
      this.headBuf.copyWithin(0, k);
      this.eyeBuf.copyWithin(0, k);
      // Si N_S>N, conservar las últimas N samples del lote.
      const start = N_S - k;
      const eyeNoise = (Math.random() - 0.5) * 3;
      for (let i = 0; i < k; i++) {
        const idx = N - k + i;
        const si = start + i;
        this.tBuf[idx] = tSec - (N_S - 1 - si) / FS;
        this.headBuf[idx] = smoothHistory[si];
        this.eyeBuf[idx] = eyeHistory[si] + eyeNoise;
      }
      this.rev++;
    }
  }

  private commitImpulse() {
    if (!this.capturing) return;
    const c = this.capturing;
    const peakHead = c.head.length ? Math.max(...c.head.map(Math.abs)) : 0;
    const peakEye = c.eye.length ? Math.max(...c.eye.map(Math.abs)) : 0;
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
    this.lastImpulse = imp;
    this.lastVerdict = evaluateImpulse(imp, peakHead, gain);
  }

  private scheduleNextRandom() {
    this.nextImpulseMs = performance.now() + 2000 + Math.random() * 2500;
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

  private delay(ms: number, token: number): Promise<void> {
    return new Promise((resolve) => {
      const start = performance.now();
      const check = () => {
        if (token !== this.cancelToken) return resolve();
        if (performance.now() - start >= ms) return resolve();
        setTimeout(check, 50);
      };
      check();
    });
  }
}

export const sim = new Simulator();

/** Resuelve la lista efectiva de artefactos para un canal:
 *  si el canal define artefactos, ésos; si no, los defaults del EyeSet activo. */
function resolveArtifacts(c: ChannelConfig): ArtifactConfig[] {
  if (c.artifacts.length > 0) return c.artifacts;
  return eyeset.active?.artifacts ?? [];
}

/** Sortea como mucho un artefacto por impulso (orden recibido = orden de prioridad). */
function rollArtifact(list: ArtifactConfig[]): ImpulseTrigger['artifact'] {
  for (const a of list) {
    if (Math.random() < a.probability) return a.artifact;
  }
  return null;
}
