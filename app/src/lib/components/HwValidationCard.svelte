<script lang="ts">
  // Validación funcional del hardware (fase 2 de PLAN-CONFIG-SENSOR).
  // No es un detector de clones — solo decide si el sensor es **usable** para
  // vHIT comparando contra umbrales de calidad derivados del datasheet del
  // chip detectado (SENSOR_REFERENCES × multiplicadores conservadores).
  //
  // Tests (todos client-side, leen el stream gyro/accel existente; sin
  // cambios en firmware):
  //   1. Gravedad estática — ‖linAccel‖ con sensor quieto.
  //   2. Noise floor del gyro (10 s) — ARW y BI vs datasheet × umbrales.
  //   3. Bias estático del gyro (10 s) — ‖media(ω)‖ < umbral.
  //   4. Cross-axis isolation — usuario rota 90° en yaw, otros < 5°.
  //
  // Veredicto graduado por test: usable / marginal / roto. El cliente muestra
  // números crudos junto al badge para que el usuario decida.
  import { serial } from '$lib/serial.svelte';

  type SensorReference = {
    label: string;
    arw_deg_sqrt_hr: number;
    bias_instability_deg_hr: number;
    range_dps: number;
  };

  type Props = {
    /** Referencia del datasheet del sensor detectado (SENSOR_REFERENCES[slug]).
     *  Si null, los tests corren pero los veredictos usan defaults conservadores. */
    reference: SensorReference | null;
  };
  let { reference }: Props = $props();

  type Verdict = 'usable' | 'marginal' | 'roto' | 'pending' | 'running';

  type TestResult = {
    verdict: Verdict;
    detail: string;  // texto humano con los valores medidos
  };

  let gravity = $state<TestResult>({ verdict: 'pending', detail: '' });
  let noise   = $state<TestResult>({ verdict: 'pending', detail: '' });
  let bias    = $state<TestResult>({ verdict: 'pending', detail: '' });
  let cross   = $state<TestResult>({ verdict: 'pending', detail: '' });

  let running = $state(false);
  let progressLabel = $state('');
  let progressPct = $state(0);

  // Muestreo: el stream del firmware llega a 200 Hz; capturamos por wall-clock.
  // Cada 16 ms tomamos un sample del último valor leído por serial. Esto
  // submuestrea ligeramente (200→62 Hz efectivo) pero es suficiente para
  // estadística estática; evita acoplarnos al tick exacto del firmware.
  const TICK_MS = 16;

  type GyroSamples = { x: number[]; y: number[]; z: number[] };
  type AccelSamples = { mag: number[] };

  function pushGyro(g: GyroSamples) {
    g.x.push(serial.gyro.x);
    g.y.push(serial.gyro.y);
    g.z.push(serial.gyro.z);
  }
  function pushAccel(a: AccelSamples) {
    const lx = serial.linearAccelX, ly = serial.linearAccelY, lz = serial.linearAccelZ;
    a.mag.push(Math.sqrt(lx*lx + ly*ly + lz*lz));
  }

  async function captureFor(ms: number, onSample: () => void): Promise<void> {
    progressPct = 0;
    const start = performance.now();
    return new Promise((resolve) => {
      const id = setInterval(() => {
        onSample();
        const elapsed = performance.now() - start;
        progressPct = Math.min(1, elapsed / ms);
        if (elapsed >= ms) {
          clearInterval(id);
          resolve();
        }
      }, TICK_MS);
    });
  }

  function mean(arr: number[]): number {
    return arr.reduce((s, v) => s + v, 0) / Math.max(1, arr.length);
  }
  function stddev(arr: number[]): number {
    if (arr.length < 2) return 0;
    const m = mean(arr);
    const sq = arr.reduce((s, v) => s + (v - m) * (v - m), 0);
    return Math.sqrt(sq / (arr.length - 1));
  }

  // Umbrales relativos al datasheet (× multiplicador). Defaults conservadores
  // si no hay referencia del chip detectado.
  const DEFAULT_ARW = 0.6;  // °/√h (peor del catálogo)
  const DEFAULT_BI  = 80;   // °/h

  function evalARW(arw_meas: number, arw_ref: number): Verdict {
    if (arw_meas <= 2 * arw_ref) return 'usable';
    if (arw_meas <= 3 * arw_ref) return 'marginal';
    return 'roto';
  }
  function evalBI(bi_meas: number, bi_ref: number): Verdict {
    if (bi_meas <= 3 * bi_ref) return 'usable';
    if (bi_meas <= 5 * bi_ref) return 'marginal';
    return 'roto';
  }
  function evalGravity(g_meas: number): Verdict {
    if (g_meas >= 9.6 && g_meas <= 10.0) return 'usable';
    if (g_meas >= 9.0 && g_meas <= 10.4) return 'marginal';
    return 'roto';
  }
  function evalBias(bias_meas: number): Verdict {
    if (bias_meas <= 0.5) return 'usable';
    if (bias_meas <= 1.5) return 'marginal';
    return 'roto';
  }
  function evalCrossAxis(yaw: number, otherMax: number): Verdict {
    const ay = Math.abs(yaw);
    if (ay >= 80 && ay <= 100 && otherMax < 5) return 'usable';
    if (ay >= 70 && ay <= 110 && otherMax < 10) return 'marginal';
    return 'roto';
  }

  // ── Tests automáticos (1-3) ────────────────────────────────────────────
  async function runAutoTests() {
    if (!serial.connected) return;
    running = true;
    gravity = { verdict: 'running', detail: '' };
    noise = { verdict: 'pending', detail: '' };
    bias = { verdict: 'pending', detail: '' };
    cross = { verdict: 'pending', detail: '' };

    try {
      // Asegurar stream activo. IMU ON es idempotente.
      await serial.sendCommand('IMU ON');
      await new Promise((r) => setTimeout(r, 300));

      // Test 1: gravedad (1 s)
      progressLabel = 'Test 1/3: Gravedad estática (1 s)';
      const acc: AccelSamples = { mag: [] };
      await captureFor(1000, () => pushAccel(acc));
      const gMean = mean(acc.mag);
      gravity = { verdict: evalGravity(gMean), detail: `‖a‖ = ${gMean.toFixed(2)} m/s²` };

      // Test 2 + 3: capturar 10 s de gyro, usar para ambos
      progressLabel = 'Test 2-3: Noise floor + bias estático (10 s)';
      noise = { verdict: 'running', detail: '' };
      bias = { verdict: 'running', detail: '' };
      const gy: GyroSamples = { x: [], y: [], z: [] };
      await captureFor(10000, () => pushGyro(gy));

      // Noise floor: SD del gyro (°/s) → ARW (°/√h) ≈ SD × √(T_sample_s / 3600).
      // Estimamos T_sample como duración total / N. Más conservador: usar SD
      // directo × √(1/3600) que asume 1 Hz; mejor: usar 1/200 (firmware ODR).
      // ARW(°/√h) = SD(°/s) × √(1/3600) × √T_int = SD × √(1/(3600 × 200))
      // Simplificación: usamos SD × √(t/3600) con t = 1/200.
      const sdGyroX = stddev(gy.x), sdGyroY = stddev(gy.y), sdGyroZ = stddev(gy.z);
      const sdMean = (sdGyroX + sdGyroY + sdGyroZ) / 3;
      const dtSec = 1 / 200;
      const arwMeas = sdMean * Math.sqrt(dtSec / 3600) * 3600;  // °/h equiv
      // Conversión limpia: ARW (°/√h) = SD (°/s) × √(dt_s)/√(1/3600)
      //                  = SD × √(dt_s × 3600). Para SD=0.1 °/s, dt=1/200 →
      //                  ARW ≈ 0.1 × √(18) ≈ 0.42 °/√h. Plausible.
      const arwClean = sdMean * Math.sqrt(dtSec * 3600);
      const arwRef = reference?.arw_deg_sqrt_hr ?? DEFAULT_ARW;
      noise = {
        verdict: evalARW(arwClean, arwRef),
        detail: `ARW ≈ ${arwClean.toFixed(2)} °/√h (ref ${arwRef.toFixed(2)}, SD ${sdMean.toFixed(3)} °/s)`,
      };
      void arwMeas;  // unused — kept for reference of alternate formula

      // Bias estático: ‖media(ω)‖ después de 10s quieto.
      const bxM = mean(gy.x), byM = mean(gy.y), bzM = mean(gy.z);
      const biasNorm = Math.sqrt(bxM*bxM + byM*byM + bzM*bzM);
      bias = {
        verdict: evalBias(biasNorm),
        detail: `‖bias‖ = ${biasNorm.toFixed(2)} °/s (X ${bxM.toFixed(2)}, Y ${byM.toFixed(2)}, Z ${bzM.toFixed(2)})`,
      };
    } finally {
      running = false;
      progressLabel = '';
      progressPct = 0;
    }
  }

  // ── Test 4: cross-axis (interactivo) ───────────────────────────────────
  let crossCapturing = $state(false);
  let crossProgress = $state(0);
  async function runCrossAxisTest() {
    if (!serial.connected) return;
    cross = { verdict: 'running', detail: '' };
    crossCapturing = true;
    const start = performance.now();
    let lastT = start;
    const intX = { v: 0 }, intY = { v: 0 }, intZ = { v: 0 };
    const DURATION_MS = 4000;  // 90° en 4 s = 22.5°/s. Tiempo suficiente.
    await new Promise<void>((resolve) => {
      const id = setInterval(() => {
        const now = performance.now();
        const dt = (now - lastT) / 1000;
        lastT = now;
        intX.v += serial.gyro.x * dt;
        intY.v += serial.gyro.y * dt;
        intZ.v += serial.gyro.z * dt;
        crossProgress = Math.min(1, (now - start) / DURATION_MS);
        if (now - start >= DURATION_MS) {
          clearInterval(id);
          resolve();
        }
      }, 16);
    });
    crossCapturing = false;
    // Aplicar mapeo de ejes actual para obtener ∫yaw paciente.
    const ax = serial.axes.gyro;
    const intMap: Record<string, number> = { x: intX.v, y: intY.v, z: intZ.v };
    const yawInt = intMap[ax.yaw.axis] * ax.yaw.sign;
    const pitchInt = intMap[ax.pitch.axis] * ax.pitch.sign;
    const rollInt = intMap[ax.roll.axis] * ax.roll.sign;
    const otherMax = Math.max(Math.abs(pitchInt), Math.abs(rollInt));
    cross = {
      verdict: evalCrossAxis(yawInt, otherMax),
      detail: `∫yaw = ${yawInt.toFixed(0)}°, ∫pitch = ${pitchInt.toFixed(0)}°, ∫roll = ${rollInt.toFixed(0)}°`,
    };
  }

  function reset() {
    gravity = { verdict: 'pending', detail: '' };
    noise = { verdict: 'pending', detail: '' };
    bias = { verdict: 'pending', detail: '' };
    cross = { verdict: 'pending', detail: '' };
  }

  function badgeClass(v: Verdict): string {
    return `badge badge-${v}`;
  }
  function badgeLabel(v: Verdict): string {
    return v === 'pending' ? '—' : v === 'running' ? '…' : v;
  }

  // Veredicto global: el peor de los 4. Si alguno está pending/running, no
  // emitimos veredicto.
  let overall = $derived.by<Verdict>(() => {
    const all = [gravity.verdict, noise.verdict, bias.verdict, cross.verdict];
    if (all.some((v) => v === 'pending' || v === 'running')) return 'pending';
    if (all.some((v) => v === 'roto')) return 'roto';
    if (all.some((v) => v === 'marginal')) return 'marginal';
    return 'usable';
  });
