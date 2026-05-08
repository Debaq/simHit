<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import TopBar from '$lib/components/TopBar.svelte';
  import HeadLiveView from '$lib/components/HeadLiveView.svelte';
  import TraceChart from '$lib/components/TraceChart.svelte';
  import { sim } from '$lib/simulator.svelte';
  import { scenarios } from '$lib/scenario.svelte';
  import { bundles } from '$lib/bundle.svelte';
  import { acceptance } from '$lib/acceptance.svelte';
  import { practice } from '$lib/practice.svelte';

  onMount(async () => {
    await scenarios.load();
    if (bundles.active) bundles.applyActive();
    sim.connect();
  });
  onDestroy(() => {
    practice.stop();
    sim.disconnect();
  });

  // Listener: cada vez que el sim emite un impulso, alimentar la práctica.
  $effect(() => {
    const imp = sim.lastImpulse;
    const ver = sim.lastVerdict;
    if (!imp || !ver) return;
    practice.consumeImpulse(ver, imp.side, imp.id);
  });

  let bundle = $derived(bundles.active);
  let goals = $derived(bundle?.goals ?? []);
  let goalCount = $derived(goals.reduce((a, g) => a + g.count, 0));

  let progress = $derived(practice.progress);
  let current = $derived(practice.current);
  let remaining = $derived(practice.remainingByPreset);
  let recent = $derived(practice.attempts.slice(-6).reverse());

  function levelName(id: string) {
    return acceptance.all.find((p) => p.id === id)?.name ?? id;
  }

  function startSession() {
    if (!bundle || bundle.kind === 'clinico') return;
    practice.start(bundle);
    if (sim.mode === 'idle' && scenarios.active) {
      sim.runScenario(scenarios.active);
    }
  }
  function stopSession() {
    practice.stop();
    sim.stop();
  }
  function pauseSession() {
    practice.pause();
    sim.stop();
  }
  function resumeSession() {
    practice.resume();
    if (scenarios.active) sim.runScenario(scenarios.active);
  }
  function skipGoal() { practice.skipCurrent(); }

  let showAchievements = $derived(practice.done);
  let ach = $derived.by(() => (showAchievements ? practice.computeAchievements() : null));

  function fmtMs(ms: number) {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
  }
  function pct(n: number, d: number) { return d === 0 ? 0 : Math.round((n / d) * 100); }
  function closeAchievements() {
    practice.reset();
    sim.stop();
  }
  function retrySession() {
    practice.reset();
    sim.stop();
    if (bundle && bundle.kind !== 'clinico') {
      practice.start(bundle);
      if (scenarios.active) sim.runScenario(scenarios.active);
    }
  }
</script>

