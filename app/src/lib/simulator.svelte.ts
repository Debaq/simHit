import type { Scenario } from '$lib/scenario.svelte';
import type { Node } from '@xyflow/svelte';

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
const WINDOW_S = 5;
const N = FS * WINDOW_S;
const IMP_DURATION_MS = 350;
const IMP_PEAK_OFFSET = 110;
const IMP_SIGMA = 35;
const SACCADE_SIGMA = 16;
const COVERT_OFFSET = 95;     // ms desde inicio del impulso
const OVERT_OFFSET = 240;

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

  async runScenario(scenario: Scenario) {
    if (!this.connected) return;
    this.stop();
    this.resetBuffers();
    this.mode = 'scenario';
    this.currentScenarioName = scenario.name;
    const token = ++this.cancelToken;

    const start = scenario.nodes.find((n) => n.type === 'start');
    if (!start) { this.stop(); return; }

    let pendingArtifact: { artifact: ImpulseTrigger['artifact']; probability: number } | null = null;
    let current: Node | undefined = start;

    while (current && current.type !== 'end' && token === this.cancelToken) {
      const data = current.data as any;
      this.currentStep = data.label ?? current.type;

      if (current.type === 'impulse') {
        for (let i = 0; i < (data.count ?? 1) && token === this.cancelToken; i++) {
          const useArt = pendingArtifact && Math.random() < pendingArtifact.probability;
          this.triggerImpulse({
            side: data.side,
            gain: data.gain,
            peakVel: data.peakVel,
            saccade: data.saccade,
            artifact: useArt ? pendingArtifact!.artifact : null,
          });
          // espera impulso + intervalo realista 1.8–3s
          await this.delay(IMP_DURATION_MS + 1500 + Math.random() * 1500, token);
          if (useArt) pendingArtifact = null;
        }
      } else if (current.type === 'pause') {
        await this.delay(data.durationMs ?? 1000, token);
      } else if (current.type === 'artifact') {
        pendingArtifact = { artifact: data.artifact, probability: data.probability };
      } else if (current.type === 'random') {
        const out = scenario.edges.filter((e) => e.source === current!.id);
        if (out.length === 0) break;
        const chosen = out[Math.floor(Math.random() * out.length)];
        current = scenario.nodes.find((n) => n.id === chosen.target);
        continue;
      }

      const out = scenario.edges.filter((e) => e.source === current!.id);
      if (out.length === 0) break;
      current = scenario.nodes.find((n) => n.id === out[0].target);
    }

    if (token === this.cancelToken) {
      this.mode = 'idle';
      this.currentStep = null;
    }
  }

  stop() {
    this.cancelToken++;
    this.mode = 'idle';
    this.currentStep = null;
    this.gaze = 0;
    if (this.capturing) this.commitImpulse();
    this.impCfg = null;
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
    // En idle no acumulamos datos en el buffer.
    if (this.mode === 'idle' && !this.impCfg) return;

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
    this.rev++;
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
