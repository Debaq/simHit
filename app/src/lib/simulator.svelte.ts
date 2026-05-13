import type { Scenario, ArtifactConfig, Channel, ChannelConfig } from '$lib/scenario.svelte';
import { scenarios } from '$lib/scenario.svelte';
import { eyeset } from '$lib/eyeset.svelte';
import { serial } from '$lib/serial.svelte';
import { acceptance } from '$lib/acceptance.svelte';
import { settings } from '$lib/settings.svelte';
import { evaluateImpulsePipeline } from '$lib/detectors/evaluator';
import type { DetectorResult } from '$lib/detectors/types';

/** Canal del impulso. Hasta F1 sólo se generaban LL/RL; ahora también
 *  pueden producirse impulsos verticales (LA/LP/RA/RP) cuando la cabeza
 *  arranca girada ±~45° y la velocidad combinada yaw+pitch supera el
 *  umbral. La firma se mantiene compatible con LL/RL. */
export type ImpulseSide = 'LL' | 'RL' | 'LA' | 'LP' | 'RA' | 'RP';

export type Impulse = {
  id: number;
  side: ImpulseSide;
  t: Float64Array;
  /** Señal de cabeza usada por la evaluación: para LL/RL es gyroYaw, para
   *  verticales es la proyección de (gyroYaw, gyroPitch) sobre el eje del
   *  canal. Permite que evaluateImpulse trabaje en 1D igual que antes. */
  head: Float64Array;
  eye: Float64Array;
  gain: number;
  /** Velocidad cruda yaw °/s muestra a muestra (para revisor diagonal). */
  headYawRaw?: Float64Array;
  /** Velocidad cruda pitch °/s muestra a muestra. */
  headPitchRaw?: Float64Array;
};

/** Vector unitario del plano de cada canal en el frame (yaw, pitch).
 *
 *  Convención de signos:
 *    yaw < 0  = cabeza/gyro hacia la izquierda
 *    yaw > 0  = cabeza/gyro hacia la derecha
 *    pitch    = se asume pitch > 0 = mirada hacia arriba.
 *  TODO[#13]: confirmar el signo de pitch contra el firmware una vez se
 *  pruebe con hardware. Si el firmware entrega pitch invertido, basta con
 *  multiplicar la componente pitch de todos los axes por -1.
 *
 *  Planos verticales: la cabeza arranca girada ~45° (LARP a la izq.,
 *  RALP a la der.) y el impulso es diagonal: combina yaw y pitch. */
export type ChannelAxis = { yaw: number; pitch: number };
export const CHANNEL_AXES: Record<ImpulseSide, ChannelAxis> = {
  LL: { yaw: -1, pitch: 0 },
  RL: { yaw: +1, pitch: 0 },
  LA: { yaw: -Math.SQRT1_2, pitch: -Math.SQRT1_2 }, // izq + abajo
  LP: { yaw: -Math.SQRT1_2, pitch: +Math.SQRT1_2 }, // izq + arriba
  RA: { yaw: +Math.SQRT1_2, pitch: +Math.SQRT1_2 }, // der + arriba
  RP: { yaw: +Math.SQRT1_2, pitch: -Math.SQRT1_2 }, // der + abajo
};

/** Umbral de pose (°) que define en qué plano está el sujeto.
 *  |yawPose| < umbral → plano horizontal (LL/RL).
 *  yawPose < -umbral  → LARP (LA o RP, según signo del impulso).
 *  yawPose > +umbral  → RALP (RA o LP, según signo del impulso). */
const POSE_PLANE_THR = 25;

export type ImpulseTrigger = {
  side: 'L' | 'R' | 'random';
  gain: number;          // VOR gain 0..1.5
  peakVel: number;       // °/s
  saccade: 'none' | 'covert' | 'overt';
  artifact?: 'blink' | 'slip' | 'wrong_dir' | 'overshoot' | 'fixation_loss' | null;
};

const FS = 200;

