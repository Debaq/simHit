<script lang="ts">
  import { sim } from '$lib/simulator.svelte';
  import { serial, type Axis, type AxesConfig } from '$lib/serial.svelte';
  import { acceptance } from '$lib/acceptance.svelte';

  let { impulseLayout = 'compact' as 'compact' | 'prominent' } = $props();

  let showAxes = $state(false);
  const AXES: Axis[] = ['x', 'y', 'z'];
  type Group = 'pose' | 'gyro';
  type Dof = 'yaw' | 'pitch' | 'roll';

  function setAxis(group: Group, dof: Dof, axis: Axis) {
    const next = structuredClone($state.snapshot(serial.axes)) as AxesConfig;
    next[group][dof].axis = axis;
    serial.setAxes(next);
  }
  function flipSign(group: Group, dof: Dof) {
    const next = structuredClone($state.snapshot(serial.axes)) as AxesConfig;
    next[group][dof].sign = (next[group][dof].sign === 1 ? -1 : 1) as 1 | -1;
    serial.setAxes(next);
  }

  // Live readout para verificar mapeo: rota cabeza en cada plano y observa cuál
  // fila se enciende (la que crece hacia el lado esperado es la correcta).
  let liveGyroYaw   = $state(0);
  let liveGyroPitch = $state(0);
  let liveGyroRoll  = $state(0);
  let livePoseYaw   = $state(0);
  let livePoseRoll  = $state(0);
  let livePosePitch = $state(0);
  $effect(() => {
    const id = setInterval(() => {
      liveGyroYaw   = serial.gyroYaw;
      liveGyroPitch = serial.gyroPitch;
      liveGyroRoll  = serial.gyroRoll;
      livePoseYaw   = serial.poseYaw;
      livePosePitch = serial.posePitch;
      livePoseRoll  = serial.poseRoll;
    }, 80);
    return () => clearInterval(id);
  });
  function bar(v: number, max: number) {
    const w = Math.min(100, (Math.abs(v) / max) * 100);
    return { w, pos: v >= 0 };
  }

  // Tolerancia de pose neutra (°) para considerar que la cabeza está en posición correcta.
  // Configurable por el docente desde el panel de aceptación.
  let YAW_TOL = $derived(acceptance.active.yawTol);
  let PITCH_TOL = $derived(acceptance.active.pitchTol);
  let ROLL_TOL = $derived(acceptance.active.rollTol);

  // Pose objetivo (puede llegar en ráfagas por batching del serial USB)
  let yawTarget = $derived(sim.headYaw);
  let pitchTarget = $derived(sim.headPitch);
  let rollTarget = $derived(sim.headRoll);

  // Pose suavizada por requestAnimationFrame (lerp exponencial hacia target)
  // Esto desacopla la UI del batching del driver y elimina el efecto "cuadrado".
  let yaw = $state(0);
  let pitch = $state(0);
  let roll = $state(0);

  // Constante de tiempo del suavizado (ms). Más bajo = más responsivo, más jitter.
  // ~40 ms = critical damp ≈ 25 Hz, suaviza batches de 50-100 Hz manteniendo respuesta a impulsos.
  const SMOOTH_TAU_MS = 40;

  $effect(() => {
    let raf = 0;
    let prev = performance.now();
    const tick = (now: number) => {
      const dt = now - prev;
      prev = now;
      const a = 1 - Math.exp(-dt / SMOOTH_TAU_MS);
      yaw   += (yawTarget   - yaw)   * a;
      pitch += (pitchTarget - pitch) * a;
      roll  += (rollTarget  - roll)  * a;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  });

  let poseOk = $derived(
    Math.abs(yaw) <= YAW_TOL && Math.abs(pitch) <= PITCH_TOL && Math.abs(roll) <= ROLL_TOL
  );
  let poseLabel = $derived.by(() => {
    if (poseOk) return { txt: 'Pose neutra OK', cls: 'ok' };
    const errs = [
      { v: Math.abs(yaw) - YAW_TOL, msg: yaw < 0 ? 'gira a la derecha' : 'gira a la izquierda' },
      { v: Math.abs(pitch) - PITCH_TOL, msg: pitch < 0 ? 'baja la cabeza' : 'sube la cabeza' },
      { v: Math.abs(roll) - ROLL_TOL, msg: roll < 0 ? 'inclina al lado opuesto (der.)' : 'inclina al lado opuesto (izq.)' },
    ].filter((e) => e.v > 0).sort((a, b) => b.v - a.v);
    return { txt: 'Corregir: ' + (errs[0]?.msg ?? ''), cls: 'warn' };
  });

  let last = $derived(sim.lastImpulse);
  let verdict = $derived(sim.lastVerdict);

  // helpers SVG (cálculos derivados de los ángulos)
  let yawScale = $derived(Math.cos((yaw * Math.PI) / 180));
  let yawAbsScaled = $derived(Math.max(0.35, Math.abs(yawScale)));
  let eyeShift = $derived(14 * Math.sin((yaw * Math.PI) / 180));
  let pitchA = $derived((-PITCH_TOL * Math.PI) / 180);
  let pitchB = $derived((PITCH_TOL * Math.PI) / 180);

  // Banda amarilla: 2× la tolerancia (zona de advertencia)
  const WARN_MULT = 2;
  let YAW_WARN = $derived(YAW_TOL * WARN_MULT);
  let PITCH_WARN = $derived(PITCH_TOL * WARN_MULT);
  let ROLL_WARN = $derived(ROLL_TOL * WARN_MULT);
  let pitchWA = $derived((-PITCH_WARN * Math.PI) / 180);
  let pitchWB = $derived((PITCH_WARN * Math.PI) / 180);
</script>

<div class="live">
  <!-- Panel POSE -->
  <div class="panel pose">
    <div class="panel-title">
      <span>Posición de la cabeza</span>
      <span class="pose-tag" class:ok={poseOk} class:warn={!poseOk}>
        {poseOk ? '✓' : '!'} {poseLabel.txt}
      </span>
      <button class="axes-btn" type="button" onclick={() => (showAxes = !showAxes)} title="Mapeo de ejes del sensor">
        ⚙ ejes
      </button>
    </div>

    {#if showAxes}
      <div class="axes-panel">
        <div class="axes-row axes-head">
          <span></span>
          <span>x</span><span>y</span><span>z</span>
          <span>±</span>
          <span style="text-align:right">val</span>
          <span>en vivo</span>
        </div>
        {#each ['pose', 'gyro'] as g (g)}
          <div class="axes-group-lab">
            {g === 'pose' ? 'Posición (ángulo, °)' : 'Velocidad (gyro, °/s)'}
          </div>
          {#each ['yaw', 'pitch', 'roll'] as d (g + d)}
            {@const m = serial.axes[g as Group][d as Dof]}
            {@const live =
              g === 'pose'
                ? d === 'yaw' ? livePoseYaw : d === 'pitch' ? livePosePitch : livePoseRoll
                : d === 'yaw' ? liveGyroYaw : d === 'pitch' ? liveGyroPitch : liveGyroRoll}
            {@const max = g === 'pose' ? 90 : 200}
            {@const b = bar(live, max)}
            <div class="axes-row">
              <span class="dof">{d}</span>
              {#each AXES as ax}
                <label class="ax-cell">
                  <input
                    type="radio"
                    name={`${g}-${d}`}
                    checked={m.axis === ax}
                    onchange={() => setAxis(g as Group, d as Dof, ax)}
                  />
                </label>
              {/each}
              <button class="sign-btn" type="button" onclick={() => flipSign(g as Group, d as Dof)}>
                {m.sign === 1 ? '+' : '−'}
              </button>
              <span class="live-num" class:hot={Math.abs(live) > max * 0.15}>
                {live.toFixed(g === 'pose' ? 1 : 0)}
              </span>
              <div class="live-bar">
                <div class="live-bar-fill" class:neg={!b.pos} style:width="{b.w}%"></div>
              </div>
            </div>
          {/each}
        {/each}
        <div class="axes-actions">
          <button type="button" onclick={() => serial.resetAxes()}>Reset</button>
          <span class="muted small">Cambios se guardan al instante</span>
        </div>
      </div>
    {/if}

    <div class="pose-body">
      <!-- Vista superior: axial — yaw como rotación de la cabeza vista desde arriba -->
      <div class="view">
        <svg viewBox="-100 -98 200 108" class="dial" aria-label="Vista superior">
          <!-- Semianillo superior: rango ±90° (frente arriba) -->
          <path d="M -90 0 A 90 90 0 0 1 90 0 Z" fill="var(--surface-2)" stroke="var(--border)" />
          <!-- Banda roja: fuera de zona de advertencia -->
          <path d="M -90 0 A 90 90 0 0 1 90 0 Z" fill="var(--danger)" opacity="0.10" />
          <!-- Banda amarilla: ±1.5×YAW_TOL -->
          <path
            d={`M 0 0 L ${90 * Math.sin(-YAW_WARN * Math.PI / 180)} ${-90 * Math.cos(-YAW_WARN * Math.PI / 180)} A 90 90 0 0 1 ${90 * Math.sin(YAW_WARN * Math.PI / 180)} ${-90 * Math.cos(YAW_WARN * Math.PI / 180)} Z`}
            fill="#facc15"
          />
          <!-- Zona objetivo yaw (cono ±YAW_TOL hacia frente) -->
          <path
            d={`M 0 0 L ${90 * Math.sin(-YAW_TOL * Math.PI / 180)} ${-90 * Math.cos(-YAW_TOL * Math.PI / 180)} A 90 90 0 0 1 ${90 * Math.sin(YAW_TOL * Math.PI / 180)} ${-90 * Math.cos(YAW_TOL * Math.PI / 180)} Z`}
            fill="#22c55e"
          />
          <!-- Ticks F/I/D (rango ±90°) -->
          {#each [{ a: 0, l: 'F' }, { a: 90, l: 'D' }, { a: -90, l: 'I' }] as t}
            <text x={96 * Math.sin((t.a * Math.PI) / 180)} y={-96 * Math.cos((t.a * Math.PI) / 180) + 3}
                  text-anchor="middle" font-size="11" fill="var(--text-muted)">{t.l}</text>
          {/each}
          <!-- Cabeza vista superior, rota con yaw — sin ojos, con orejas laterales -->
          <g transform="rotate({yaw})">
            <line x1="0" y1="-50" x2="0" y2="-86" stroke="#000" stroke-width="3.5" stroke-linecap="round" />
            <ellipse cx="0" cy="0" rx="38" ry="50" fill="var(--surface)" stroke="var(--head-color)" stroke-width="2" />
            <!-- nariz al frente -->
            <path d="M -8 -50 Q 0 -64 8 -50 Z" fill="var(--head-color)" />
            <!-- orejas a los costados -->
            <ellipse cx="-38" cy="0" rx="4" ry="10" fill="var(--head-color)" opacity="0.7" />
            <ellipse cx="38" cy="0" rx="4" ry="10" fill="var(--head-color)" opacity="0.7" />
          </g>
          <line x1="-3" y1="0" x2="3" y2="0" stroke="var(--text-muted)" />
          <line x1="0" y1="-3" x2="0" y2="0" stroke="var(--text-muted)" />
          <text x="-92" y="-86" font-size="9" fill="var(--text-muted)">SUPERIOR</text>
          {#if Math.abs(yaw) > YAW_WARN}
            <g class="calibra">
              <rect x="-70" y="-22" width="140" height="28" rx="4" fill="var(--danger)" />
              <text x="0" y="-2" text-anchor="middle" font-size="20" font-weight="900" fill="white">CALIBRA!!!</text>
            </g>
          {/if}
        </svg>
        <div class="view-cap">yaw</div>
      </div>

      <!-- Vista coronal: frente del paciente (roll como inclinación) -->
      <div class="view">
        <svg viewBox="-100 -98 200 108" class="dial" aria-label="Vista coronal">
          <!-- Semianillo superior: rango ±90° (vertical neutro arriba) -->
          <path d="M -90 0 A 90 90 0 0 1 90 0 Z" fill="var(--surface-2)" stroke="var(--border)" />
          <!-- Banda roja: fuera de zona de advertencia -->
          <path d="M -90 0 A 90 90 0 0 1 90 0 Z" fill="var(--danger)" opacity="0.10" />
          <!-- Banda amarilla: ±2×ROLL_TOL -->
          <path
            d={`M 0 0 L ${90 * Math.sin(-ROLL_WARN * Math.PI / 180)} ${-90 * Math.cos(-ROLL_WARN * Math.PI / 180)} A 90 90 0 0 1 ${90 * Math.sin(ROLL_WARN * Math.PI / 180)} ${-90 * Math.cos(ROLL_WARN * Math.PI / 180)} Z`}
            fill="#facc15"
          />
          <!-- Zona objetivo roll (cono ±ROLL_TOL desde vertical) -->
          <path
            d={`M 0 0 L ${90 * Math.sin(-ROLL_TOL * Math.PI / 180)} ${-90 * Math.cos(-ROLL_TOL * Math.PI / 180)} A 90 90 0 0 1 ${90 * Math.sin(ROLL_TOL * Math.PI / 180)} ${-90 * Math.cos(ROLL_TOL * Math.PI / 180)} Z`}
            fill="#22c55e"
          />
          <!-- Cabeza vista frontal (coronal) — solo mitad superior, rota con roll -->
          <g transform="rotate({roll})">
            <line x1="0" y1="-54" x2="0" y2="-86" stroke="#000" stroke-width="3.5" stroke-linecap="round" />
            <ellipse cx="0" cy="0" rx="42" ry="54" fill="var(--surface)" stroke="var(--head-color)" stroke-width="2" />
            <circle cx="-14" cy="-12" r="4" fill="var(--accent)" />
            <circle cx="14"  cy="-12" r="4" fill="var(--accent)" />
            <path d="M -4 4 Q 0 14 4 4 Z" fill="var(--head-color)" />
            <ellipse cx="-42" cy="0" rx="4" ry="10" fill="var(--head-color)" opacity="0.6" />
            <ellipse cx="42"  cy="0" rx="4" ry="10" fill="var(--head-color)" opacity="0.6" />
          </g>
          <!-- Etiquetas -->
          <text x="-92" y="-86" font-size="9" fill="var(--text-muted)">CORONAL</text>
          <text x="-96" y="-3" font-size="11" fill="var(--text-muted)">I</text>
          <text x="92"  y="-3" font-size="11" fill="var(--text-muted)">D</text>
          {#if Math.abs(roll) > ROLL_WARN}
            <g class="calibra">
              <rect x="-70" y="-22" width="140" height="28" rx="4" fill="var(--danger)" />
              <text x="0" y="-2" text-anchor="middle" font-size="20" font-weight="900" fill="white">CALIBRA!!!</text>
            </g>
          {/if}
        </svg>
        <div class="view-cap">roll</div>
      </div>

      <!-- Vista lateral: perfil derecho (pitch como inclinación adelante/atrás)
           Banda central recortada (±50% vertical) para aprovechar espacio. -->
      <div class="view">
        <svg viewBox="-100 -42 200 84" class="dial" aria-label="Vista lateral">
          <circle cx="0" cy="0" r="92" fill="var(--surface-2)" stroke="var(--border)" />
          <line x1="-92" y1="0" x2="92" y2="0" stroke="var(--border-strong)" stroke-dasharray="3 3" />
          <!-- Banda roja: fuera de zona de advertencia -->
          <circle cx="0" cy="0" r="92" fill="var(--danger)" opacity="0.10" />
          <!-- Banda amarilla: ±1.5×PITCH_TOL -->
          <path
            d={`M 0 0 L ${92 * Math.cos(pitchWA)} ${92 * Math.sin(pitchWA)} A 92 92 0 0 1 ${92 * Math.cos(pitchWB)} ${92 * Math.sin(pitchWB)} Z`}
            fill="#facc15"
          />
          <!-- Zona objetivo pitch (sector ±PITCH_TOL desde horizontal-frente) -->
          <path
            d={`M 0 0 L ${92 * Math.cos(pitchA)} ${92 * Math.sin(pitchA)} A 92 92 0 0 1 ${92 * Math.cos(pitchB)} ${92 * Math.sin(pitchB)} Z`}
            fill="#22c55e"
          />
          <!-- Perfil cabeza, rota con pitch -->
          <g transform="rotate({pitch})">
            <line x1="38" y1="0" x2="92" y2="0" stroke="#000" stroke-width="3.5" stroke-linecap="round" />
            <ellipse cx="-4" cy="-4" rx="44" ry="48" fill="var(--surface)" stroke="var(--head-color)" stroke-width="2" />
            <path d="M 38 -2 L 54 -4 L 38 8 Z" fill="var(--head-color)" />
            <circle cx="24" cy="-14" r="3.5" fill="var(--accent)" />
            <ellipse cx="-34" cy="0" rx="4" ry="10" fill="var(--head-color)" opacity="0.7" />
            <path d="M 18 32 Q 8 42 -10 36" fill="none" stroke="var(--head-color)" stroke-width="1.5" />
          </g>
          <text x="-92" y="-32" font-size="9" fill="var(--text-muted)">LATERAL</text>
          <text x="94"  y="3" font-size="11" fill="var(--text-muted)">F</text>
          <text x="-98" y="3" font-size="11" fill="var(--text-muted)">A</text>
          {#if Math.abs(pitch) > PITCH_WARN}
            <g class="calibra">
              <rect x="-70" y="-15" width="140" height="28" rx="4" fill="var(--danger)" />
              <text x="0" y="5" text-anchor="middle" font-size="20" font-weight="900" fill="white">CALIBRA!!!</text>
            </g>
          {/if}
        </svg>
        <div class="view-cap">pitch</div>
      </div>

      <div class="pose-readouts">
        <div class="ro">
          <span class="ro-lab">yaw</span>
          <b class:warn={Math.abs(yaw) > YAW_TOL}>{yaw.toFixed(1)}°</b>
        </div>
        <div class="ro">
          <span class="ro-lab">pitch</span>
          <b class:warn={Math.abs(pitch) > PITCH_TOL}>{pitch.toFixed(1)}°</b>
        </div>
        <div class="ro">
          <span class="ro-lab">roll</span>
          <b class:warn={Math.abs(roll) > ROLL_TOL}>{roll.toFixed(1)}°</b>
        </div>
        <div class="ro hint">
          <span class="ro-lab">tol.</span>
          <span class="muted small">±{YAW_TOL}°</span>
        </div>
      </div>
    </div>
  </div>

  <!-- Panel ÚLTIMO IMPULSO -->
  <div
    class="panel impulse"
    class:ok={verdict?.ok}
    class:bad={verdict && !verdict.ok}
    class:prominent={impulseLayout === 'prominent'}
  >
    {#if impulseLayout === 'prominent'}
      <div class="panel-title impulse-title">
        <span>Último impulso</span>
        {#if last}
          <span class="side-chip {last.side === 'LL' ? 'll' : 'rl'}">{last.side}</span>
          <span class="muted small">#{last.id}</span>
        {/if}
        {#if verdict}
          <span class="level-chip" title="Nivel de aceptación activo">{verdict.levelName}</span>
        {/if}
      </div>

      {#if !last}
        <div class="empty big">Aún sin impulsos. Realiza un impulso para ver la retroalimentación.</div>
      {:else if verdict}
        <div class="prom-head">
          <div class="prom-badge {verdict.ok ? 'ok' : 'bad'}">{verdict.ok ? '✓' : '✗'}</div>
          <div class="prom-meta">
            <div class="prom-title">{verdict.ok ? 'Impulso correcto' : 'Impulso fuera de rango'}</div>
            <div class="prom-sub">
              Lado {last.side === 'LL' ? 'Izquierdo' : 'Derecho'} · {verdict.levelName}
            </div>
          </div>
        </div>

        <div class="prom-tiles">
          {#each verdict.checks as c (c.id)}
            {@const dec = c.id === 'gain' ? 2 : c.id === 'amp' ? 1 : 0}
            {@const hint = c.ok
              ? 'OK'
              : c.id === 'amp'
                ? 'más corto'
                : c.id === 'peak'
                  ? (c.value < c.min ? 'más intenso' : 'menos intenso')
                  : c.id === 'dur'
                    ? (c.value < c.min ? 'más lento' : 'más rápido')
                    : (c.value < c.min ? 'más amplio' : 'menos amplio')}
            <div class="prom-tile" class:ok={c.ok} class:bad={!c.ok}>
              <div class="prom-tile-lab">{c.label}</div>
              <div class="prom-tile-val">
                {c.value.toFixed(dec)}{#if c.unit}<span class="prom-tile-unit">{c.unit}</span>{/if}
              </div>
              <div class="prom-tile-rng">
                {c.id === 'amp' ? `≤ ${c.max}${c.unit}` : `${c.min}–${c.max}${c.unit ? ' ' + c.unit : ''}`}
              </div>
              <div class="prom-tile-hint">{hint}</div>
            </div>
          {/each}
        </div>

        {#if !verdict.ok && verdict.reasons.length > 0}
          <div class="prom-why">
            <div class="prom-why-lab">¿Qué faltó?</div>
            <ul class="prom-why-list">
              {#each verdict.reasons as r}
                <li>{r}</li>
              {/each}
            </ul>
          </div>
        {/if}
      {/if}
    {:else}
      <div class="panel-title impulse-title">
        <span>Último impulso</span>
        {#if last}
          <span class="side-chip {last.side === 'LL' ? 'll' : 'rl'}">{last.side}</span>
          <span class="muted small">#{last.id}</span>
        {/if}
        {#if verdict}
          <span class="level-chip" title="Nivel de aceptación activo">{verdict.levelName}</span>
          <span class="badge {verdict.ok ? 'ok' : 'bad'}">{verdict.ok ? '✓' : '✗'}</span>
        {/if}
      </div>

      {#if !last}
        <div class="empty">Sin impulsos aún.</div>
      {:else if verdict}
        <div class="imp-row">
          {#each verdict.checks as c (c.id)}
            {@const dec = c.id === 'gain' ? 2 : c.id === 'amp' ? 1 : 0}
            <div class="imp-cell" class:bad={!c.ok} title={`rango ${c.min}–${c.max}${c.unit ? ' ' + c.unit : ''}`}>
              <span class="ro-lab">{c.label}</span>
              <b>{c.value.toFixed(dec)}{#if c.unit}<span class="unit">{c.unit}</span>{/if}</b>
              <span class="range muted">[{c.min}–{c.max}]</span>
            </div>
          {/each}
        </div>
      {/if}
    {/if}
  </div>

</div>

<style>
  .live { display: flex; flex-direction: column; gap: 8px; }

  .panel {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 8px 10px;
  }
  .panel-title {
    display: flex; align-items: center; gap: 8px;
    font-size: 11px; text-transform: uppercase; letter-spacing: .04em;
    color: var(--text-muted); font-weight: 700;
    margin-bottom: 6px;
  }
  .panel-title > span:first-child { flex: 1; }

  .pose-tag {
    font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px;
    text-transform: none; letter-spacing: 0;
  }
  .pose-tag.ok { background: var(--success); color: white; }
  .pose-tag.warn { background: var(--warn); color: white; }

  .axes-btn {
    font-size: 11px; padding: 2px 8px; border-radius: 4px;
    border: 1px solid var(--border); background: var(--surface);
    color: var(--text); cursor: pointer; font-weight: 600;
  }
  .axes-btn:hover { background: var(--surface-2); }

  .axes-panel {
    margin: 6px 0 8px;
    padding: 8px 10px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-family: ui-monospace, monospace;
    font-size: 11px;
  }
  .axes-row {
    display: grid;
    grid-template-columns: 56px repeat(3, 24px) 32px 48px 1fr;
    gap: 6px; align-items: center;
    padding: 2px 0;
  }
  .axes-head { color: var(--text-muted); text-align: center; }
  .axes-head span:first-child { text-align: left; }
  .live-num {
    font-size: 11px; text-align: right; font-variant-numeric: tabular-nums;
    color: var(--text-muted);
  }
  .live-num.hot { color: var(--head-color); font-weight: 700; }
  .live-bar {
    height: 6px; background: var(--surface-2); border-radius: 3px; overflow: hidden;
    position: relative;
  }
  .live-bar-fill {
    height: 100%; background: var(--success); transition: width 60ms linear;
  }
  .live-bar-fill.neg { background: var(--warn); }
  .axes-group-lab {
    margin-top: 6px; font-size: 10px; text-transform: uppercase;
    letter-spacing: .04em; color: var(--text-muted); font-weight: 700;
  }
  .axes-row .dof { text-transform: uppercase; font-weight: 700; font-size: 10px; }
  .ax-cell { display: flex; justify-content: center; }
  .ax-cell input { cursor: pointer; }
  .sign-btn {
    border: 1px solid var(--border); background: var(--surface-2);
    border-radius: 4px; cursor: pointer; font-weight: 700;
    font-family: ui-monospace, monospace; padding: 1px 0;
  }
  .sign-btn:hover { background: var(--accent-soft, var(--surface)); }
  .axes-actions {
    display: flex; gap: 8px; align-items: center;
    margin-top: 8px; padding-top: 6px;
    border-top: 1px solid var(--border);
  }
  .axes-actions button {
    font-size: 11px; padding: 2px 8px; border-radius: 4px;
    border: 1px solid var(--border); background: var(--surface-2);
    cursor: pointer;
  }

  .pose-body {
    display: grid; grid-template-columns: 1fr 1fr 1fr auto; gap: 8px; align-items: center;
  }
  .view { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 2px; min-width: 0; }
  .dial { height: 95px; width: auto; max-width: 100%; display: block; }
  .view-cap { font-size: 10px; color: var(--text-muted); font-family: ui-monospace, monospace; text-align: center; }

  .pose-readouts {
    display: flex; flex-direction: column; gap: 6px;
    font-family: ui-monospace, monospace;
  }
  .ro { display: flex; align-items: baseline; gap: 8px; font-size: 13px; }
  .ro-lab { color: var(--text-muted); font-size: 10px; text-transform: uppercase; letter-spacing: .04em; min-width: 44px; }
  .ro b {
    font-size: 18px; font-weight: 700;
    font-variant-numeric: tabular-nums;
    display: inline-block; min-width: 64px; text-align: right;
  }
  .ro b.warn { color: var(--warn); }

  .impulse.ok  { border-color: var(--success); }
  .impulse.bad { border-color: var(--danger); }

  .empty { color: var(--text-muted); font-size: 11px; padding: 2px 0; }

  .impulse { padding: 6px 10px; }
  .impulse .panel-title { margin-bottom: 4px; }
  .impulse-title .badge { margin-left: 4px; }

  .imp-row {
    display: flex; gap: 14px; align-items: baseline;
  }
  .imp-cell { display: inline-flex; align-items: baseline; gap: 4px; font-family: ui-monospace, monospace; }
  .imp-cell .ro-lab { font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: .04em; }
  .imp-cell b { font-size: 14px; font-weight: 700; }
  .imp-cell.bad b { color: var(--danger); }
  .imp-cell .unit { font-size: 10px; color: var(--text-muted); margin-left: 1px; }
  .imp-cell .range { font-size: 9px; }
  .imp-row { flex-wrap: wrap; }

  /* Prominent layout (modo práctica) — crece para ocupar la altura disponible */
  .impulse.prominent {
    padding: 10px 12px; border-width: 2px;
    flex: 1; min-height: 0;
    display: flex; flex-direction: column;
  }
  .impulse.prominent.ok { background: #ecfdf5; }
  .impulse.prominent.bad { background: #fef2f2; }
  .impulse.prominent .panel-title { margin-bottom: 6px; font-size: 11px; }
  .empty.big {
    font-size: 14px; color: var(--text-muted); text-align: center;
    flex: 1; display: flex; align-items: center; justify-content: center;
  }

  /* Una sola fila: badge + meta + tiles + razones a la derecha cuando falla */
  .prom-head {
    display: flex; align-items: center; gap: 10px;
    margin-bottom: 6px;
  }
  .prom-badge {
    width: 36px; height: 36px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 22px; font-weight: 800; color: white; flex-shrink: 0;
    line-height: 1;
  }
  .prom-badge.ok { background: var(--success); }
  .prom-badge.bad { background: var(--danger); }
  .prom-title { font-size: 15px; font-weight: 700; line-height: 1.1; }
  .impulse.prominent.ok .prom-title { color: var(--success); }
  .impulse.prominent.bad .prom-title { color: var(--danger); }
  .prom-sub { font-size: 11px; color: var(--text-muted); margin-top: 1px; }

  .prom-tiles {
    display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px;
    margin-bottom: 8px;
    flex: 1; min-height: 0;
  }
  .prom-tile {
    padding: 8px 10px;
    border-radius: var(--radius-sm);
    border: 2px solid;
    background: var(--surface);
    display: grid;
    grid-template-columns: 1fr auto;
    grid-template-rows: auto 1fr auto;
    column-gap: 6px;
    align-items: center;
    min-height: 0;
  }
  .prom-tile.ok { border-color: var(--success); }
  .prom-tile.bad { border-color: var(--danger); }
  .prom-tile-lab {
    font-size: 10px; text-transform: uppercase; letter-spacing: .04em;
    color: var(--text-muted); font-weight: 700;
    grid-column: 1; grid-row: 1;
  }
  .prom-tile-rng {
    font-size: 10px; color: var(--text-muted); font-family: ui-monospace, monospace;
    grid-column: 2; grid-row: 1; text-align: right;
  }
  .prom-tile-val {
    font-family: ui-monospace, monospace;
    font-size: clamp(22px, 4vh, 44px); font-weight: 800; line-height: 1;
    grid-column: 1 / -1; grid-row: 2;
    align-self: center; text-align: center;
  }
  .prom-tile.ok .prom-tile-val { color: var(--success); }
  .prom-tile.bad .prom-tile-val { color: var(--danger); }
  .prom-tile-unit { font-size: 10px; font-weight: 500; color: var(--text-muted); margin-left: 1px; }
  .prom-tile-hint {
    font-size: 14px; font-weight: 800;
    grid-column: 1 / -1; grid-row: 3; text-align: center;
    white-space: normal; line-height: 1.2;
    padding: 4px 6px; border-radius: var(--radius-sm);
    margin-top: 4px;
  }
  .prom-tile.ok .prom-tile-hint { background: #dcfce7; }
  .prom-tile.bad .prom-tile-hint { background: #fee2e2; }
  .prom-tile.ok .prom-tile-hint { color: var(--success); }
  .prom-tile.bad .prom-tile-hint { color: var(--danger); }

  .prom-why {
    padding: 6px 12px; background: var(--surface);
    border: 2px solid var(--danger); border-radius: var(--radius-sm);
    display: flex; align-items: center; gap: 12px; flex-wrap: nowrap;
    overflow-x: auto;
  }
  .prom-why-lab {
    font-size: 16px; text-transform: uppercase; letter-spacing: .04em;
    color: var(--danger); font-weight: 800; flex-shrink: 0;
  }
  .prom-why-list {
    margin: 0; padding: 0; list-style: none;
    display: flex !important; flex-direction: row !important;
    gap: 6px; flex-wrap: wrap; align-items: center;
  }
  .prom-why-list li {
    display: inline-block;
    font-size: 14px; font-weight: 700; color: var(--danger);
    line-height: 1.1;
    padding: 4px 10px;
    background: #fee2e2;
    border-radius: 999px;
    white-space: nowrap;
  }

  @media (max-width: 900px) {
    .prom-tiles { grid-template-columns: repeat(2, 1fr); }
  }

  .badge { padding: 1px 8px; border-radius: 999px; font-weight: 700; font-size: 11px; }
  .badge.ok  { background: var(--success); color: white; }
  .badge.bad { background: var(--danger); color: white; }

  .side-chip {
    color: white; font-size: 10px; font-weight: 700; letter-spacing: .04em;
    padding: 1px 6px; border-radius: 3px;
  }
  .side-chip.ll { background: var(--side-ll); }
  .side-chip.rl { background: var(--side-rl); }

  .level-chip {
    margin-left: auto;
    font-size: 10px; font-weight: 600; letter-spacing: .03em;
    padding: 1px 8px; border-radius: 999px;
    border: 1px solid var(--border-strong);
    background: var(--surface);
    color: var(--text-muted);
    text-transform: none;
  }

  .muted { color: var(--text-muted); }
  .small { font-size: 11px; }
  .hint { opacity: .8; }
</style>
