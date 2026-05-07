<script lang="ts">
  import { sim } from '$lib/simulator.svelte';

  // Tolerancia de pose neutra (°) para considerar que la cabeza está en posición correcta
  const YAW_TOL = 6;
  const PITCH_TOL = 6;
  const ROLL_TOL = 6;

  let yaw = $derived(sim.headYaw);
  let pitch = $derived(sim.headPitch);
  let roll = $derived(sim.headRoll);

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
</script>

<div class="live">
  <!-- Panel POSE -->
  <div class="panel pose">
    <div class="panel-title">
      <span>Posición de la cabeza</span>
      <span class="pose-tag" class:ok={poseOk} class:warn={!poseOk}>
        {poseOk ? '✓' : '!'} {poseLabel.txt}
      </span>
    </div>

    <div class="pose-body">
      <!-- Vista superior: axial — yaw como rotación de la cabeza vista desde arriba -->
      <div class="view">
        <svg viewBox="-100 -90 200 180" class="dial" aria-label="Vista superior">
          <circle cx="0" cy="0" r="78" fill="var(--surface-2)" stroke="var(--border)" />
          <!-- Zona objetivo yaw (cono ±YAW_TOL hacia frente) -->
          <path
            d={`M 0 0 L ${78 * Math.sin(-YAW_TOL * Math.PI / 180)} ${-78 * Math.cos(-YAW_TOL * Math.PI / 180)} A 78 78 0 0 1 ${78 * Math.sin(YAW_TOL * Math.PI / 180)} ${-78 * Math.cos(YAW_TOL * Math.PI / 180)} Z`}
            fill="var(--success)" opacity="0.18"
          />
          <!-- Ticks F/A/I/D -->
          {#each [{ a: 0, l: 'F' }, { a: 90, l: 'D' }, { a: 180, l: 'A' }, { a: -90, l: 'I' }] as t}
            <text x={92 * Math.sin((t.a * Math.PI) / 180)} y={-92 * Math.cos((t.a * Math.PI) / 180) + 3}
                  text-anchor="middle" font-size="9" fill="var(--text-muted)">{t.l}</text>
          {/each}
          <!-- Cabeza vista superior, rota con yaw -->
          <g transform="rotate({yaw})">
            <ellipse cx="0" cy="0" rx="32" ry="42" fill="var(--surface)" stroke="var(--head-color)" stroke-width="2" />
            <path d="M -7 -42 Q 0 -54 7 -42 Z" fill="var(--head-color)" />
            <circle cx="-12" cy="-18" r="3.2" fill="var(--accent)" />
            <circle cx="12" cy="-18" r="3.2" fill="var(--accent)" />
            <line x1="0" y1="-42" x2="0" y2="-72" stroke={Math.abs(yaw) <= YAW_TOL ? 'var(--success)' : 'var(--warn)'} stroke-width="2" stroke-dasharray="3 3" />
          </g>
          <line x1="-3" y1="0" x2="3" y2="0" stroke="var(--text-muted)" />
          <line x1="0" y1="-3" x2="0" y2="3" stroke="var(--text-muted)" />
          <text x="-78" y="-78" font-size="9" fill="var(--text-muted)">SUPERIOR</text>
        </svg>
        <div class="view-cap">Superior · yaw {yaw.toFixed(0)}°</div>
      </div>

      <!-- Vista coronal: frente del paciente (yaw como giro, roll como inclinación) -->
      <div class="view">
        <svg viewBox="-100 -90 200 180" class="dial" aria-label="Vista coronal">
          <circle cx="0" cy="0" r="78" fill="var(--surface-2)" stroke="var(--border)" />
          <!-- Horizonte de referencia -->
          <line x1="-78" y1="0" x2="78" y2="0" stroke="var(--border-strong)" stroke-dasharray="3 3" />
          <!-- Zona objetivo roll (cono ±ROLL_TOL desde vertical) -->
          <path
            d={`M 0 0 L ${-78 * Math.sin(-ROLL_TOL * Math.PI / 180)} ${-78 * Math.cos(-ROLL_TOL * Math.PI / 180)} A 78 78 0 0 1 ${-78 * Math.sin(ROLL_TOL * Math.PI / 180)} ${-78 * Math.cos(ROLL_TOL * Math.PI / 180)} Z`}
            fill="var(--success)" opacity="0.16"
          />
          <!-- Cabeza vista frontal: rota con roll, achata anchura con yaw -->
          <g transform="rotate({roll})">
            <!-- contorno cabeza/cara (achatada por yaw para sugerir giro) -->
            <ellipse cx="0" cy="0" rx={36 * yawAbsScaled} ry="46"
                     fill="var(--surface)" stroke="var(--head-color)" stroke-width="2" />
            <!-- ojos: si yaw → 0 son simétricos; si gira, se desplazan -->
            <circle cx={-12 * yawScale + eyeShift} cy="-10" r="3.2" fill="var(--accent)" />
            <circle cx={12 * yawScale + eyeShift}  cy="-10" r="3.2" fill="var(--accent)" />
            <!-- nariz (centro, se desplaza con yaw) -->
            <path d={`M ${eyeShift - 3} 4 Q ${eyeShift} 12 ${eyeShift + 3} 4 Z`} fill="var(--head-color)" />
            <!-- boca -->
            <path d={`M ${eyeShift - 8} 22 Q ${eyeShift} 26 ${eyeShift + 8} 22`} fill="none" stroke="var(--text-muted)" stroke-width="1.5" />
            <!-- orejas: solo si yaw cercano a 0 -->
            {#if Math.abs(yawScale) > 0.7}
              <ellipse cx={-36 * yawScale} cy="0" rx="3" ry="8" fill="var(--head-color)" opacity="0.6" />
              <ellipse cx={36 * yawScale}  cy="0" rx="3" ry="8" fill="var(--head-color)" opacity="0.6" />
            {/if}
          </g>
          <!-- Etiquetas -->
          <text x="-78" y="-78" font-size="9" fill="var(--text-muted)">CORONAL</text>
          <text x="-92" y="3" font-size="9" fill="var(--text-muted)">I</text>
          <text x="86" y="3" font-size="9" fill="var(--text-muted)">D</text>
        </svg>
        <div class="view-cap">Coronal · yaw {yaw.toFixed(0)}° · roll {roll.toFixed(0)}°</div>
      </div>

      <!-- Vista lateral: perfil derecho (pitch como inclinación adelante/atrás) -->
      <div class="view">
        <svg viewBox="-100 -90 200 180" class="dial" aria-label="Vista lateral">
          <circle cx="0" cy="0" r="78" fill="var(--surface-2)" stroke="var(--border)" />
          <line x1="-78" y1="0" x2="78" y2="0" stroke="var(--border-strong)" stroke-dasharray="3 3" />
          <!-- Zona objetivo pitch (sector ±PITCH_TOL desde horizontal-frente) -->
          <path
            d={`M 0 0 L ${78 * Math.cos(pitchA)} ${78 * Math.sin(pitchA)} A 78 78 0 0 1 ${78 * Math.cos(pitchB)} ${78 * Math.sin(pitchB)} Z`}
            fill="var(--success)" opacity="0.16"
          />
          <!-- Perfil cabeza, rota con pitch -->
          <g transform="rotate({pitch})">
            <!-- cráneo -->
            <ellipse cx="-4" cy="-4" rx="38" ry="42" fill="var(--surface)" stroke="var(--head-color)" stroke-width="2" />
            <!-- nariz (apunta al frente = +X) -->
            <path d="M 32 -2 L 46 -4 L 32 6 Z" fill="var(--head-color)" />
            <!-- ojo -->
            <circle cx="20" cy="-12" r="3" fill="var(--accent)" />
            <!-- oreja -->
            <ellipse cx="-30" cy="0" rx="4" ry="9" fill="var(--head-color)" opacity="0.7" />
            <!-- mentón -->
            <path d="M 14 28 Q 6 36 -8 32" fill="none" stroke="var(--head-color)" stroke-width="1.5" />
            <!-- línea de mirada hacia adelante -->
            <line x1="32" y1="0" x2="78" y2="0" stroke={Math.abs(pitch) <= PITCH_TOL ? 'var(--success)' : 'var(--warn)'} stroke-width="2" stroke-dasharray="3 3" />
          </g>
          <text x="-78" y="-78" font-size="9" fill="var(--text-muted)">LATERAL</text>
          <text x="86" y="3" font-size="9" fill="var(--text-muted)">F</text>
          <text x="-92" y="3" font-size="9" fill="var(--text-muted)">A</text>
        </svg>
        <div class="view-cap">Lateral · pitch {pitch.toFixed(0)}°</div>
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
  <div class="panel impulse" class:ok={verdict?.ok} class:bad={verdict && !verdict.ok}>
    <div class="panel-title">
      <span>Último impulso</span>
      {#if last}
        <span class="side-chip {last.side === 'LL' ? 'll' : 'rl'}">{last.side}</span>
        <span class="muted small">#{last.id}</span>
      {/if}
    </div>

    {#if !last}
      <div class="empty">Sin impulsos aún. Realiza una prueba.</div>
    {:else if verdict}
      <div class="imp-grid">
        <div class="imp-cell">
          <span class="ro-lab">pico</span>
          <b>{verdict.peak.toFixed(0)}<span class="unit">°/s</span></b>
        </div>
        <div class="imp-cell">
          <span class="ro-lab">ganancia</span>
          <b>{verdict.gain.toFixed(2)}</b>
        </div>
        <div class="imp-cell verdict">
          {#if verdict.ok}
            <span class="badge ok">✓ Aceptado</span>
          {:else}
            <span class="badge bad">✗ Rechazado</span>
            <span class="muted small">{verdict.reasons.join(' · ')}</span>
          {/if}
        </div>
      </div>
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

  .pose-body {
    display: grid; grid-template-columns: 1fr 1fr 1fr auto; gap: 8px; align-items: center;
  }
  .view { display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 0; }
  .dial { width: 100%; height: auto; max-height: 90px; display: block; }
  .view-cap { font-size: 10px; color: var(--text-muted); font-family: ui-monospace, monospace; text-align: center; }

  .pose-readouts {
    display: flex; flex-direction: column; gap: 6px;
    font-family: ui-monospace, monospace;
  }
  .ro { display: flex; align-items: baseline; gap: 8px; font-size: 13px; }
  .ro-lab { color: var(--text-muted); font-size: 10px; text-transform: uppercase; letter-spacing: .04em; min-width: 44px; }
  .ro b { font-size: 18px; font-weight: 700; }
  .ro b.warn { color: var(--warn); }

  .impulse.ok  { border-color: var(--success); }
  .impulse.bad { border-color: var(--danger); }

  .empty { color: var(--text-muted); font-size: 12px; padding: 4px 0 6px; }

  .imp-grid {
    display: grid; grid-template-columns: auto auto 1fr; gap: 12px; align-items: center;
  }
  .imp-cell { display: flex; flex-direction: column; gap: 2px; font-family: ui-monospace, monospace; }
  .imp-cell b { font-size: 18px; font-weight: 700; }
  .imp-cell .unit { font-size: 10px; color: var(--text-muted); margin-left: 2px; }
  .imp-cell.verdict { font-family: inherit; align-items: flex-start; }

  .badge { padding: 4px 10px; border-radius: 999px; font-weight: 700; font-size: 12px; }
  .badge.ok  { background: var(--success); color: white; }
  .badge.bad { background: var(--danger); color: white; }

  .side-chip {
    color: white; font-size: 10px; font-weight: 700; letter-spacing: .04em;
    padding: 1px 6px; border-radius: 3px;
  }
  .side-chip.ll { background: var(--side-ll); }
  .side-chip.rl { background: var(--side-rl); }

  .muted { color: var(--text-muted); }
  .small { font-size: 11px; }
  .hint { opacity: .8; }
</style>