// Escala VOR para preview ocular.
//   yaw  ±VOR_YAW_FULL°   → ±3 niveles horizontales (gaze x)
//   pitch ±VOR_PITCH_FULL° → ±3 niveles verticales (gaze y, sentido invertido)
// EyeView clampa y elige rayo cardinal o diagonal según ambos.
const VOR_YAW_FULL = 25;
const VOR_PITCH_FULL = 20;
const yawToGaze = (yaw: number) => Math.max(-3, Math.min(3, -yaw * (3 / VOR_YAW_FULL)));
const pitchToGaze = (p: number) => Math.max(-3, Math.min(3, -p * (3 / VOR_PITCH_FULL)));

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
//
// Nota: la ganancia VOR no se chequea como criterio de aceptación. Es el
// resultado clínico medido del impulso (peak_ojo/peak_cabeza), no una
// métrica de calidad de ejecución. Filtrar por ganancia rechazaría
// hallazgos patológicos legítimos (hipofunción). Sigue como métrica en
// el verdict (Verdict.gain) e informes, pero no marca ok=false.
export type CheckId = 'peak' | 'dur' | 'amp';
export interface Check {
  id: CheckId;
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  ok: boolean;
}
export interface Verdict {
  ok: boolean;
  reasons: string[];
  peak: number;
  gain: number;
  amp: number;
  durMs: number;
  levelName: string;
  checks: Check[];
  /** True si la pose inicial del impulso estaba fuera de tolerancia.
   *  En modo examen el impulso se registra pero no cuenta como válido. */
  invalidPose: boolean;
  /** Resultados crudos del pipeline de detectores (para revisor extendido). */
  detectorResults: DetectorResult[];
}

/** True si el canal pertenece al plano horizontal (LL/RL). */
export function isHorizontalSide(s: ImpulseSide): boolean {
  return s === 'LL' || s === 'RL';
}