<div class="app">
  <TopBar />

  {#if !bundle || bundle.kind === 'clinico'}
    <main class="layout">
      <div class="empty-state">
        <h2>Modo práctica</h2>
        <p>El escenario activo no es de práctica. Crea o activa uno desde <a href="/docente">Modo docente</a>.</p>
      </div>
    </main>
  {:else if bundle.kind === 'practica-vert'}
    <main class="layout">
      <div class="empty-state">
        <h2>Práctica vertical no disponible</h2>
        <p>El sensor no detecta impulsos verticales todavía. Esta modalidad estará disponible cuando el firmware capture pitch.</p>
      </div>
    </main>
  {:else}
    <main class="layout">
      <section class="row top">
        <div class="head-card">
          <HeadLiveView />
        </div>
        <aside class="side">
          <div class="panel">
            <div class="panel-title">
              <span>Sesión de práctica</span>
              <span class="kind-tag {bundle.kind}">{bundle.kind === 'practica-horiz' ? 'Horizontal' : 'Vertical'}</span>
            </div>

            {#if !practice.active}
              <div class="start">
                <p class="muted">
                  Configurado: <b>{goalCount}</b> {bundle.mode === 'hits' ? 'aciertos' : 'intentos'}
                  · orden <b>{bundle.order === 'sequential' ? 'secuencial' : 'aleatorio'}</b>
                </p>
                <ul class="goals-summary">
                  {#each goals as g (g.acceptanceId)}
                    <li><b>{g.count}</b> · {levelName(g.acceptanceId)}</li>
                  {/each}
                </ul>
                <button class="primary big" disabled={goalCount === 0} onclick={startSession}>
                  ▶ Iniciar práctica
                </button>
              </div>
            {:else}
              <div class="progress">
                <div class="prog-row">
                  <span>{bundle.mode === 'hits' ? 'Aciertos' : 'Intentos'}</span>
                  <b>{progress.current}/{progress.total}</b>
                </div>
                <div class="bar">
                  <div class="fill" style:width="{pct(progress.current, progress.total)}%"></div>
                </div>
              </div>
              <ul class="rem-list">
                {#each Object.entries(remaining) as [id, n] (id)}
                  <li>
                    <span class="rem-name">{levelName(id)}</span>
                    <b class="rem-count">{n}</b>
                    <span class="rem-unit">{bundle.mode === 'hits' ? 'aciertos' : 'intentos'}</span>
                  </li>
                {/each}
              </ul>
              {#if current}
                <div class="now">
                  <span class="ro-lab">Objetivo actual</span>
                  <b class="big-level">{levelName(current.acceptanceId)}</b>
                </div>
              {/if}
              <div class="actions">
                {#if practice.paused}
                  <button class="primary" onclick={resumeSession}>▶ Reanudar</button>
                {:else}
                  <button onclick={pauseSession}>❚❚ Pausar</button>
                {/if}
                <button onclick={skipGoal} disabled={practice.paused}>Saltar</button>
                <button onclick={retrySession} title="Reiniciar la práctica desde cero">↺ Reiniciar</button>
                <button class="danger" onclick={stopSession} title="Terminar y descartar la sesión">Cancelar</button>
              </div>
            {/if}
          </div>

          <div class="panel">
            <div class="panel-title">Historial</div>
            {#if recent.length === 0}
              <div class="empty-row">— sin intentos —</div>
            {:else}
              <ul class="hist">
                {#each recent as a (a.ts)}
                  <li class:ok={a.ok} class:bad={!a.ok}>
                    <span class="hist-name">{levelName(a.acceptanceId)}</span>
                    <span class="hist-side">{a.side}</span>
                    <span class="hist-stat">{a.peak.toFixed(0)}°/s</span>
                    <span class="hist-stat">g{a.gain.toFixed(2)}</span>
                    <span class="badge {a.ok ? 'ok' : 'bad'}">{a.ok ? '✓' : '✗'}</span>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        </aside>
      </section>

      <section class="row bottom">
        <div class="trace">
          <TraceChart title="Velocidad cabeza" hideEye />
        </div>
      </section>
    </main>
  {/if}
</div>

{#if showAchievements && ach}
  <div class="ach-overlay" role="dialog" aria-modal="true" aria-labelledby="ach-title">
    <div class="ach-modal">
      <h3 id="ach-title">🏆 Práctica completada</h3>

      <div class="ach-summary">
        <div class="big-stat">
          <span>Objetivos</span>
          <b>{ach.totalGoals}</b>
        </div>
        <div class="big-stat">
          <span>Aciertos</span>
          <b>{pct(ach.totalHits, ach.totalAttempts)}%</b>
          <em>{ach.totalHits}/{ach.totalAttempts}</em>
        </div>
        <div class="big-stat">
          <span>Duración</span>
          <b>{fmtMs(ach.durationMs)}</b>
        </div>
        <div class="big-stat">
          <span>Pico mejor</span>
          <b>{ach.bestPeak.toFixed(0)}<em>°/s</em></b>
        </div>
      </div>

      <h4>Detalle por nivel</h4>
      <table class="ach-table">
        <thead>
          <tr><th>Nivel</th><th>Pedido</th><th>Aciertos</th><th>Pico</th><th>Ganancia</th><th>Duración</th><th>Despl.</th></tr>
        </thead>
        <tbody>
          {#each ach.byPreset as s (s.acceptanceId)}
            <tr>
              <td>{levelName(s.acceptanceId)}</td>
              <td>{s.required}</td>
              <td><b>{s.hits}/{s.attempts}</b> ({pct(s.hits, s.attempts)}%)</td>
              <td>{s.peakAvg.toFixed(0)}°/s</td>
              <td>{s.gainAvg.toFixed(2)}</td>
              <td>{s.durAvg.toFixed(0)}ms</td>
              <td>{s.ampAvg.toFixed(1)}°</td>
            </tr>
          {/each}
        </tbody>
      </table>

      {#if Object.keys(ach.failReasons).length}
        <h4>Causas de fallo</h4>
        <ul class="reasons">
          {#each Object.entries(ach.failReasons).sort((a,b) => b[1]-a[1]) as [k, v]}
            <li><b>{v}</b> · {k}</li>
          {/each}
        </ul>
      {/if}

      <div class="ach-actions">
        <button onclick={closeAchievements}>Cerrar</button>
        <button class="primary" onclick={retrySession}>↺ Reintentar</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .app { height: 100vh; display: flex; flex-direction: column; background: var(--bg); }
  .layout {
    flex: 1; display: flex; flex-direction: column;
    gap: 12px; padding: 12px; min-height: 0;
    padding-top: 70px;
  }
  .row { display: grid; gap: 12px; min-height: 0; }
  .row.top {
    grid-template-columns: 2fr 1fr;
    flex: 1.4; min-height: 0;
  }
  .row.bottom { flex: 1; min-height: 0; }
  .row > * { min-height: 0; min-width: 0; }

  .head-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 12px;
    overflow: auto;
  }
  .head-card :global(.dial) { height: 180px; }

  .side { display: flex; flex-direction: column; gap: 12px; min-height: 0; overflow: auto; }

  .panel {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 12px;
  }
  .panel-title {
    display: flex; align-items: center; gap: 8px;
    font-size: 11px; text-transform: uppercase; letter-spacing: .04em;
    color: var(--text-muted); font-weight: 700;
    margin-bottom: 10px;
  }
  .panel-title > span:first-child { flex: 1; }

  .kind-tag {
    font-size: 10px; padding: 2px 8px; border-radius: 999px;
    text-transform: uppercase; letter-spacing: .04em; font-weight: 700;
  }
  .kind-tag.practica-horiz { background: #fde68a; color: #92400e; }
  .kind-tag.practica-vert { background: #c7d2fe; color: #3730a3; }

  .start { display: flex; flex-direction: column; gap: 12px; }
  .start .muted { color: var(--text-muted); font-size: 13px; margin: 0; }

  .progress { margin-bottom: 12px; }
  .prog-row { display: flex; justify-content: space-between; font-size: 13px; }
  .prog-row span { color: var(--text-muted); }
  .prog-row b { font-family: ui-monospace, monospace; font-size: 18px; }
  .bar { height: 8px; background: var(--surface-2); border-radius: 4px; overflow: hidden; margin-top: 6px; }
  .fill { height: 100%; background: var(--primary); transition: width 200ms ease-out; }

  .goals-summary {
    list-style: none; margin: 0; padding: 0;
    display: flex; flex-direction: column; gap: 4px;
  }
  .goals-summary li {
    display: flex; gap: 8px; align-items: center;
    padding: 6px 10px; background: var(--surface-2);
    border-radius: var(--radius-sm); font-size: 13px;
  }
  .goals-summary b { font-family: ui-monospace, monospace; color: var(--primary); min-width: 24px; }

  .rem-list {
    list-style: none; margin: 0 0 12px; padding: 0;
    display: flex; flex-direction: column; gap: 4px;
  }
  .rem-list li {
    display: grid; grid-template-columns: 1fr 40px auto; gap: 8px;
    align-items: center; padding: 6px 10px;
    background: var(--surface-2); border-radius: var(--radius-sm);
    font-size: 13px;
  }
  .rem-name { color: var(--text); }
  .rem-count { font-family: ui-monospace, monospace; font-size: 18px; text-align: right; }
  .rem-unit { font-size: 11px; color: var(--text-muted); }

  .now {
    display: flex; flex-direction: column; gap: 4px;
    padding: 10px; background: var(--surface-2);
    border-radius: var(--radius-sm); margin-bottom: 12px;
  }
  .ro-lab { font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: .04em; }
  .big-level { font-size: 22px; font-weight: 700; color: var(--primary); }

  .actions { display: flex; gap: 8px; }
  .actions button {
    flex: 1; padding: 6px 10px; font-size: 12px;
    border: 1px solid var(--border-strong); background: var(--surface);
    border-radius: var(--radius-sm); cursor: pointer;
  }
  .actions button:hover { background: var(--surface-2); }
  .actions button.danger { color: var(--danger); border-color: var(--danger); }
  .actions button.danger:hover { background: var(--danger); color: white; }

  button.primary {
    background: var(--primary); color: white; border: none;
    padding: 8px 14px; border-radius: var(--radius-sm);
    font-size: 13px; cursor: pointer;
  }
  button.primary.big { padding: 12px 16px; font-size: 15px; }
  button.primary:disabled { opacity: .5; cursor: not-allowed; }

  .empty-row { color: var(--text-muted); font-size: 12px; padding: 4px 0; }
  .hist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .hist li {
    display: grid;
    grid-template-columns: 1.4fr 28px 1fr 1fr 24px;
    gap: 6px; align-items: center;
    font-size: 12px;
    padding: 4px 6px; border-radius: 4px;
    border: 1px solid transparent;
    font-family: ui-monospace, monospace;
  }
  .hist li.ok { border-color: var(--success); background: #ecfdf5; }
  .hist li.bad { border-color: var(--danger); background: #fef2f2; }
  .hist-name { font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .hist-side { font-weight: 700; font-size: 11px; }
  .hist-stat { color: var(--text-muted); font-size: 11px; text-align: right; }
  .badge { padding: 1px 6px; border-radius: 999px; font-weight: 700; font-size: 10px; text-align: center; }
  .badge.ok { background: var(--success); color: white; }
  .badge.bad { background: var(--danger); color: white; }

  .trace {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 8px;
    display: flex; flex-direction: column;
  }

  .empty-state {
    margin: auto; text-align: center; color: var(--text-muted);
  }
  .empty-state h2 { color: var(--text); margin-bottom: 8px; }
  .empty-state a { color: var(--primary); }

  .ach-overlay {
    position: fixed; inset: 0;
    background: rgba(15,23,42,.6);
    backdrop-filter: blur(2px);
    display: grid; place-items: center; z-index: 200;
  }
  .ach-modal {
    background: var(--surface);
    border-radius: var(--radius-md, 12px);
    box-shadow: 0 20px 60px rgba(0,0,0,.25);
    width: min(680px, 95vw);
    max-height: 90vh; overflow: auto;
    padding: 24px;
  }
  .ach-modal h3 { margin: 0 0 16px; font-size: 22px; }
  .ach-modal h4 { margin: 18px 0 8px; font-size: 13px; color: var(--text-muted); text-transform: uppercase; letter-spacing: .04em; }
  .ach-summary {
    display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;
  }
  .big-stat {
    display: flex; flex-direction: column; gap: 2px;
    padding: 12px; background: var(--surface-2);
    border-radius: var(--radius-sm);
  }
  .big-stat span { font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: .04em; }
  .big-stat b { font-size: 24px; font-family: ui-monospace, monospace; }
  .big-stat em { font-size: 11px; color: var(--text-muted); font-style: normal; }

  .ach-table {
    width: 100%; border-collapse: collapse; font-size: 13px;
    font-family: ui-monospace, monospace;
  }
  .ach-table th, .ach-table td {
    text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border);
  }
  .ach-table th { font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: .04em; }
  .ach-table td b { font-weight: 700; }

  .reasons { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .reasons li {
    padding: 6px 10px; background: var(--surface-2);
    border-radius: 4px; font-size: 13px;
  }
  .reasons li b {
    display: inline-block; min-width: 28px;
    color: var(--danger); font-family: ui-monospace, monospace;
  }

  .ach-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
  .ach-actions button {
    padding: 8px 16px; border-radius: var(--radius-sm);
    font-size: 13px; cursor: pointer;
    border: 1px solid var(--border-strong);
    background: var(--surface); color: var(--text);
  }
  .ach-actions button:hover { background: var(--surface-2); }
  .ach-actions button.primary {
    background: var(--primary); color: white; border-color: var(--primary);
  }
  .ach-actions button.primary:hover { opacity: .9; background: var(--primary); }
</style>