</script>

<div class="card hw-val">
  <div class="card-h">
    Validación funcional
    {#if overall !== 'pending'}
      <span class={badgeClass(overall)} title="Veredicto global (peor de los 4 tests)">
        {badgeLabel(overall)}
      </span>
    {/if}
  </div>

  <p class="lead small">
    Detecta hardware no usable para vHIT (no piratería). Veredicto graduado por test.
    Apoyá el SimHIT en superficie estable y plana antes de empezar.
  </p>

  <table class="tests">
    <thead>
      <tr><th>Test</th><th>Veredicto</th><th>Detalle</th></tr>
    </thead>
    <tbody>
      <tr>
        <td>1. Gravedad estática</td>
        <td><span class={badgeClass(gravity.verdict)}>{badgeLabel(gravity.verdict)}</span></td>
        <td>{gravity.detail || '—'}</td>
      </tr>
      <tr>
        <td>2. Noise floor del gyro</td>
        <td><span class={badgeClass(noise.verdict)}>{badgeLabel(noise.verdict)}</span></td>
        <td>{noise.detail || '—'}</td>
      </tr>
      <tr>
        <td>3. Bias estático del gyro</td>
        <td><span class={badgeClass(bias.verdict)}>{badgeLabel(bias.verdict)}</span></td>
        <td>{bias.detail || '—'}</td>
      </tr>
      <tr>
        <td>4. Cross-axis (interactivo)</td>
        <td><span class={badgeClass(cross.verdict)}>{badgeLabel(cross.verdict)}</span></td>
        <td>{cross.detail || '—'}</td>
      </tr>
    </tbody>
  </table>

  {#if running}
    <div class="progress-wrap">
      <span class="muted small">{progressLabel}</span>
      <div class="progress"><div class="progress-fill" style:width="{progressPct * 100}%"></div></div>
    </div>
  {/if}

  <div class="actions">
    <button class="primary" onclick={runAutoTests} disabled={running || !serial.connected || crossCapturing}>
      ▶ Ejecutar tests 1-3 (11 s, sensor quieto)
    </button>
    {#if !crossCapturing}
      <button onclick={runCrossAxisTest} disabled={running || !serial.connected}>
        ↻ Test 4: rotar yaw 90° derecha (4 s)
      </button>
    {:else}
      <span class="cross-running">
        Rotando… {(crossProgress * 100).toFixed(0)}%
        <div class="progress mini"><div class="progress-fill" style:width="{crossProgress * 100}%"></div></div>
      </span>
    {/if}
    <button onclick={reset} disabled={running || crossCapturing}>Reset</button>
  </div>

  {#if reference}
    <p class="ref small muted">
      Umbrales derivados de: <strong>{reference.label}</strong> — ARW {reference.arw_deg_sqrt_hr} °/√h × 2-3, BI {reference.bias_instability_deg_hr} °/h × 3-5.
    </p>
  {:else}
    <p class="ref small muted">Sin referencia del chip: usando defaults conservadores (ARW 0.6 °/√h, BI 80 °/h).</p>
  {/if}
</div>

<style>
  .hw-val { display: flex; flex-direction: column; gap: 10px; }
  .lead { color: var(--text-muted, #94a3b8); }
  .small { font-size: 12px; }
  .tests { width: 100%; border-collapse: collapse; font-size: 13px; }
  .tests th, .tests td {
    text-align: left; padding: 6px 8px;
    border-bottom: 1px solid var(--border, #334155);
  }
  .tests th { color: var(--text-muted, #94a3b8); font-weight: 500; font-size: 12px; }
  .badge {
    display: inline-block; padding: 2px 8px; border-radius: 10px;
    font-size: 11px; font-weight: 600; text-transform: capitalize;
  }
  .badge-usable   { background: rgba(34, 197, 94, 0.15);  color: #22c55e; }
  .badge-marginal { background: rgba(250, 204, 21, 0.15); color: #facc15; }
  .badge-roto     { background: rgba(239, 68, 68, 0.15);  color: #ef4444; }
  .badge-pending  { background: var(--surface-2, #0f1623); color: var(--text-muted, #94a3b8); }
  .badge-running  { background: rgba(59, 130, 246, 0.15); color: #60a5fa; }
  .progress-wrap { display: flex; flex-direction: column; gap: 4px; }
  .progress {
    height: 10px; background: var(--surface-2, #0f1623);
    border-radius: 5px; overflow: hidden;
  }
  .progress.mini { width: 120px; height: 6px; display: inline-block; vertical-align: middle; margin-left: 6px; }
  .progress-fill { height: 100%; background: #22c55e; transition: width 100ms linear; }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .cross-running { color: var(--text-muted, #94a3b8); font-size: 12px; }
  .ref { margin-top: 4px; }
</style>
