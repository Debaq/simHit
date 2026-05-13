<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import TopBar from '$lib/components/TopBar.svelte';
  import HeadLiveView from '$lib/components/HeadLiveView.svelte';
  import TraceChart from '$lib/components/TraceChart.svelte';
  import TraceReview from '$lib/components/TraceReview.svelte';
  import { sim } from '$lib/simulator.svelte';
  import { serial } from '$lib/serial.svelte';
  import { scenarios } from '$lib/scenario.svelte';
  import { bundles } from '$lib/bundle.svelte';
  import { acceptance } from '$lib/acceptance.svelte';
  import { practice } from '$lib/practice.svelte';
  import { practiceReports, humanStamp as prHumanStamp, slugName as prSlugName, type PracticeReport } from '$lib/practiceReport.svelte';

  onMount(async () => {
    await scenarios.load();
    if (bundles.active) bundles.applyActive();
    sim.connect();
  });
  onDestroy(() => {
    if (practice.active && practice.attempts.length > 0) {
      // fire-and-forget: la navegación se completa, el write ocurre en background
      void savePracticeReport({ partial: !practice.done });
    }
    practice.stop();
    sim.disconnect();
  });

  // Listener: cada vez que el sim emite un impulso, alimentar la práctica.
  $effect(() => {
    const imp = sim.lastImpulse;
    const ver = sim.lastVerdict;
    if (!imp || !ver) return;
    practice.consumeImpulse(ver, imp.side, imp.id, imp);
  });

  // Auto-guardar informe al completar la práctica.
  let sawDone = false;
  $effect(() => {
    if (practice.done && !sawDone && practice.attempts.length > 0) {
      sawDone = true;
      savePracticeReport({ partial: false });
    }
    if (!practice.active) sawDone = false;
  });

  let bundle = $derived(bundles.active);
  let goals = $derived(bundle?.goals ?? []);
  let goalCount = $derived(goals.reduce((a, g) => a + g.count, 0));

  let progress = $derived(practice.progress);
  let current = $derived(practice.current);
  let remaining = $derived(practice.remainingByPreset);
  let recent = $derived(practice.attempts.slice().reverse());
  let selectedTs = $state<number | null>(null);
  let selected = $derived(
    selectedTs == null ? null : practice.attempts.find((a) => a.ts === selectedTs) ?? null,
  );

  function levelName(id: string) {
    return acceptance.all.find((p) => p.id === id)?.name ?? id;
  }
  function openTrace(ts: number) { selectedTs = ts; }
  function closeTrace() { selectedTs = null; }
  let selectedPreset = $derived(
    selected ? acceptance.all.find((p) => p.id === selected.acceptanceId) ?? null : null,
  );
  let selectedChecks = $derived.by(() => {
    if (!selected || !selectedPreset) return null;
    const p = selectedPreset;
    const isHoriz = selected.side === 'LL' || selected.side === 'RL';
    const ampMax = isHoriz ? p.yawTol : p.pitchTol;
    return {
      peak: selected.peak >= p.peakMin && selected.peak <= p.peakMax,
      gain: selected.gain >= p.gainMin && selected.gain <= p.gainMax,
      dur:  selected.durMs >= p.durMinMs && selected.durMs <= p.durMaxMs,
      amp:  selected.amp  <= ampMax,
    };
  });
  let selectedIdx = $derived(
    selectedTs == null ? -1 : practice.attempts.findIndex((a) => a.ts === selectedTs),
  );
  function navTrace(delta: -1 | 1) {
    if (selectedIdx < 0) return;
    const next = selectedIdx + delta;
    const arr = practice.attempts;
    if (next < 0 || next >= arr.length) return;
    selectedTs = arr[next].ts;
  }
  $effect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') navTrace(-1);
      else if (e.key === 'ArrowRight') navTrace(1);
      else if (e.key === 'Escape') closeTrace();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  let nameModalOpen = $state(false);
  let practitionerInput = $state('');
  function startSession() {
    if (!bundle || bundle.kind === 'clinico') return;
    if (!serial.connected) return;
    practitionerInput = practice.practitioner;
    nameModalOpen = true;
  }
  function confirmStart() {
    if (!bundle || bundle.kind === 'clinico') return;
    currentReportId = null;
    practice.start(bundle, practitionerInput);
    nameModalOpen = false;
    if (sim.mode === 'idle' && scenarios.active) {
      sim.runScenario(scenarios.active);
    }
  }
  function cancelStart() { nameModalOpen = false; }
  async function stopSession() {
    if (practice.attempts.length > 0) {
      await savePracticeReport({ partial: !practice.done });
    }
    practice.stop();
    sim.stop();
  }

  let lastSavedTs = $state(0);
  let currentReportId: string | null = $state(null);
  async function savePracticeReport({ partial }: { partial: boolean }): Promise<string | null> {
    if (!bundle) return null;
    const now = Date.now();
    if (now - lastSavedTs < 500 && currentReportId) return currentReportId;
    lastSavedTs = now;
    const id = currentReportId
      ?? `${prHumanStamp()}_${prSlugName(practice.practitioner || 'sin_nombre')}`;
    currentReportId = id;
    const report: PracticeReport = {
      id,
      kind: 'practica',
      partial,
      ts: new Date().toISOString(),
      date: now,
      practitioner: practice.practitioner,
      bundleId: bundle.id,
      bundleName: bundle.name ?? bundle.id,
      variant: practice.variant,
      mode: practice.mode,
      startedMs: practice.startedMs,
      endedMs: now,
      // Resumen sin trazas crudas (pueden ser pesadas) — se regeneran al re-abrir si hace falta.
      attempts: practice.attempts.map((a) => ({
        itemIdx: a.itemIdx,
        acceptanceId: a.acceptanceId,
        side: a.side,
        ok: a.ok,
        peak: a.peak,
        gain: a.gain,
        durMs: a.durMs,
        amp: a.amp,
        reasons: a.reasons.slice(),
        ts: a.ts,
        impulseId: a.impulseId,
      })),
      achievements: practice.computeAchievements(),
      hasPdf: practiceReports.get(id)?.hasPdf ?? false,
    };
    try {
      await practiceReports.upsert(report);
    } catch (e) {
      console.warn('savePracticeReport', e);
    }
    return id;
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

  let manualAchOpen = $state(false);
  let showAchievements = $derived(practice.done || manualAchOpen);
  let ach = $derived.by(() => (showAchievements ? practice.computeAchievements() : null));
  function openResults() { manualAchOpen = true; }
  function pad2(n: number) { return String(n).padStart(2, '0'); }
  function humanStamp(d = new Date()) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}_${pad2(d.getHours())}h${pad2(d.getMinutes())}`;
  }
  function humanDateTime(d = new Date()) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
  function slugName(s: string) {
    return s
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60) || 'sin_nombre';
  }
  async function exportPdf() {
    const node = document.getElementById('ach-modal-root');
    if (!node) return;
    // Asegura que exista una entrada de informe para asociar el PDF persistido.
    const id = await savePracticeReport({ partial: !practice.done });
    const mod = await import('html2pdf.js');
    // @ts-expect-error html2pdf.js no incluye tipos
    const html2pdf = (mod.default ?? mod);
    const name = practice.practitioner || 'sin_nombre';
    const filename = `${slugName(name)}_${humanStamp()}.pdf`;
    const worker = html2pdf()
      .set({
        margin: 10,
        filename,
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: { scale: 2, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      })
      .from(node);
    // Persiste copia en informes/practica/<id>.pdf y dispara descarga al usuario.
    try {
      const blob: Blob = await worker.outputPdf('blob');
      if (id) {
        try {
          const bytes = new Uint8Array(await blob.arrayBuffer());
          await practiceReports.writePdf(id, bytes);
        } catch (e) {
          console.warn('persist practice pdf', e);
        }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 500);
    } catch (e) {
      console.warn('exportPdf', e);
    }
  }

  function fmtMs(ms: number) {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
  }
  function pct(n: number, d: number) { return d === 0 ? 0 : Math.round((n / d) * 100); }
  function closeAchievements() {
    if (manualAchOpen && !practice.done) {
      manualAchOpen = false;
      return;
    }
    manualAchOpen = false;
    practice.reset();
    sim.stop();
  }
  function retrySession() {
    const prevName = practice.practitioner;
    practice.reset();
    sim.stop();
    currentReportId = null;
    if (bundle && bundle.kind !== 'clinico') {
      practice.start(bundle, prevName);
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
          <HeadLiveView impulseLayout="prominent" />
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
                {#if !serial.connected}
                  <div class="hw-warn">
                    🔌 <b>SimHIT hardware no detectado.</b>
                    Conecta el equipo y calibra el IMU para practicar.
                    El modo práctica solo trabaja con impulsos reales del sensor.
                  </div>
                {/if}
                <button
                  class="primary big"
                  disabled={goalCount === 0 || !serial.connected}
                  onclick={startSession}
                >
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

          <div class="panel hist-panel">
            <div class="panel-title">
              <span>Historial</span>
              <span class="hist-count">{recent.length}</span>
              <button
                class="results-btn"
                type="button"
                onclick={openResults}
                disabled={recent.length === 0}
                title="Ver resultados de la sesión"
              >📊 Resultados</button>
            </div>
            {#if recent.length === 0}
              <div class="empty-row">— sin intentos —</div>
            {:else}
              <ul class="hist">
                {#each recent as a (a.ts)}
                  {@const hasTrace = (a.traceT?.length ?? 0) > 0}
                  <li class:ok={a.ok} class:bad={!a.ok} class:has-trace={hasTrace}>
                    <button
                      type="button"
                      class="hist-btn"
                      onclick={() => openTrace(a.ts)}
                      title={hasTrace ? 'Ver traza del impulso' : 'Sin traza (intento antiguo o saltado)'}
                    >
                      <span class="hist-name">{levelName(a.acceptanceId)}</span>
                      <span class="hist-side">{a.side}</span>
                      <span class="hist-stat">{a.peak.toFixed(0)}°/s</span>
                      <span class="hist-stat">g{a.gain.toFixed(2)}</span>
                      <span class="badge {a.ok ? 'ok' : 'bad'}">{a.ok ? '✓' : '✗'}</span>
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        </aside>
      </section>

      <section class="row bottom">
        <div class="trace">
          <TraceChart title="Velocidad cabeza" hideEye showPeakBands />
        </div>
      </section>
    </main>
  {/if}
</div>

{#if showAchievements && ach}
  <div class="ach-overlay" role="dialog" aria-modal="true" aria-labelledby="ach-title">
    <div class="ach-modal">
      <div id="ach-modal-root" class="ach-pdf-root">
      <h3 id="ach-title">
        {manualAchOpen && !practice.done ? '📊 Resultados parciales' : '🏆 Práctica completada'}
      </h3>
      <div class="ach-meta">
        {#if practice.practitioner}<span><b>{practice.practitioner}</b></span><span>·</span>{/if}
        {#if bundle}<span>{bundle.name ?? bundle.id}</span><span>·</span>{/if}
        <span>{humanDateTime()}</span>
      </div>

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
        <h4>¿Qué pasó?</h4>
        <ul class="reasons">
          {#each Object.entries(ach.failReasons).sort((a,b) => b[1]-a[1]) as [k, v]}
            <li><b>{v}×</b> {k}</li>
          {/each}
        </ul>
      {/if}

      <h4>Detalle de impulsos</h4>
      <table class="ach-table imp-table">
        <thead>
          <tr>
            <th>#</th><th>Nivel</th><th>Lado</th>
            <th>Pico °/s</th><th>Ganancia</th><th>Dur. ms</th><th>Despl. °</th>
            <th>Resultado</th><th>Observaciones</th>
          </tr>
        </thead>
        <tbody>
          {#each practice.attempts as a, i (a.ts)}
            <tr class:row-ok={a.ok} class:row-bad={!a.ok}>
              <td>{i + 1}</td>
              <td>{levelName(a.acceptanceId)}</td>
              <td>{a.side}</td>
              <td>{a.peak.toFixed(0)}</td>
              <td>{a.gain.toFixed(2)}</td>
              <td>{a.durMs.toFixed(0)}</td>
              <td>{a.amp.toFixed(1)}</td>
              <td>{a.ok ? '✓' : '✗'}</td>
              <td class="reasons-cell">{a.reasons.join('; ') || '—'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
      </div>

      <div class="ach-actions">
        <button onclick={closeAchievements}>Cerrar</button>
        <button onclick={exportPdf} title="Descargar PDF de la sesión">📄 PDF</button>
        {#if practice.done}
          <button class="primary" onclick={retrySession}>↺ Reintentar</button>
        {/if}
      </div>
    </div>
  </div>
{/if}

{#if nameModalOpen}
  <div class="name-overlay" role="dialog" aria-modal="true" aria-labelledby="name-title">
    <form class="name-modal" onsubmit={(e) => { e.preventDefault(); confirmStart(); }}>
      <h3 id="name-title">Iniciar práctica</h3>
      {#if practice.attempts.length > 0}
        <div class="name-warn">
          ⚠ Hay <b>{practice.attempts.length}</b> intento{practice.attempts.length === 1 ? '' : 's'} en el historial actual. Al iniciar se borrará{practice.attempts.length === 1 ? '' : 'n'}.
          {#if practice.practitioner}<br />Practicante anterior: <b>{practice.practitioner}</b>.{/if}
        </div>
      {/if}
      <label for="practitioner-input">Nombre del practicante</label>
      <input
        id="practitioner-input"
        type="text"
        bind:value={practitionerInput}
        placeholder="Ej. Juan Pérez"
        autofocus
        maxlength="80"
      />
      <p class="name-hint">Aparecerá en el informe PDF y en los resultados.</p>
      <div class="name-actions">
        <button type="button" onclick={cancelStart}>Cancelar</button>
        <button type="submit" class="primary">▶ Iniciar</button>
      </div>
    </form>
  </div>
{/if}

{#if selected}
  <div class="trv-overlay" role="dialog" aria-modal="true" aria-labelledby="trv-title">
    <button
      class="trv-nav prev"
      onclick={() => navTrace(-1)}
      disabled={selectedIdx <= 0}
      aria-label="Anterior"
      title="Anterior (←)"
    >‹</button>
    <div class="trv-modal">
      <div class="trv-head">
        <div>
          <h3 id="trv-title">
            Impulso #{selected.impulseId}
            <span class="trv-pos">{selectedIdx + 1} / {practice.attempts.length}</span>
          </h3>
          <div class="trv-sub">
            {levelName(selected.acceptanceId)} · {selected.side} ·
            <span class="trv-tag {selected.ok ? 'ok' : 'bad'}">{selected.ok ? '✓ OK' : '✗ Fuera'}</span>
          </div>
        </div>
        <button class="trv-close" onclick={closeTrace} aria-label="Cerrar">✕</button>
      </div>
      <div class="trv-stats">
        <div class={selectedChecks ? (selectedChecks.peak ? 'ok' : 'bad') : ''}>
          <span>pico {selectedChecks ? (selectedChecks.peak ? '✓' : '✗') : ''}</span>
          <b>{selected.peak.toFixed(0)}°/s</b>
        </div>
        <div class={selectedChecks ? (selectedChecks.gain ? 'ok' : 'bad') : ''}>
          <span>ganancia {selectedChecks ? (selectedChecks.gain ? '✓' : '✗') : ''}</span>
          <b>{selected.gain.toFixed(2)}</b>
        </div>
        <div class={selectedChecks ? (selectedChecks.dur ? 'ok' : 'bad') : ''}>
          <span>duración {selectedChecks ? (selectedChecks.dur ? '✓' : '✗') : ''}</span>
          <b>{selected.durMs.toFixed(0)} ms</b>
        </div>
        <div class={selectedChecks ? (selectedChecks.amp ? 'ok' : 'bad') : ''}>
          <span>despl. {selectedChecks ? (selectedChecks.amp ? '✓' : '✗') : ''}</span>
          <b>{selected.amp.toFixed(1)}°</b>
        </div>
      </div>
      <div class="trv-legend">
        <span><i style:background="#111827"></i><b>Cabeza</b></span>
      </div>
      <div class="trv-chart-slot">
        {#key selectedTs}
          <TraceReview
            t={selected.traceT}
            head={selected.traceHead}
            eye={selected.traceEye}
            hideEye
            peakMin={selectedPreset?.peakMin}
            peakMax={selectedPreset?.peakMax}
            durMinMs={selectedPreset?.durMinMs}
            durMaxMs={selectedPreset?.durMaxMs}
          />
        {/key}
      </div>
      <div class="trv-reasons-slot">
        {#if selected.reasons.length > 0 && !selected.ok}
          <div class="trv-reasons">
            <span class="trv-reasons-lab">¿Qué pasó?</span>
            <ul class="trv-reasons-list">
              {#each selected.reasons as r}
                <li>{r}</li>
              {/each}
            </ul>
          </div>
        {:else if selected.ok}
          <div class="trv-reasons ok">
            <span class="trv-reasons-lab ok">✓ Impulso correcto</span>
          </div>
        {/if}
      </div>
    </div>
    <button
      class="trv-nav next"
      onclick={() => navTrace(1)}
      disabled={selectedIdx < 0 || selectedIdx >= practice.attempts.length - 1}
      aria-label="Siguiente"
      title="Siguiente (→)"
    >›</button>
  </div>
{/if}

<style>
  .app { height: 100vh; display: flex; flex-direction: column; background: var(--bg); }
  .layout {
    flex: 1; display: flex; flex-direction: column;
    gap: 10px; padding: 10px; min-height: 0;
    padding-top: 12px;
  }
  .row { display: grid; gap: 12px; min-height: 0; }
  .row.top {
    grid-template-columns: 2fr 1fr;
    grid-template-rows: 1fr;
    flex: 1.4; min-height: 0;
  }
  .row.bottom { grid-template-rows: 1fr; flex: 1; min-height: 0; }
  .row > * { min-height: 0; min-width: 0; }

  .head-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 10px;
    overflow: hidden;
    display: flex;
    min-height: 0;
  }
  .head-card :global(.live) { flex: 1; min-height: 0; }
  .head-card :global(.dial) { height: 130px; }

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
  .hw-warn {
    padding: 10px 14px;
    background: #fef3c7; border: 1px solid #f59e0b;
    border-radius: var(--radius-sm);
    color: #92400e; font-size: 13px; line-height: 1.4;
  }
  .hw-warn b { color: #78350f; }

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
  .hist-panel { display: flex; flex-direction: column; min-height: 0; flex: 1; }
  .hist-panel .panel-title { display: flex; align-items: center; gap: 8px; }
  .hist-panel .panel-title > span:first-child { flex: 1; }
  .hist-count {
    font-family: ui-monospace, monospace; font-size: 11px;
    background: var(--surface-2); color: var(--text);
    padding: 1px 8px; border-radius: 999px;
  }
  .results-btn {
    font-size: 11px; font-weight: 700;
    padding: 3px 10px; border-radius: var(--radius-sm);
    border: 1px solid var(--primary); background: var(--primary); color: white;
    cursor: pointer; text-transform: none; letter-spacing: 0;
  }
  .results-btn:hover:not(:disabled) { filter: brightness(0.92); }
  .results-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .hist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; overflow-y: auto; min-height: 0; }
  .hist li {
    border-radius: 4px;
    border: 1px solid transparent;
  }
  .hist li.ok { border-color: var(--success); background: #ecfdf5; }
  .hist li.bad { border-color: var(--danger); background: #fef2f2; }
  .hist-btn {
    width: 100%; background: transparent; border: 0; cursor: pointer;
    display: grid;
    grid-template-columns: 1.4fr 28px 1fr 1fr 24px;
    gap: 6px; align-items: center;
    font-size: 12px;
    padding: 4px 6px;
    font-family: ui-monospace, monospace;
    text-align: left; color: inherit;
  }
  .hist li.has-trace .hist-btn:hover { background: rgba(0,0,0,0.04); }
  .hist-btn:disabled { cursor: default; opacity: 0.7; }
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

  .name-overlay {
    position: fixed; inset: 0;
    background: rgba(15,23,42,.6);
    backdrop-filter: blur(2px);
    display: grid; place-items: center; z-index: 220;
  }
  .name-modal {
    background: var(--surface);
    border-radius: var(--radius-md, 12px);
    box-shadow: 0 20px 60px rgba(0,0,0,.25);
    width: min(440px, 92vw);
    padding: 24px;
    display: flex; flex-direction: column; gap: 10px;
  }
  .name-modal h3 { margin: 0 0 6px; font-size: 20px; }
  .name-modal label {
    font-size: 12px; text-transform: uppercase; letter-spacing: .04em;
    color: var(--text-muted); font-weight: 700;
  }
  .name-modal input {
    padding: 10px 12px; font-size: 15px;
    border: 1px solid var(--border-strong); border-radius: var(--radius-sm);
    background: var(--surface); color: var(--text);
  }
  .name-modal input:focus { outline: 2px solid var(--primary); outline-offset: 1px; }
  .name-hint { margin: 0; font-size: 12px; color: var(--text-muted); }
  .name-warn {
    padding: 8px 12px; background: #fffbeb;
    border: 1px solid #fcd34d; border-radius: var(--radius-sm);
    color: #92400e; font-size: 13px; line-height: 1.4;
  }
  .name-warn b { color: #78350f; }
  .name-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px; }
  .name-actions button {
    padding: 8px 14px; border-radius: var(--radius-sm);
    border: 1px solid var(--border-strong); background: var(--surface);
    cursor: pointer; font-size: 13px;
  }
  .name-actions button.primary {
    background: var(--primary); color: white; border-color: var(--primary);
  }

  .trv-overlay {
    position: fixed; inset: 0;
    background: rgba(15,23,42,.55);
    backdrop-filter: blur(2px);
    display: flex; align-items: center; justify-content: center; gap: 12px;
    z-index: 210;
  }
  .trv-nav {
    background: var(--surface); color: var(--text);
    border: 1px solid var(--border);
    width: 48px; height: 80px; border-radius: var(--radius-md, 12px);
    font-size: 36px; font-weight: 700; cursor: pointer;
    box-shadow: 0 8px 24px rgba(0,0,0,.2);
    display: flex; align-items: center; justify-content: center;
    line-height: 1;
  }
  .trv-nav:hover:not(:disabled) { background: var(--surface-2); }
  .trv-nav:disabled { opacity: 0.3; cursor: not-allowed; }
  .trv-pos {
    font-family: ui-monospace, monospace;
    font-size: 13px; color: var(--text-muted);
    margin-left: 8px; font-weight: 500;
  }
  .trv-modal {
    background: var(--surface);
    border-radius: var(--radius-md, 12px);
    box-shadow: 0 20px 60px rgba(0,0,0,.25);
    width: min(820px, 95vw);
    height: min(620px, 90vh);
    padding: 20px;
    display: flex; flex-direction: column; gap: 12px;
    overflow: hidden;
  }
  .trv-chart-slot { flex: 1; min-height: 0; display: flex; }
  .trv-chart-slot :global(.trace-host) { height: 100% !important; flex: 1; }
  .trv-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
  .trv-head h3 { margin: 0; font-size: 20px; }
  .trv-sub { font-size: 13px; color: var(--text-muted); margin-top: 4px; }
  .trv-tag { padding: 2px 8px; border-radius: 999px; font-weight: 700; }
  .trv-tag.ok { background: var(--success); color: white; }
  .trv-tag.bad { background: var(--danger); color: white; }
  .trv-close {
    background: transparent; border: 0; font-size: 18px; cursor: pointer;
    color: var(--text-muted); padding: 4px 8px;
  }
  .trv-close:hover { color: var(--text); }
  .trv-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .trv-stats div {
    background: var(--surface-2); padding: 8px 10px; border-radius: var(--radius-sm);
    display: flex; flex-direction: column;
    border: 2px solid transparent;
  }
  .trv-stats div.ok { border-color: var(--success); background: #ecfdf5; }
  .trv-stats div.bad { border-color: var(--danger); background: #fef2f2; }
  .trv-stats span {
    font-size: 10px; text-transform: uppercase; letter-spacing: .04em;
    color: var(--text-muted); font-weight: 700;
    display: flex; justify-content: space-between; align-items: center;
  }
  .trv-stats div.ok span { color: var(--success); }
  .trv-stats div.bad span { color: var(--danger); }
  .trv-stats b { font-family: ui-monospace, monospace; font-size: 18px; }
  .trv-stats div.ok b { color: var(--success); }
  .trv-stats div.bad b { color: var(--danger); }
  .trv-legend {
    display: flex; gap: 14px; font-size: 12px; color: var(--text-muted);
  }
  .trv-legend span { display: inline-flex; align-items: center; gap: 6px; }
  .trv-legend i { width: 18px; height: 4px; border-radius: 2px; display: inline-block; }
  .trv-reasons-slot { min-height: 56px; display: flex; align-items: center; }
  .trv-reasons {
    width: 100%;
    background: #fef2f2; border: 2px solid var(--danger); border-radius: var(--radius-sm);
    padding: 10px 14px;
    display: flex; align-items: center; gap: 12px; flex-wrap: nowrap;
    overflow-x: auto;
  }
  .trv-reasons.ok { background: #ecfdf5; border-color: var(--success); }
  .trv-reasons-lab {
    font-size: 12px; text-transform: uppercase; letter-spacing: .04em;
    color: var(--danger); font-weight: 800; flex-shrink: 0;
  }
  .trv-reasons-lab.ok { color: var(--success); text-transform: none; font-size: 14px; }
  .trv-reasons-list {
    margin: 0; padding: 0; list-style: none;
    display: flex !important; flex-direction: row !important;
    gap: 6px; flex-wrap: wrap;
    align-items: center;
  }
  .trv-reasons-list li {
    display: inline-block;
    font-size: 13px; font-weight: 700; color: var(--danger);
    padding: 4px 10px;
    background: white;
    border: 1px solid #fecaca;
    border-radius: 999px;
    white-space: nowrap;
  }
  .ach-modal {
    background: var(--surface);
    border-radius: var(--radius-md, 12px);
    box-shadow: 0 20px 60px rgba(0,0,0,.25);
    width: min(680px, 95vw);
    max-height: 90vh; overflow: auto;
    padding: 24px;
  }
  .ach-modal h3 { margin: 0 0 4px; font-size: 22px; }
  .ach-meta {
    display: flex; gap: 6px; margin-bottom: 16px;
    font-size: 12px; color: var(--text-muted);
  }
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

  .imp-table { font-size: 11px; }
  .imp-table td, .imp-table th { padding: 4px 6px; }
  .imp-table .row-ok td:nth-child(8) { color: var(--success); font-weight: 800; }
  .imp-table .row-bad td:nth-child(8) { color: var(--danger); font-weight: 800; }
  .imp-table .reasons-cell {
    font-family: inherit; font-size: 10px; color: var(--text-muted);
    max-width: 260px; word-break: break-word; white-space: normal;
  }

  .reasons {
    list-style: none; margin: 0; padding: 0;
    display: flex; flex-direction: row; flex-wrap: wrap; gap: 6px;
  }
  .reasons li {
    padding: 4px 10px;
    background: #fef2f2; border: 1px solid #fecaca;
    border-radius: 999px; font-size: 13px; font-weight: 600;
    color: var(--danger);
    white-space: nowrap;
  }
  .reasons li b {
    font-family: ui-monospace, monospace; font-weight: 800;
    margin-right: 4px;
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
