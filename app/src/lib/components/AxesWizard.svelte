<script lang="ts">
  // Wizard interactivo de mapeo de ejes (fase 3 de PLAN-CONFIG-SENSOR).
  // Reemplaza la edición manual del AxesConfig por dos tests de rotación
  // guiados: el usuario rota la cabeza en yaw, después en pitch, y el
  // wizard deduce qué eje del sensor mapea a cada DOF del paciente con
  // qué signo. Roll queda como el eje restante con signo +.
  //
  // Asume `pose` en identidad: el firmware ya emite yaw/pitch/roll fusionado
  // por Madgwick, así que ese mapeo rara vez está mal. Editable manualmente
  // desde HeadLiveView si hace falta.
  import { serial, type AxesConfig, type Axis, type AxisMap } from '$lib/serial.svelte';

  type Props = {
    open: boolean;
    onClose: () => void;
  };
  let { open, onClose }: Props = $props();

  type Step = 'intro' | 'yaw' | 'pitch' | 'review';
  let step = $state<Step>('intro');

  // Captura: ventana de 3 s integrando gyro.{x,y,z} para detectar el eje
  // dominante y su signo. El usuario debe rotar suavemente en el sentido
  // indicado durante la captura (≈ 45° en 3 s = 15°/s, bien por arriba del
  // ruido y bien debajo del FS de cualquier driver).
  const CAPTURE_MS = 3000;
  const TICK_MS = 16;

  let capturing = $state(false);
  let captureProgress = $state(0); // 0..1
  let integralX = $state(0);
  let integralY = $state(0);
  let integralZ = $state(0);
  let captureTimer: ReturnType<typeof setInterval> | null = null;
  let captureStart = 0;
  let lastTickMs = 0;

  // Resultados deducidos por cada test.
  let yawResult = $state<AxisMap | null>(null);
  let pitchResult = $state<AxisMap | null>(null);

  function pickDominant(ix: number, iy: number, iz: number): AxisMap {
    const arr: { axis: Axis; val: number }[] = [
      { axis: 'x', val: ix },
      { axis: 'y', val: iy },
      { axis: 'z', val: iz },
    ];
    arr.sort((a, b) => Math.abs(b.val) - Math.abs(a.val));
    const top = arr[0];
    return { axis: top.axis, sign: top.val >= 0 ? 1 : -1 };
  }

  function startCapture(target: 'yaw' | 'pitch') {
    integralX = 0; integralY = 0; integralZ = 0;
    captureProgress = 0;
    capturing = true;
    captureStart = performance.now();
    lastTickMs = captureStart;
    if (captureTimer) clearInterval(captureTimer);
    captureTimer = setInterval(() => {
      const now = performance.now();
      const dt = (now - lastTickMs) / 1000;
      lastTickMs = now;
      // Integral en grados (gyro está en °/s).
      integralX += serial.gyro.x * dt;
      integralY += serial.gyro.y * dt;
      integralZ += serial.gyro.z * dt;
      const elapsed = now - captureStart;
      captureProgress = Math.min(1, elapsed / CAPTURE_MS);
      if (elapsed >= CAPTURE_MS) {
        clearInterval(captureTimer!);
        captureTimer = null;
        capturing = false;
        const result = pickDominant(integralX, integralY, integralZ);
        if (target === 'yaw') yawResult = result;
        else pitchResult = result;
      }
    }, TICK_MS);
  }

  function cancelCapture() {
    if (captureTimer) clearInterval(captureTimer);
    captureTimer = null;
    capturing = false;
    captureProgress = 0;
  }

  function retry(target: 'yaw' | 'pitch') {
    if (target === 'yaw') yawResult = null;
    else pitchResult = null;
  }

  // Roll = eje restante (el no usado por yaw ni pitch). Signo + por default;
  // si el determinante del frame queda invertido, el usuario puede flippear
  // manualmente desde HeadLiveView.
  function computeRoll(yaw: AxisMap, pitch: AxisMap): AxisMap {
    const used = new Set<Axis>([yaw.axis, pitch.axis]);
    const all: Axis[] = ['x', 'y', 'z'];
    const remaining = all.find((a) => !used.has(a)) ?? 'z';
    return { axis: remaining, sign: 1 };
  }

  let proposed = $derived.by<AxesConfig | null>(() => {
    if (!yawResult || !pitchResult) return null;
    // Si el usuario eligió el mismo eje para yaw y pitch, no es válido.
    if (yawResult.axis === pitchResult.axis) return null;
    return {
      pose: serial.axes.pose,  // identidad por default; no lo tocamos.
      gyro: {
        yaw: yawResult,
        pitch: pitchResult,
        roll: computeRoll(yawResult, pitchResult),
      },
    };
  });

  let invalid = $derived(yawResult && pitchResult && yawResult.axis === pitchResult.axis);

  // Live preview en step "review": aplica el mapping propuesto sobre gyro
  // crudo para que el usuario verifique que al rotar la cabeza el indicador
  // correcto se mueve.
  function applyMap(m: AxisMap): number {
    return serial.gyro[m.axis] * m.sign;
  }
  let liveYaw = $derived(proposed ? applyMap(proposed.gyro.yaw) : 0);
  let livePitch = $derived(proposed ? applyMap(proposed.gyro.pitch) : 0);
  let liveRoll = $derived(proposed ? applyMap(proposed.gyro.roll) : 0);

  async function save() {
    if (!proposed) return;
    await serial.writeAxesToFirmware(proposed);
    close();
  }

  function close() {
    cancelCapture();
    step = 'intro';
    yawResult = null;
    pitchResult = null;
    onClose();
  }

  // Atajo: Esc cierra
  function onKey(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  }

  // Etiqueta humana del mapeo (ej. "sensor Z+").
  function label(m: AxisMap | null): string {
    if (!m) return '—';
    return `sensor ${m.axis.toUpperCase()}${m.sign === 1 ? '+' : '−'}`;
  }
