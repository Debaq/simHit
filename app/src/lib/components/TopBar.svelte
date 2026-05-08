<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { sim } from '$lib/simulator.svelte';
  import { serial } from '$lib/serial.svelte';
  import { bundles } from '$lib/bundle.svelte';
  import { getCurrentWindow } from '@tauri-apps/api/window';

  const appWindow = getCurrentWindow();
  let isMaximized = $state(false);

  async function refreshMaxState() {
    try { isMaximized = await appWindow.isMaximized(); } catch { /* no tauri */ }
  }
  onMount(() => {
    refreshMaxState();
    const un = appWindow.onResized(() => refreshMaxState());
    return () => { un.then((f) => f()); };
  });

  const winMin = () => appWindow.minimize();
  const winMax = () => appWindow.toggleMaximize();
  const winClose = () => appWindow.close();

  function onHeaderMouseDown(e: MouseEvent) {
    if (e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (t.closest('button, a, select, input, textarea, .winctrls, .brand')) return;
    e.preventDefault();
    appWindow.startDragging();
  }
  function onHeaderDblClick(e: MouseEvent) {
    const t = e.target as HTMLElement;
    if (t.closest('button, a, select, input, textarea, .winctrls, .brand')) return;
    appWindow.toggleMaximize();
  }

  let path = $derived(page.url?.pathname ?? '/');
  let selectedPort = $state<string>('');
  let calModal = $state<'closed' | 'instructions' | 'running' | 'done' | 'error'>('closed');
  let calError = $state<string>('');
  let magModal = $state<'closed' | 'instructions' | 'running' | 'done' | 'error'>('closed');
  let magError = $state<string>('');
  let magProgress = $state<{ sec: number; oct: number; n: number }>({ sec: 0, oct: 0, n: 0 });

  onMount(() => {
    serial.listPorts();
  });

  async function refreshPorts() {
    await serial.listPorts();
    if (!selectedPort && serial.ports.length) selectedPort = serial.ports[0];
  }

  async function toggleSerial() {
    if (serial.connected) {
      await serial.disconnect();
    } else if (selectedPort) {
      await serial.connect(selectedPort);
      if (serial.connected) sim.cameraOn = true; // hardware real -> cámara on
    }
  }

  function toggleCamera() {
    sim.cameraOn = !sim.cameraOn;
  }

  function openCalibration() {
    if (!serial.connected) return;
    calError = '';
    calModal = 'instructions';
  }

  async function runCalibration() {
    calModal = 'running';
    calError = '';
    serial.lastCalLine = '';
    await serial.sendCommand('IMU CAL');

    // Esperar respuesta del firmware: "IMU CAL done ..." o "IMU CAL fail ...".
    const t0 = Date.now();
    while (Date.now() - t0 < 4000) {
      await new Promise((r) => setTimeout(r, 50));
      const ll = serial.lastCalLine;
      if (ll.startsWith('IMU CAL done')) {
        calModal = 'done';
        setTimeout(() => { if (calModal === 'done') calModal = 'closed'; }, 1400);
        return;
      }
      if (ll.startsWith('IMU CAL fail')) {
        const m = ll.match(/sd=([\d.,-]+)/);
        calError = m
          ? `Se detectó movimiento durante la calibración (σ=${m[1]} °/s). Mantener el sensor inmóvil y reintentar.`
          : 'La calibración falló. Mantener el sensor inmóvil y reintentar.';
        calModal = 'error';
        return;
      }
    }
    calError = 'Sin respuesta del firmware. Verificar la conexión.';
    calModal = 'error';
  }

  function cancelCalibration() {
    if (calModal === 'running') return; // no interrumpir mientras corre
    calModal = 'closed';
  }

  function openMagCal() {
    if (!serial.connected) return;
    magError = '';
    magProgress = { sec: 0, oct: 0, n: 0 };
    magModal = 'instructions';
  }

  async function runMagCal() {
    magModal = 'running';
    magError = '';
    serial.lastCalLine = '';
    serial.magCalLog = [];
    magProgress = { sec: 0, oct: 0, n: 0 };
    await serial.sendCommand('MAG CAL');

    // Firmware emite progreso cada segundo "MAG CAL Ns oct=X/8 n=Y" hasta done/fail.
    // Timeout: MAG_MAX_MS (firmware) ≈ 30s + margen.
    const t0 = Date.now();
    while (Date.now() - t0 < 60000) {
      await new Promise((r) => setTimeout(r, 80));
      const ll = serial.lastCalLine;
      if (!ll) continue;
      // Progreso intermedio
      const prog = ll.match(/^MAG CAL\s+(\d+)s\s+oct=(\d+)\/8\s+n=(\d+)/);
      if (prog) {
        magProgress = { sec: +prog[1], oct: +prog[2], n: +prog[3] };
        continue;
      }
      if (ll.startsWith('MAG CAL done')) {
        magModal = 'done';
        setTimeout(() => { if (magModal === 'done') magModal = 'closed'; }, 1500);
        return;
      }
      if (ll.startsWith('MAG CAL fail') || ll.startsWith('MAG CAL abort')) {
        magError = ll.replace(/^MAG CAL\s+(fail|abort)\s*-?\s*/, '') || 'Calibración fallida.';
        magModal = 'error';
        return;
      }
    }
    magError = 'Sin respuesta del firmware. Verificar la conexión.';
    magModal = 'error';
  }

  async function copyMagLog() {
    try {
      await navigator.clipboard.writeText(serial.magCalLog.join('\n'));
    } catch { /* ignore */ }
  }

  function downloadMagLog() {
    const blob = new Blob([serial.magCalLog.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `magcal_${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  function cancelMagCal() {
    if (magModal === 'running') {
      // Mandar cualquier línea aborta el procedimiento en firmware.
      serial.sendCommand('STOP');
      return;
    }
    magModal = 'closed';
  }

  function onModalKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && (calModal === 'instructions' || calModal === 'error')) {
      calModal = 'closed';
    }
  }
</script>

<header
  class="topbar"
  data-tauri-drag-region
  onmousedown={onHeaderMouseDown}
  ondblclick={onHeaderDblClick}
>
  <div
    class="brand"
    role="button"
    tabindex="0"
    aria-label="SimHIT inicio"
    onclick={() => goto('/')}
    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goto('/'); } }}
  >
    <img src="/brand/logo-sm.png" alt="" class="logo" />
    <div>
      <div class="title">SimHIT</div>
      <div class="subtitle">Pruebas vHIT</div>
    </div>
  </div>

  <nav class="nav" data-tauri-drag-region>
    <a href="/" class:active={path === '/'}>Pruebas</a>
    <a href="/informe" class:active={path?.startsWith('/informe')}>Informes</a>
    <a href="/docente" class:active={path === '/docente'}>Modo docente</a>
  </nav>

  <div class="status">
    {#if bundles.active}
      <button
        class="bundle-chip"
        onclick={() => goto('/docente')}
        title="Escenario activo — clic para abrir Modo docente"
      >
        <span class="ic" aria-hidden="true">🎓</span>
        <span class="lab">Escenario</span>
        <b>{bundles.active.name}</b>
      </button>
    {/if}

    <button
      class="cam"
      class:on={sim.cameraOn}
      onclick={toggleCamera}
      title="Encender/apagar cámara del paciente"
    >
      <span class="ic">📷</span>
      Cámara <b>{sim.cameraOn ? 'ON' : 'OFF'}</b>
    </button>

    <div class="serial">
      <select bind:value={selectedPort} disabled={serial.connected || serial.ports.length === 0} title="Puerto serie">
        {#if serial.ports.length === 0}
          <option value="">— sin puertos —</option>
        {:else}
          {#each serial.ports as p}
            <option value={p}>{p}</option>
          {/each}
        {/if}
      </select>
      <button class="icon-btn" onclick={refreshPorts} title="Actualizar puertos" disabled={serial.connected}>↻</button>
      <button
        class="primary"
        onclick={toggleSerial}
        disabled={serial.connecting || (!serial.connected && !selectedPort)}
      >
        {#if serial.connecting}
          conectando…
        {:else if serial.connected}
          ■ SimHIT
        {:else}
          ▶ SimHIT
        {/if}
      </button>
      <button
        class="cal"
        onclick={openCalibration}
        disabled={!serial.connected || calModal !== 'closed'}
        title="Calibrar bias del giroscopio y orientación de referencia"
      >
        Calibrar
      </button>
      <button
        class="cal"
        onclick={openMagCal}
        disabled={!serial.connected || magModal !== 'closed'}
        title="Calibrar magnetómetro (figura-8). Reduce drift de yaw."
      >
        Mag
      </button>
      <span class="led" class:on={serial.connected} title={serial.lastError ?? ''}></span>
    </div>

    <div class="winctrls">
      <button class="wc" onclick={winMin} title="Minimizar" aria-label="Minimizar">
        <svg viewBox="0 0 12 12" width="12" height="12"><line x1="2" y1="6" x2="10" y2="6" stroke="currentColor" stroke-width="1.2"/></svg>
      </button>
      <button class="wc" onclick={winMax} title={isMaximized ? 'Restaurar' : 'Maximizar'} aria-label="Maximizar">
        {#if isMaximized}
          <svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.2">
            <rect x="3" y="2" width="7" height="7"/>
            <rect x="2" y="3" width="7" height="7" fill="var(--surface)"/>
          </svg>
        {:else}
          <svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.2">
            <rect x="2" y="2" width="8" height="8"/>
          </svg>
        {/if}
      </button>
      <button class="wc wc-close" onclick={winClose} title="Cerrar" aria-label="Cerrar">
        <svg viewBox="0 0 12 12" width="12" height="12"><path d="M2 2 L10 10 M10 2 L2 10" stroke="currentColor" stroke-width="1.2"/></svg>
      </button>
    </div>
  </div>
</header>

<svelte:window onkeydown={onModalKeydown} />

{#if calModal !== 'closed'}
  <div
    class="cal-overlay"
    role="dialog"
    aria-modal="true"
    aria-labelledby="cal-title"
  >
    <div class="cal-modal" role="document">
      {#if calModal === 'instructions'}
        <h3 id="cal-title">Calibración del sensor</h3>
        <p class="lead">Antes de comenzar el examen es necesario fijar la referencia del giroscopio.</p>

        <ol class="steps">
          <li>
            <span class="step-num">1</span>
            <div>
              <b>Apoyar la herramienta sobre una superficie estable</b>
              <small>O mantenerla inmóvil entre las manos.</small>
            </div>
          </li>
          <li>
            <span class="step-num">2</span>
            <div>
              <b>Posición neutra del paciente</b>
              <small>Si ya está colocada en la cabeza, mantener la mirada al frente sin moverse.</small>
            </div>
          </li>
          <li>
            <span class="step-num">3</span>
            <div>
              <b>No tocar ni mover durante 1 segundo</b>
              <small>El firmware promedia el ruido y fija el cero de orientación.</small>
            </div>
          </li>
        </ol>

        <div class="actions">
          <button class="btn-secondary" onclick={cancelCalibration}>Cancelar</button>
          <button class="btn-primary" onclick={runCalibration}>Iniciar calibración</button>
        </div>
      {:else if calModal === 'running'}
        <h3 id="cal-title">Calibrando…</h3>
        <p class="lead big">No mover el sensor.</p>
        <div class="spinner" aria-hidden="true"></div>
        <p class="hint">Promediando bias del giroscopio y reseteando orientación.</p>
      {:else if calModal === 'done'}
        <h3 id="cal-title">Calibración completa</h3>
        <div class="check" aria-hidden="true">✓</div>
        <p class="hint">Listo para iniciar el examen.</p>
      {:else if calModal === 'error'}
        <h3 id="cal-title">Calibración fallida</h3>
        <div class="cross" aria-hidden="true">!</div>
        <p class="err-msg">{calError}</p>
        <div class="actions">
          <button class="btn-secondary" onclick={cancelCalibration}>Cerrar</button>
          <button class="btn-primary" onclick={runCalibration}>Reintentar</button>
        </div>
      {/if}
    </div>
  </div>
{/if}

{#if magModal !== 'closed'}
  <div class="cal-overlay" role="dialog" aria-modal="true" aria-labelledby="mag-title">
    <div class="cal-modal" role="document">
      {#if magModal === 'instructions'}
        <h3 id="mag-title">Calibración del magnetómetro</h3>
        <p class="lead">Necesario para estabilizar el yaw (rotación horizontal). Sin esta calibración el yaw deriva continuamente.</p>
        <ol class="steps">
          <li>
            <span class="step-num">1</span>
            <div>
              <b>Alejarse de metales y electrónica</b>
              <small>Imanes, parlantes, monitores y notebooks distorsionan el campo magnético.</small>
            </div>
          </li>
          <li>
            <span class="step-num">2</span>
            <div>
              <b>Hacer figura-8 con el sensor</b>
              <small>Movimientos amplios cubriendo las 3 orientaciones del espacio (8 octantes).</small>
            </div>
          </li>
          <li>
            <span class="step-num">3</span>
            <div>
              <b>Continuar hasta completar 8/8 octantes</b>
              <small>Mínimo ~10 s, máximo ~30 s. Se cancela mandando cualquier línea.</small>
            </div>
          </li>
        </ol>
        <div class="actions">
          <button class="btn-secondary" onclick={cancelMagCal}>Cancelar</button>
          <button class="btn-primary" onclick={runMagCal}>Iniciar calibración</button>
        </div>
      {:else if magModal === 'running'}
        <h3 id="mag-title">Calibrando magnetómetro…</h3>
        <p class="lead">Hacer la figura-8 mientras vas <b>rotando la muñeca</b> entre cada repetición, así el sensor pasa por todas las orientaciones del espacio.</p>

        <div class="mag-guide">
          <!-- Animación figura-8 (movimiento de la mano) -->
          <div class="guide-col">
            <div class="guide-lab">Movimiento</div>
            <svg viewBox="0 0 140 100" class="fig8">
              <path d="M 30 50 C 30 20, 70 20, 70 50 S 110 80, 110 50 S 70 20, 70 50 S 30 80, 30 50 Z"
                    fill="none" stroke="var(--border)" stroke-width="2" stroke-dasharray="3 3" />
              <circle r="5" fill="var(--accent, #2563eb)">
                <animateMotion dur="3s" repeatCount="indefinite"
                  path="M 30 50 C 30 20, 70 20, 70 50 S 110 80, 110 50 S 70 20, 70 50 S 30 80, 30 50 Z" />
              </circle>
              <text x="70" y="95" text-anchor="middle" font-size="9" fill="var(--text-muted)">figura-8 amplia</text>
            </svg>
          </div>

          <!-- Cubo con 8 esquinas — recordatorio de las 8 orientaciones a cubrir -->
          <div class="guide-col">
            <div class="guide-lab">Orientaciones (8)</div>
            <svg viewBox="-60 -50 120 100" class="cube">
              <!-- caras del cubo isométrico -->
              <g stroke="var(--border-strong)" stroke-width="1.2" fill="none">
                <path d="M -30 -20 L 30 -20 L 30 30 L -30 30 Z" />
                <path d="M -30 -20 L -10 -35 L 50 -35 L 30 -20" />
                <path d="M 30 -20 L 50 -35 L 50 15 L 30 30" />
                <path d="M -30 30 L -10 15 L 50 15" stroke-dasharray="2 2" opacity=".5" />
                <path d="M -10 -35 L -10 15" stroke-dasharray="2 2" opacity=".5" />
              </g>
              <!-- 8 esquinas -->
              {#each [
                {x:-30,y:-20},{x:30,y:-20},{x:30,y:30},{x:-30,y:30},
                {x:-10,y:-35},{x:50,y:-35},{x:50,y:15},{x:-10,y:15}
              ] as p, i}
                <circle cx={p.x} cy={p.y} r="4"
                        fill={i < magProgress.oct ? 'var(--success)' : 'var(--surface-2)'}
                        stroke="var(--border-strong)" stroke-width="1" />
              {/each}
              <text x="0" y="46" text-anchor="middle" font-size="9" fill="var(--text-muted)">cubrí cada esquina</text>
            </svg>
          </div>
        </div>

        <div class="mag-poses">
          <div class="mag-poses-title">Hacer figura-8 en <b>cada</b> de estas 4 poses:</div>
          <div class="mag-poses-grid">
            <div class="pose">
              <svg viewBox="-30 -30 60 60"><rect x="-20" y="-12" width="40" height="24" rx="3" fill="var(--surface)" stroke="var(--head-color)" stroke-width="2"/><circle cx="-10" cy="0" r="2" fill="var(--accent)"/></svg>
              <div><b>1.</b> Logo arriba (normal)</div>
            </div>
            <div class="pose">
              <svg viewBox="-30 -30 60 60"><g transform="rotate(180)"><rect x="-20" y="-12" width="40" height="24" rx="3" fill="var(--surface)" stroke="var(--head-color)" stroke-width="2"/><circle cx="-10" cy="0" r="2" fill="var(--accent)"/></g></svg>
              <div><b>2.</b> Logo abajo (invertido)</div>
            </div>
            <div class="pose">
              <svg viewBox="-30 -30 60 60"><g transform="rotate(90)"><rect x="-20" y="-12" width="40" height="24" rx="3" fill="var(--surface)" stroke="var(--head-color)" stroke-width="2"/><circle cx="-10" cy="0" r="2" fill="var(--accent)"/></g></svg>
              <div><b>3.</b> De canto (lado izq.)</div>
            </div>
            <div class="pose">
              <svg viewBox="-30 -30 60 60"><g transform="rotate(-90)"><rect x="-20" y="-12" width="40" height="24" rx="3" fill="var(--surface)" stroke="var(--head-color)" stroke-width="2"/><circle cx="-10" cy="0" r="2" fill="var(--accent)"/></g></svg>
              <div><b>4.</b> De canto (lado der.)</div>
            </div>
          </div>
          <div class="mag-poses-note">No sueltes el botón. Después de cada figura-8 girá el sensor a la siguiente pose y seguí. Sin pausas largas — el firmware corta a los 30 s.</div>
        </div>

        <div class="mag-progress">
          <div class="mag-stat"><span>Tiempo</span><b>{magProgress.sec}s</b></div>
          <div class="mag-stat"><span>Esquinas</span><b>{magProgress.oct}/8</b></div>
          <div class="mag-stat"><span>Muestras</span><b>{magProgress.n}</b></div>
        </div>
        <div class="mag-bar"><div class="mag-bar-fill" style:width="{(magProgress.oct / 8) * 100}%"></div></div>

        <details class="mag-log-wrap" open>
          <summary>Log en vivo ({serial.magCalLog.length} líneas)</summary>
          <pre class="mag-log">{serial.magCalLog.slice(-12).join('\n') || '— sin líneas aún —'}</pre>
        </details>

        <div class="actions">
          <button class="btn-secondary" onclick={cancelMagCal}>Abortar</button>
        </div>
      {:else if magModal === 'done'}
        <h3 id="mag-title">Magnetómetro calibrado</h3>
        <div class="check" aria-hidden="true">✓</div>
        <p class="hint">Yaw ahora debería estabilizarse.</p>
      {:else if magModal === 'error'}
        <h3 id="mag-title">Calibración fallida</h3>
        <div class="cross" aria-hidden="true">!</div>
        <p class="err-msg">{magError}</p>

        <details class="mag-log-wrap" open>
          <summary>Log completo ({serial.magCalLog.length} líneas)</summary>
          <pre class="mag-log mag-log-tall">{serial.magCalLog.join('\n') || '— vacío —'}</pre>
          <div class="log-actions">
            <button type="button" onclick={copyMagLog}>Copiar</button>
            <button type="button" onclick={downloadMagLog}>Descargar .log</button>
          </div>
        </details>

        <div class="actions">
          <button class="btn-secondary" onclick={cancelMagCal}>Cerrar</button>
          <button class="btn-primary" onclick={runMagCal}>Reintentar</button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .topbar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 50;
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 24px;
    padding: 10px 16px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    box-shadow: var(--shadow-sm);
    /* altura referencia ~58px usada por padding-top de las páginas */
  }
  .brand {
    display: flex; align-items: center; gap: 10px;
    text-decoration: none; color: inherit;
    padding: 4px 8px; border-radius: var(--radius-sm);
    transition: background .15s;
  }
  .brand { cursor: pointer; user-select: none; }
  .brand:hover { background: var(--primary-soft); }
  .logo { width: 36px; height: 36px; object-fit: contain; }
  .title { font-weight: 700; font-size: 16px; line-height: 1; letter-spacing: .04em; }
  .subtitle { font-size: 11px; color: var(--text-muted); }

  .nav { display: flex; gap: 4px; justify-content: center; }
  .nav a {
    text-decoration: none;
    padding: 6px 14px;
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    font-size: 13px;
    font-weight: 500;
    transition: background .15s, color .15s;
  }
  .nav a:hover { background: var(--primary-soft); color: var(--primary); }
  .nav a.active { background: var(--primary); color: white; }

  .status { display: flex; align-items: center; gap: 12px; flex-wrap: nowrap; white-space: nowrap; min-width: 0; }
  .nav { min-width: 0; }
  .serial { flex-wrap: nowrap; }
  .bundle-chip {
    display: inline-flex; align-items: center; gap: 6px;
    border: 1px solid var(--border-strong);
    background: var(--primary-soft);
    color: var(--primary);
    padding: 4px 10px;
    border-radius: 999px;
    font-size: 12px;
    cursor: pointer;
    max-width: 240px;
    transition: background .15s, border-color .15s;
  }
  .bundle-chip:hover { background: var(--primary); color: white; border-color: var(--primary); }
  .bundle-chip .ic { font-size: 12px; }
  .bundle-chip .lab {
    font-size: 10px; text-transform: uppercase; letter-spacing: .04em;
    color: inherit; opacity: .8;
  }
  .bundle-chip b {
    font-weight: 600;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    max-width: 160px;
  }

  .cam {
    display: inline-flex; align-items: center; gap: 8px;
    border: 1px solid var(--border-strong);
    background: var(--surface);
    color: var(--text-muted);
    padding: 6px 12px;
    border-radius: var(--radius-sm);
    font-size: 12px;
    transition: all .15s;
  }
  .cam .ic { filter: grayscale(1) opacity(.5); }
  .cam.on {
    background: var(--success);
    color: white; border-color: var(--success);
    box-shadow: 0 0 0 3px rgba(22,163,74,.15);
  }
  .cam.on .ic { filter: none; }
  .cam:hover { background: var(--primary-soft); }
  .cam.on:hover { background: var(--success); opacity: .9; }
  .cam b { font-weight: 700; letter-spacing: .04em; }

  .serial {
    display: inline-flex; align-items: center; gap: 6px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 4px 6px;
  }
  .serial select {
    font: inherit; font-size: 12px;
    padding: 4px 8px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font-family: ui-monospace, monospace;
    min-width: 130px;
  }
  .serial select:disabled { opacity: .6; }
  .icon-btn {
    padding: 4px 8px; font-size: 13px;
    border: 1px solid var(--border-strong); background: var(--surface);
    border-radius: var(--radius-sm); cursor: pointer;
  }
  .icon-btn:hover { background: var(--primary-soft); }
  .cal {
    padding: 4px 10px; font-size: 12px;
    border: 1px solid var(--border-strong);
    background: var(--surface);
    color: var(--text);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: all .15s;
  }
  .cal:hover:not(:disabled) { background: var(--primary-soft); color: var(--primary); }
  .cal:disabled { opacity: .45; cursor: not-allowed; }
  .led {
    width: 10px; height: 10px; border-radius: 50%;
    background: #cbd5e1; flex-shrink: 0;
  }
  .led.on {
    background: var(--success);
    box-shadow: 0 0 0 3px rgba(22,163,74,.15);
    animation: pulse 1.6s ease-in-out infinite;
  }
  @keyframes pulse { 50% { opacity: .55; } }

  .cal-overlay {
    position: fixed; inset: 0;
    background: rgba(15, 23, 42, .55);
    backdrop-filter: blur(2px);
    display: grid; place-items: center;
    z-index: 200;
    animation: fadein .15s ease-out;
  }
  .cal-modal {
    background: var(--surface);
    border-radius: var(--radius-md, 12px);
    box-shadow: 0 20px 60px rgba(0,0,0,.25);
    width: min(440px, 92vw);
    padding: 24px;
    text-align: left;
    animation: pop .18s ease-out;
  }
  .cal-modal h3 {
    margin: 0 0 8px;
    font-size: 18px;
    color: var(--text);
  }
  .cal-modal .lead {
    margin: 0 0 18px;
    color: var(--text-muted);
    font-size: 13px;
  }
  .cal-modal .lead.big { font-size: 14px; color: var(--text); font-weight: 500; text-align: center; margin: 16px 0; }
  .cal-modal .hint { color: var(--text-muted); font-size: 12px; text-align: center; margin: 8px 0 0; }
  .steps {
    list-style: none; padding: 0; margin: 0 0 20px;
    display: flex; flex-direction: column; gap: 10px;
  }
  .steps li {
    display: grid; grid-template-columns: 28px 1fr; gap: 12px;
    align-items: start;
    padding: 10px 12px;
    background: var(--surface-2);
    border-radius: var(--radius-sm);
  }
  .step-num {
    width: 24px; height: 24px;
    border-radius: 50%;
    background: var(--primary);
    color: white;
    font-size: 12px; font-weight: 700;
    display: grid; place-items: center;
  }
  .steps b { display: block; font-size: 13px; color: var(--text); }
  .steps small { display: block; color: var(--text-muted); font-size: 12px; margin-top: 2px; }

  .actions {
    display: flex; gap: 8px; justify-content: flex-end;
  }
  .btn-secondary, .btn-primary {
    padding: 8px 16px;
    border-radius: var(--radius-sm);
    font-size: 13px; font-weight: 500;
    cursor: pointer;
    transition: all .15s;
    border: 1px solid var(--border-strong);
  }
  .btn-secondary { background: var(--surface); color: var(--text-muted); }
  .btn-secondary:hover { background: var(--surface-2); color: var(--text); }
  .btn-primary { background: var(--primary); color: white; border-color: var(--primary); }
  .btn-primary:hover { opacity: .9; }

  .spinner {
    width: 48px; height: 48px;
    border: 4px solid var(--border);
    border-top-color: var(--primary);
    border-radius: 50%;
    margin: 12px auto;
    animation: spin .8s linear infinite;
  }
  .check {
    width: 56px; height: 56px;
    border-radius: 50%;
    background: var(--success);
    color: white;
    font-size: 32px; font-weight: 700;
    display: grid; place-items: center;
    margin: 12px auto;
    animation: pop .3s ease-out;
  }
  .cross {
    width: 56px; height: 56px;
    border-radius: 50%;
    background: var(--danger, #dc2626);
    color: white;
    font-size: 32px; font-weight: 700;
    display: grid; place-items: center;
    margin: 12px auto;
    animation: pop .3s ease-out;
  }
  .err-msg {
    background: var(--surface-2);
    border-left: 3px solid var(--danger, #dc2626);
    padding: 10px 12px;
    margin: 12px 0 18px;
    font-size: 13px;
    color: var(--text);
    border-radius: 4px;
  }

  .mag-guide {
    display: grid; grid-template-columns: 1fr 1fr; gap: 12px;
    margin: 8px 0 12px;
  }
  .guide-col {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px;
    display: flex; flex-direction: column; align-items: center; gap: 4px;
  }
  .guide-lab {
    font-size: 10px; text-transform: uppercase; letter-spacing: .04em;
    color: var(--text-muted); font-weight: 700;
  }
  .fig8, .cube { width: 100%; height: 110px; }
  .mag-poses {
    margin: 0 0 12px;
  }
  .mag-poses-title {
    font-size: 12px; margin-bottom: 6px; color: var(--text);
  }
  .mag-poses-grid {
    display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px;
  }
  .pose {
    background: var(--surface-2); border: 1px solid var(--border);
    border-radius: 6px; padding: 4px;
    display: flex; flex-direction: column; align-items: center;
    font-size: 11px; text-align: center;
  }
  .pose svg { width: 100%; height: 60px; }
  .pose b { color: var(--accent, #2563eb); }
  .mag-poses-note {
    font-size: 11px; color: var(--text-muted); margin-top: 6px;
    line-height: 1.4;
  }

  .mag-log-wrap {
    margin: 8px 0 12px;
    background: #0b1220; color: #e2e8f0;
    border-radius: 6px;
    border: 1px solid var(--border);
    overflow: hidden;
  }
  .mag-log-wrap summary {
    cursor: pointer; padding: 6px 10px;
    font-size: 11px; font-family: ui-monospace, monospace;
    background: rgba(255,255,255,0.04);
    color: #cbd5e1;
  }
  .mag-log {
    margin: 0; padding: 8px 10px;
    font: 10px/1.4 ui-monospace, monospace;
    max-height: 140px; overflow: auto;
    white-space: pre-wrap; word-break: break-all;
    color: #e2e8f0;
  }
  .mag-log-tall { max-height: 260px; }
  .log-actions {
    display: flex; gap: 6px; padding: 6px 10px 10px;
    border-top: 1px solid rgba(255,255,255,0.08);
  }
  .log-actions button {
    font-size: 11px; padding: 3px 10px; border-radius: 4px;
    border: 1px solid rgba(255,255,255,0.15);
    background: rgba(255,255,255,0.06); color: #e2e8f0;
    cursor: pointer;
  }
  .log-actions button:hover { background: rgba(255,255,255,0.12); }

  .mag-progress {
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;
    margin: 14px 0 10px;
  }
  .mag-stat {
    display: flex; flex-direction: column; align-items: center; gap: 2px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px;
  }
  .mag-stat span {
    font-size: 10px; color: var(--text-muted);
    text-transform: uppercase; letter-spacing: .04em;
  }
  .mag-stat b { font-size: 18px; font-family: ui-monospace, monospace; }
  .mag-bar {
    height: 8px; background: var(--surface-2); border-radius: 4px;
    overflow: hidden; margin: 6px 0 14px;
  }
  .mag-bar-fill {
    height: 100%; background: var(--accent, #2563eb);
    transition: width 200ms ease-out;
  }

  .winctrls {
    display: inline-flex; align-items: center; gap: 2px;
    margin-left: 4px;
    -webkit-app-region: no-drag;
  }
  .wc {
    width: 32px; height: 28px;
    display: grid; place-items: center;
    background: transparent;
    color: var(--text-muted);
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background .12s, color .12s;
  }
  .wc:hover { background: var(--surface-2); color: var(--text); }
  .wc-close:hover { background: #dc2626; color: white; }

  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes fadein { from { opacity: 0; } }
  @keyframes pop { from { transform: scale(.92); opacity: 0; } }
</style>