function evaluateImpulse(
  imp: Impulse,
  peakHead: number,
  gain: number,
  preImpulsePose?: { yaw: number; pitch: number; roll: number },
): Verdict {
  const cfg = acceptance.active;
  const durMs = imp.t.length ? imp.t[imp.t.length - 1] - imp.t[0] : 0;
  const amp = integrateAmplitude(imp.t, imp.head);

  // Pipeline de detectores: la fuente de verdad del veredicto.
  const pipeline = evaluateImpulsePipeline({
    impulse: imp,
    channel: imp.side,
    preset: cfg,
    preImpulsePose,
  });

  // Construir `checks` legacy (peak/amp/dur) desde los resultados del
  // pipeline para preservar la UI actual del revisor (HeadLiveView etc.).
  const horiz = isHorizontalSide(imp.side);
  const ampMax = horiz ? cfg.yawTol : cfg.pitchTol;
  const ampMin = horiz ? cfg.ampMinH : cfg.ampMinV;
  const peakMin = horiz ? cfg.peakMinH : cfg.peakMinV;
  const peakMax = horiz ? cfg.peakMaxH : cfg.peakMaxV;
  const durMin  = horiz ? cfg.durMinMsH : cfg.durMinMsV;
  const durMax  = horiz ? cfg.durMaxMsH : cfg.durMaxMsV;
  const peakRes = pipeline.results.find((r) => r.id === 'peak-velocity');
  const ampRes  = pipeline.results.find((r) => r.id === 'amplitude');
  const durRes  = pipeline.results.find((r) => r.id === 'duration');
  const checks: Check[] = [
    { id: 'amp',  label: 'despl.',   value: amp,      min: ampMin,   max: ampMax, unit: '°',
      ok: ampRes ? ampRes.severity !== 'fail' : (amp >= ampMin && amp <= ampMax) },
    { id: 'peak', label: 'pico',     value: peakHead, min: peakMin,  max: peakMax, unit: '°/s',
      ok: peakRes ? peakRes.severity !== 'fail' : (peakHead >= peakMin && peakHead <= peakMax) },
    { id: 'dur',  label: 'duración', value: durMs,    min: durMin,   max: durMax,  unit: 'ms',
      ok: durRes ? durRes.severity !== 'fail' : (durMs >= durMin && durMs <= durMax) },
  ];

  // Razones = mensajes de todos los detectores que fallaron.
  const reasons = pipeline.failed.map((r) => r.message);

  return {
    ok: pipeline.accepted,
    reasons,
    peak: peakHead,
    gain,
    amp,
    durMs,
    levelName: cfg.name,
    checks,
    invalidPose: pipeline.invalidPose,
    detectorResults: pipeline.results,
  };
}
const WINDOW_S = 5;
const N = FS * WINDOW_S;
// Buffer circular para promediar pose pre-impulso (~300 ms a FS=200 → 60 muestras).
const POSE_BUF_MS = 300;
const POSE_BUF_LEN = Math.ceil((POSE_BUF_MS / 1000) * FS);
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
  mode = $state<'idle' | 'scenario'>('idle');
  currentScenarioName = $state<string | null>(null);
  currentStep = $state<string | null>(null);
  gaze = $state(0);
  gazeY = $state(0);
  blinkFrame = $state<number | null>(null);
  blinkEnabled = $state(true);
  impulsesLL = $state<Impulse[]>([]);
  impulsesRL = $state<Impulse[]>([]);
  // Verticales (F1+F2). Quedan vacíos mientras la pose esté neutra.
  impulsesLA = $state<Impulse[]>([]);
  impulsesLP = $state<Impulse[]>([]);
  impulsesRA = $state<Impulse[]>([]);
  impulsesRP = $state<Impulse[]>([]);
  excludedIds = $state<Set<number>>(new Set());
  rev = $state(0);

  // Pose simulada de la cabeza (mock — luego vendrá del firmware)
  headYaw = $state(0);    // °, neutro = 0; izq < 0; der > 0
  headPitch = $state(0);  // °, lateral neutro ≈ 0; cabeza abajo > 0
  headRoll = $state(0);   // °, neutro = 0; oreja-hombro izq < 0; der > 0
  // Veredicto del último impulso capturado
  lastImpulse = $state<Impulse | null>(null);
  lastVerdict = $state<Verdict | null>(null);

  // alias para no romper API previa
  get running() { return this.mode !== 'idle'; }

  tBuf = new Float64Array(N);
  headBuf = new Float64Array(N);
  eyeBuf = new Float64Array(N);

  private startMs = 0;
  private interval?: ReturnType<typeof setInterval>;
  private blinkTimeout?: ReturnType<typeof setTimeout>;
  private impulseId = 1;
  private cancelToken = 0;
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
    side: ImpulseSide;
    t: number[];
    /** Señal proyectada sobre el eje del canal (1D, alimenta evaluateImpulse). */
    head: number[];
    eye: number[];
    /** Velocidades crudas yaw/pitch para revisar trayectorias diagonales. */
    headYawRaw: number[];
    headPitchRaw: number[];
    poseYaw0: number;
    posePitch0: number;
    poseRoll0: number;
    /** Pose promedio sostenida ~300 ms antes del trigger. Si está
     *  presente se pasa al pipeline de detectores para validar pose inicial. */
    preImpulsePose?: { yaw: number; pitch: number; roll: number };
  } = null;

  // Buffer circular de pose para promediar la ventana pre-impulso (~300 ms).
  private poseBufYaw   = new Float64Array(POSE_BUF_LEN);
  private poseBufPitch = new Float64Array(POSE_BUF_LEN);
  private poseBufRoll  = new Float64Array(POSE_BUF_LEN);
  private poseBufIdx = 0;
  private poseBufFilled = 0;

  /** Inserta la pose actual en el buffer circular pre-impulso. */
  private pushPoseSample() {
    const i = this.poseBufIdx;
    this.poseBufYaw[i]   = this.headYaw;
    this.poseBufPitch[i] = this.headPitch;
    this.poseBufRoll[i]  = this.headRoll;
    this.poseBufIdx = (i + 1) % POSE_BUF_LEN;
    if (this.poseBufFilled < POSE_BUF_LEN) this.poseBufFilled++;
  }

  /** Devuelve la pose promedio del buffer (las últimas ~300 ms). null si
   *  el buffer no está suficientemente lleno (< 50% de la ventana). */
  private currentPreImpulsePose(): { yaw: number; pitch: number; roll: number } | undefined {
    const n = this.poseBufFilled;
    if (n < POSE_BUF_LEN / 2) return undefined;
    let sy = 0, sp = 0, sr = 0;
    for (let k = 0; k < n; k++) {
      sy += this.poseBufYaw[k];
      sp += this.poseBufPitch[k];
      sr += this.poseBufRoll[k];
    }
    return { yaw: sy / n, pitch: sp / n, roll: sr / n };
  }

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
    const token = ++this.cancelToken;

    if (serial.connected) {
      // Sensor real: la detección se hace en tick() por umbral de velocidad.
      this.currentStep = 'Esperando movimiento de cabeza';
      if (settings.laserMode === 'armed') void serial.sendCommand('LASER ON');
      return;
    }

    // Sin sensor: scheduler random como mock.
    this.currentStep = 'Paciente activo (sin sensor)';
    while (token === this.cancelToken) {
      const side: 'L' | 'R' = Math.random() < 0.5 ? 'L' : 'R';
      const channel: Channel = side === 'L' ? 'LL' : 'RL';
      // Lectura reactiva: si el docente cambia el escenario activo, el próximo
      // impulso usa la nueva config sin reiniciar.
      const sc = scenarios.active ?? scenario;
      this.currentScenarioName = sc.name;
      const cfg = sc.channels[channel];
      // TEMP[issue#2]: jitter en gain/peak para variabilidad visible en overlay.
      // Quitar cuando issue caso->demo defina variabilidad real.
      const gainJitter = (Math.random() - 0.5) * 0.18;
      const peakJitter = (Math.random() - 0.5) * 60;
      this.triggerImpulse({
        side,
        gain: Math.max(0.1, Math.min(1.5, cfg.gain + gainJitter)),
        peakVel: Math.max(60, cfg.peakVel + peakJitter),
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
    this.gazeY = 0;
    if (this.capturing) this.commitImpulse();
    this.impCfg = null;
    this.belowSinceMs = null;
    if (settings.laserMode === 'armed' && serial.connected) {
      void serial.sendCommand('LASER OFF');
    }
  }

  clearImpulses() {
    this.impulsesLL = [];
    this.impulsesRL = [];
    this.impulsesLA = [];
    this.impulsesLP = [];
    this.impulsesRA = [];
    this.impulsesRP = [];
    this.excludedIds = new Set();
  }

  toggleExclude(id: number) {
    const next = new Set(this.excludedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    this.excludedIds = next;
  }

  deleteImpulse(id: number) {
    this.impulsesLL = this.impulsesLL.filter((i) => i.id !== id);
    this.impulsesRL = this.impulsesRL.filter((i) => i.id !== id);
    this.impulsesLA = this.impulsesLA.filter((i) => i.id !== id);
    this.impulsesLP = this.impulsesLP.filter((i) => i.id !== id);
    this.impulsesRA = this.impulsesRA.filter((i) => i.id !== id);
    this.impulsesRP = this.impulsesRP.filter((i) => i.id !== id);
    if (this.excludedIds.has(id)) {
      const next = new Set(this.excludedIds);
      next.delete(id);
      this.excludedIds = next;
    }
  }

  includedLL() { return this.impulsesLL.filter((i) => !this.excludedIds.has(i.id)); }
  includedRL() { return this.impulsesRL.filter((i) => !this.excludedIds.has(i.id)); }

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
      headYawRaw: [],
      headPitchRaw: [],
      poseYaw0: this.headYaw,
      posePitch0: this.headPitch,
      poseRoll0: this.headRoll,
      preImpulsePose: this.currentPreImpulsePose(),
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
    // En idle con sensor: alimentar buffer con velocidad real (sin detectar
    // impulsos). Eso mantiene el gráfico vivo aunque no haya práctica/escenario.
    if (this.mode === 'idle' && !this.impCfg && serial.connected) {
      this.tickWithSensor();
      return;
    }
    if (this.mode === 'idle' && !this.impCfg) {
      // Sin sensor y sin escenario: dejar el gráfico quieto, sin generar ruido.
      return;
    }

    if (serial.connected) { this.tickWithSensor(); return; }

    const now = performance.now();
    const tSec = (now - this.startMs) / 1000;

    let head = (Math.random() - 0.5) * 5;
    let eye = (Math.random() - 0.5) * 3;

    if (this.impCfg && now - this.impCfg.startMs > IMP_DURATION_MS + 80) {
      this.commitImpulse();
      this.impCfg = null;
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
        // En el mock sin sensor la señal proyectada coincide con yaw;
        // pitch se mantiene en 0 para no contaminar el revisor diagonal.
        this.capturing.headYawRaw.push(headSig);
        this.capturing.headPitchRaw.push(0);
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

    // Alimentar buffer de pose pre-impulso sólo cuando NO hay impulso activo.
    if (!this.impCfg) this.pushPoseSample();

    this.rev++;
  }

  private tickWithSensor() {
    const now = performance.now();
    const tSec = (now - this.startMs) / 1000;

    // Pose desde sensor (configurable por axes)
    this.headYaw = serial.poseYaw;
    this.headPitch = serial.posePitch;
    this.headRoll = serial.poseRoll;

    // Drenar muestras gyro yaw + pitch en paralelo. drainGyro vacía la cola
    // una sola vez y devuelve ambos arrays alineados muestra a muestra.
    // Evita pérdidas/duplicados por bursts USB y jitter del setInterval.
    const drained = serial.drainGyro();
    let yawSamples = drained.yaw;
    let pitchSamples = drained.pitch;
    // Defensivo: si por algún motivo los largos difieren (no debería ocurrir
    // porque ambos vienen de la misma cola), truncar al mínimo y dejar TODO.
    // TODO[#13]: revisar si el firmware puede llegar a desalinear yaw/pitch.
    if (yawSamples.length !== pitchSamples.length) {
      const n = Math.min(yawSamples.length, pitchSamples.length);
      yawSamples = yawSamples.slice(0, n);
      pitchSamples = pitchSamples.slice(0, n);
    }

    // Suavizado con dt fijo (1/FS) por muestra. τ=50ms.
    const SMOOTH_TAU_MS = 50;
    const SMOOTH_ALPHA = 1 - Math.exp(-(1000 / FS) / SMOOTH_TAU_MS);
    const SAMPLE_DT_MS = 1000 / FS;

    let eye = (Math.random() - 0.5) * 3;
    let lastEyeSig = 0;
    const N_S = yawSamples.length;
    const smoothHistory = new Array<number>(N_S);
    const eyeHistory = new Array<number>(N_S);
    // Suavizado de pitch independiente (misma τ). Local al tick: no se
    // persiste como campo porque sólo se necesita durante la captura.
    let smoothedPitch = 0;

    for (let i = 0; i < N_S; i++) {
      const yawRaw = yawSamples[i];
      const pitchRaw = pitchSamples[i];
      // Timestamp aproximado de esta muestra (asume cadencia uniforme 1/FS)
      const sampleNow = now - (N_S - 1 - i) * SAMPLE_DT_MS;
      this.smoothedHead += (yawRaw - this.smoothedHead) * SMOOTH_ALPHA;
      smoothedPitch += (pitchRaw - smoothedPitch) * SMOOTH_ALPHA;
      smoothHistory[i] = this.smoothedHead;

      // Magnitud combinada para detectar inicio. Permite disparar también
      // con impulsos diagonales cuando la cabeza arranca girada ±~45°.
      const magCombined = Math.sqrt(yawRaw * yawRaw + pitchRaw * pitchRaw);

      // Inicio de impulso (sólo en escenario)
      if (this.mode === 'scenario' && !this.impCfg && magCombined > IMPULSE_START_THR) {
        const side = pickChannelFromImpulse(this.headYaw, yawRaw, pitchRaw);
        const axis = CHANNEL_AXES[side];
        const projected = yawRaw * axis.yaw + pitchRaw * axis.pitch;
        // Para LL/RL `dir` conserva el signo histórico (positivo = der).
        // Para verticales fijamos dir=+1: la señal proyectada ya es positiva
        // por construcción del eje (axis · (yaw,pitch) ≈ +mag durante el hit).
        const dir: number = side === 'LL' ? -1 : side === 'RL' ? 1 : 1;
        const channel: Channel = side;
        // Lectura reactiva del escenario activo en cada inicio de impulso.
        const sc = scenarios.active;
        if (sc) this.currentScenarioName = sc.name;
        const cfg = sc?.channels[channel];
        if (cfg) {
          const artifact = rollArtifact(resolveArtifacts(cfg));
          this.impCfg = {
            startMs: sampleNow,
            dir,
            peak: Math.abs(projected),
            gain: cfg.gain,
            saccade: cfg.saccade,
            artifact,
          };
          this.capturing = {
            side, t: [], head: [], eye: [],
            headYawRaw: [], headPitchRaw: [],
            poseYaw0: this.headYaw,
            posePitch0: this.headPitch,
            poseRoll0: this.headRoll,
            preImpulsePose: this.currentPreImpulsePose(),
          };
          if (artifact === 'blink') {
            setTimeout(() => this.runBlink(), 80 + Math.random() * 80);
          }
          if (settings.laserMode === 'armed') {
            void serial.sendCommand('LASER OFF');
          }
        }
      }

      if (this.impCfg && this.capturing) {
        const cfg = this.impCfg;
        const axis = CHANNEL_AXES[this.capturing.side];
        // Proyección de la velocidad combinada sobre el eje del canal.
        // Para LL/RL coincide con ±yaw (axis.pitch = 0); para verticales
        // combina yaw y pitch en una señal 1D que conserva el signo.
        const projected = yawRaw * axis.yaw + pitchRaw * axis.pitch;
        const smoothedProj =
          this.smoothedHead * axis.yaw + smoothedPitch * axis.pitch;
        cfg.peak = Math.max(cfg.peak, Math.abs(projected));
        const elapsed = sampleNow - cfg.startMs;

        let eyeSig = -cfg.dir * Math.abs(smoothedProj) * cfg.gain;
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
        this.capturing.head.push(smoothedProj);
        this.capturing.eye.push(eyeSig);
        this.capturing.headYawRaw.push(yawRaw);
        this.capturing.headPitchRaw.push(pitchRaw);
        lastEyeSig = eyeSig;
      }
      eyeHistory[i] = lastEyeSig;
    }

    // Para fin-de-impulso usar la señal proyectada del último valor
    // disponible (puede ser stale si este tick no recibió samples nuevos:
    // en ese caso sólo cuenta tiempo). Para LL/RL coincide con ±gyroYaw.
    const lastYaw = N_S > 0 ? yawSamples[N_S - 1] : serial.gyroYaw;
    const lastPitch = N_S > 0 ? pitchSamples[N_S - 1] : serial.gyroPitch;
    const head = this.impCfg && this.capturing
      ? lastYaw * CHANNEL_AXES[this.capturing.side].yaw +
        lastPitch * CHANNEL_AXES[this.capturing.side].pitch
      : lastYaw;

    if (this.impCfg) {
      const cfg = this.impCfg;
      const elapsed = now - cfg.startMs;

      eye += lastEyeSig;

      // Animación gaze
      const phase = elapsed / IMP_DURATION_MS;
      this.gaze = (phase > 0 && phase < 1) ? -cfg.dir * 3 * Math.sin(Math.PI * phase) : yawToGaze(this.headYaw);
      this.gazeY = pitchToGaze(this.headPitch);

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
          if (settings.laserMode === 'armed' && this.mode === 'scenario') {
            void serial.sendCommand('LASER ON');
          }
        }
      } else {
        this.belowSinceMs = null;
      }
    } else {
      // Sin impulso pero con sensor: VOR continuo.
      this.gaze = yawToGaze(this.headYaw);
      this.gazeY = pitchToGaze(this.headPitch);
    }

    // Alimentar buffer de pose pre-impulso sólo cuando no hay impulso activo.
    // Una entrada por tick basta (cadencia uniforme): el promedio es robusto.
    if (!this.impCfg) this.pushPoseSample();

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
      headYawRaw: Float64Array.from(c.headYawRaw),
      headPitchRaw: Float64Array.from(c.headPitchRaw),
    };
    switch (c.side) {
      case 'LL': this.impulsesLL = [...this.impulsesLL, imp].slice(-15); break;
      case 'RL': this.impulsesRL = [...this.impulsesRL, imp].slice(-15); break;
      case 'LA': this.impulsesLA = [...this.impulsesLA, imp].slice(-15); break;
      case 'LP': this.impulsesLP = [...this.impulsesLP, imp].slice(-15); break;
      case 'RA': this.impulsesRA = [...this.impulsesRA, imp].slice(-15); break;
      case 'RP': this.impulsesRP = [...this.impulsesRP, imp].slice(-15); break;
    }
    const preImpulsePose = c.preImpulsePose;
    this.capturing = null;
    this.lastImpulse = imp;
    this.lastVerdict = evaluateImpulse(imp, peakHead, gain, preImpulsePose);
  }

  private scheduleBlink() {
    if (!this.connected) return;
    const wait = 2800 + Math.random() * 3200;
    this.blinkTimeout = setTimeout(() => this.runBlink(), wait);
  }

  private runBlink() {
    if (!this.connected) return;
    if (!this.blinkEnabled) { this.scheduleBlink(); return; }
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

/** Decide a qué canal pertenece un impulso recién disparado.
 *
 *  Pasos:
 *   1) La pose de cabeza (yawPose) ubica el plano anatómico:
 *      - |yawPose| < POSE_PLANE_THR  → horizontal (LL/RL).
 *      - yawPose < -POSE_PLANE_THR   → LARP (LA / RP).
 *      - yawPose > +POSE_PLANE_THR   → RALP (RA / LP).
 *   2) Dentro del plano, el signo de la proyección sobre el eje del canal
 *      desempata anterior vs posterior (o izq vs der en horizontal).
 *      Se elige el canal del plano cuya proyección sea positiva durante
 *      el impulso (axis · (yaw, pitch) > 0). */
function pickChannelFromImpulse(yawPose: number, gyroYaw: number, gyroPitch: number): ImpulseSide {
  // Horizontal: pose cercana a neutro.
  if (Math.abs(yawPose) < POSE_PLANE_THR) {
    return gyroYaw > 0 ? 'RL' : 'LL';
  }
  // LARP: cabeza girada a la izquierda → canales LA y RP.
  if (yawPose < 0) {
    const projLA = gyroYaw * CHANNEL_AXES.LA.yaw + gyroPitch * CHANNEL_AXES.LA.pitch;
    const projRP = gyroYaw * CHANNEL_AXES.RP.yaw + gyroPitch * CHANNEL_AXES.RP.pitch;
    return projLA >= projRP ? 'LA' : 'RP';
  }
  // RALP: cabeza girada a la derecha → canales RA y LP.
  const projRA = gyroYaw * CHANNEL_AXES.RA.yaw + gyroPitch * CHANNEL_AXES.RA.pitch;
  const projLP = gyroYaw * CHANNEL_AXES.LP.yaw + gyroPitch * CHANNEL_AXES.LP.pitch;
  return projRA >= projLP ? 'RA' : 'LP';
}

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