</script>

<svelte:window on:keydown={onKey} />

{#if open}
  <div class="backdrop" role="dialog" aria-modal="true" aria-label="Asistente de ejes">
    <div class="modal">
      <header>
        <h2>Asistente de ejes</h2>
        <button class="x" type="button" onclick={close} aria-label="Cerrar">✕</button>
      </header>

      <div class="stepper" aria-hidden="true">
        <span class:active={step === 'intro'}>1 · Inicio</span>
        <span class:active={step === 'yaw'} class:done={yawResult !== null}>2 · Yaw</span>
        <span class:active={step === 'pitch'} class:done={pitchResult !== null}>3 · Pitch</span>
        <span class:active={step === 'review'}>4 · Revisar</span>
      </div>

      <div class="body">
        {#if step === 'intro'}
          <p>
            Este wizard configura el mapeo entre los ejes del sensor (X/Y/Z físicos del chip)
            y los DOF de cabeza (<strong>yaw / pitch / roll</strong> del paciente).
          </p>
          <p>
            Vas a hacer dos rotaciones de la cabeza con la gafa puesta. El wizard mide la
            velocidad angular y deduce automáticamente qué eje del sensor mapea a cada DOF.
          </p>
          {#if !serial.connected}
            <p class="warn">⚠ El SimHIT no está conectado. Conectalo antes de continuar.</p>
          {:else if !serial.firmwareVersionString}
            <p class="warn">⚠ Esperando boot del firmware…</p>
          {/if}
          <div class="hint">
            Tip: hacé los giros suaves y completos (≈ 45° en 3 s). Velocidad y precisión
            angular no importan — el wizard solo mira qué eje se movió más y en qué sentido.
          </div>
        {/if}

        {#if step === 'yaw'}
          <h3>Rotación en yaw (mirar a la derecha)</h3>
          <p>
            Con la gafa puesta y la cabeza inicialmente al frente, presioná <strong>Iniciar</strong> y
            <strong>girá la cabeza hacia la derecha</strong> ≈ 45° durante los 3 segundos de captura.
          </p>
          <div class="capture-box">
            {#if !capturing && !yawResult}
              <button class="primary" type="button" onclick={() => startCapture('yaw')}>
                Iniciar captura
              </button>
            {:else if capturing}
              <div class="progress">
                <div class="progress-fill" style:width="{captureProgress * 100}%"></div>
              </div>
              <span class="muted">Capturando… {(captureProgress * 100).toFixed(0)}%</span>
            {:else if yawResult}
              <div class="result">
                <span class="result-tag">Eje detectado: <strong>{label(yawResult)}</strong></span>
                <span class="muted small">∫ωx={integralX.toFixed(1)}°, ∫ωy={integralY.toFixed(1)}°, ∫ωz={integralZ.toFixed(1)}°</span>
                <button type="button" onclick={() => retry('yaw')}>Reintentar</button>
              </div>
            {/if}
          </div>
        {/if}

        {#if step === 'pitch'}
          <h3>Rotación en pitch (inclinar hacia adelante)</h3>
          <p>
            Volvé a posición neutra. Al iniciar, <strong>inclinás la cabeza hacia adelante</strong> ≈ 45°
            durante los 3 segundos.
          </p>
          <div class="capture-box">
            {#if !capturing && !pitchResult}
              <button class="primary" type="button" onclick={() => startCapture('pitch')}>
                Iniciar captura
              </button>
            {:else if capturing}
              <div class="progress">
                <div class="progress-fill" style:width="{captureProgress * 100}%"></div>
              </div>
              <span class="muted">Capturando… {(captureProgress * 100).toFixed(0)}%</span>
            {:else if pitchResult}
              <div class="result">
                <span class="result-tag">Eje detectado: <strong>{label(pitchResult)}</strong></span>
                <span class="muted small">∫ωx={integralX.toFixed(1)}°, ∫ωy={integralY.toFixed(1)}°, ∫ωz={integralZ.toFixed(1)}°</span>
                <button type="button" onclick={() => retry('pitch')}>Reintentar</button>
              </div>
            {/if}
          </div>
        {/if}

        {#if step === 'review'}
          <h3>Revisar mapeo</h3>
          {#if invalid}
            <p class="warn">
              ⚠ Yaw y pitch eligieron el mismo eje ({yawResult?.axis.toUpperCase()}).
              Probablemente la cabeza se movió en una sola dirección. Reiniciá el wizard.
            </p>
          {:else if proposed}
            <div class="mapping-grid">
              <div class="mapping-row">
                <span class="dof">Yaw</span><span class="arrow">→</span><span class="sensor">{label(proposed.gyro.yaw)}</span>
                <span class="live" class:hot={Math.abs(liveYaw) > 30}>{liveYaw.toFixed(0)} °/s</span>
              </div>
              <div class="mapping-row">
                <span class="dof">Pitch</span><span class="arrow">→</span><span class="sensor">{label(proposed.gyro.pitch)}</span>
                <span class="live" class:hot={Math.abs(livePitch) > 30}>{livePitch.toFixed(0)} °/s</span>
              </div>
              <div class="mapping-row">
                <span class="dof">Roll</span><span class="arrow">→</span><span class="sensor">{label(proposed.gyro.roll)} <em>(restante)</em></span>
                <span class="live" class:hot={Math.abs(liveRoll) > 30}>{liveRoll.toFixed(0)} °/s</span>
              </div>
            </div>

            <!-- Visualización isométrica simple: 3 ejes del frame del paciente
                 etiquetados con el eje del sensor que mapean. Sin librería 3D. -->
            <svg class="iso" viewBox="-110 -90 220 170" aria-label="Frame del paciente">
              <!-- Eje Y vertical (yaw): hacia arriba -->
              <line x1="0" y1="0" x2="0" y2="-70" stroke="#22c55e" stroke-width="2.5" />
              <polygon points="0,-78 -5,-66 5,-66" fill="#22c55e" />
              <text x="6" y="-60" fill="#22c55e" font-size="11">yaw ({label(proposed.gyro.yaw)})</text>
              <!-- Eje X (pitch): a la derecha, proyección isométrica -->
              <line x1="0" y1="0" x2="65" y2="33" stroke="#ef4444" stroke-width="2.5" />
              <polygon points="73,37 60,40 63,28" fill="#ef4444" />
              <text x="35" y="55" fill="#ef4444" font-size="11">pitch ({label(proposed.gyro.pitch)})</text>
              <!-- Eje Z (roll): hacia adelante (abajo-izq en iso) -->
              <line x1="0" y1="0" x2="-65" y2="33" stroke="#3b82f6" stroke-width="2.5" />
              <polygon points="-73,37 -60,40 -63,28" fill="#3b82f6" />
              <text x="-100" y="55" fill="#3b82f6" font-size="11">roll ({label(proposed.gyro.roll)})</text>
              <!-- Origen -->
              <circle cx="0" cy="0" r="3" fill="#94a3b8" />
            </svg>

            <p class="hint">
              Movete suavemente con la gafa puesta y verificá que el valor en vivo del DOF correcto crezca.
              Si algo está al revés, repetí el paso correspondiente.
            </p>
          {/if}
        {/if}
      </div>

      <footer>
        {#if step === 'intro'}
          <button type="button" onclick={close}>Cancelar</button>
          <button class="primary" type="button" onclick={() => (step = 'yaw')} disabled={!serial.connected}>
            Empezar
          </button>
        {:else if step === 'yaw'}
          <button type="button" onclick={() => (step = 'intro')}>Atrás</button>
          <button class="primary" type="button" onclick={() => (step = 'pitch')} disabled={!yawResult || capturing}>
            Siguiente
          </button>
        {:else if step === 'pitch'}
          <button type="button" onclick={() => (step = 'yaw')}>Atrás</button>
          <button class="primary" type="button" onclick={() => (step = 'review')} disabled={!pitchResult || capturing}>
            Siguiente
          </button>
        {:else if step === 'review'}
          <button type="button" onclick={() => (step = 'pitch')}>Atrás</button>
          <button class="primary" type="button" onclick={save} disabled={!proposed || !!invalid}>
            Guardar y aplicar
          </button>
        {/if}
      </footer>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.55);
    display: flex; align-items: center; justify-content: center;
    z-index: 200;
  }
  .modal {
    background: var(--surface-1, #1a1f2e);
    color: var(--text, #e2e8f0);
    border: 1px solid var(--border, #334155);
    border-radius: 8px;
    width: min(560px, 92vw);
    max-height: 92vh;
    overflow-y: auto;
    display: flex; flex-direction: column;
  }
  header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border, #334155);
  }
  header h2 { margin: 0; font-size: 16px; }
  .x {
    background: transparent; border: none; color: inherit;
    font-size: 18px; cursor: pointer; padding: 4px 8px;
  }
  .stepper {
    display: flex; gap: 8px; padding: 10px 16px;
    border-bottom: 1px solid var(--border, #334155);
    font-size: 12px; color: var(--muted, #94a3b8);
  }
  .stepper span { padding: 2px 8px; border-radius: 4px; background: var(--surface-2, #0f1623); }
  .stepper .active { color: var(--text, #e2e8f0); background: var(--surface-3, #243047); }
  .stepper .done { color: #22c55e; }
  .body { padding: 16px; min-height: 280px; }
  .body p { margin: 6px 0 10px; line-height: 1.5; }
  .body h3 { margin: 0 0 8px; font-size: 14px; }
  .warn { color: #facc15; }
  .hint { color: var(--muted, #94a3b8); font-size: 12px; margin-top: 10px; }
  .capture-box {
    display: flex; flex-direction: column; align-items: stretch; gap: 10px;
    padding: 14px; border: 1px dashed var(--border, #334155); border-radius: 6px;
    margin-top: 8px;
  }
  .progress {
    height: 12px; background: var(--surface-2, #0f1623);
    border-radius: 6px; overflow: hidden;
  }
  .progress-fill { height: 100%; background: #22c55e; transition: width 80ms linear; }
  .result { display: flex; flex-direction: column; gap: 6px; }
  .result-tag { font-size: 14px; }
  .muted { color: var(--muted, #94a3b8); }
  .small { font-size: 11px; }
  button {
    background: var(--surface-2, #0f1623); color: inherit;
    border: 1px solid var(--border, #334155); border-radius: 4px;
    padding: 6px 14px; cursor: pointer; font-size: 13px;
  }
  button:hover:not(:disabled) { background: var(--surface-3, #243047); }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  button.primary {
    background: #2563eb; border-color: #2563eb; color: white;
  }
  button.primary:hover:not(:disabled) { background: #1d4ed8; }
  footer {
    display: flex; justify-content: flex-end; gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid var(--border, #334155);
  }
  .mapping-grid { display: flex; flex-direction: column; gap: 6px; margin: 10px 0; }
  .mapping-row {
    display: grid; grid-template-columns: 60px 20px 1fr auto; align-items: center;
    gap: 8px; padding: 6px 10px; background: var(--surface-2, #0f1623); border-radius: 4px;
  }
  .mapping-row .dof { font-weight: 600; }
  .mapping-row .arrow { color: var(--muted, #94a3b8); }
  .mapping-row .sensor { font-family: ui-monospace, monospace; font-size: 12px; }
  .mapping-row .sensor em { color: var(--muted, #94a3b8); font-style: normal; font-size: 11px; }
  .live { font-variant-numeric: tabular-nums; color: var(--muted, #94a3b8); font-size: 12px; }
  .live.hot { color: #22c55e; font-weight: 600; }
  .iso { width: 100%; height: 170px; display: block; margin: 8px 0; }
</style>
