<script lang="ts">
  import { goto } from '$app/navigation';
  import { sim } from '$lib/simulator.svelte';
  import { scenarios } from '$lib/scenario.svelte';
  import { reports, emptyFindings, type ImpulseSnapshot, type Report } from '$lib/report.svelte';
  import HeadLiveView from './HeadLiveView.svelte';
  import AudioSettings from './AudioSettings.svelte';
  import { audio } from '$lib/audio.svelte';

  let audioModalOpen = $state(false);

  // Reproducir beep al cerrar cada impulso
  let lastImpulseId = $state<number | null>(null);
  $effect(() => {
    const v = sim.lastVerdict;
    const imp = sim.lastImpulse;
    if (!v || !imp) return;
    if (imp.id === lastImpulseId) return;
    lastImpulseId = imp.id;
    if (v.ok) audio.beepOk(); else audio.beepError();
  });

  let gainLL = $derived(
    sim.impulsesLL.length === 0
      ? 0
      : sim.impulsesLL.reduce((a, i) => a + i.gain, 0) / sim.impulsesLL.length
  );
  let gainRL = $derived(
    sim.impulsesRL.length === 0
      ? 0
      : sim.impulsesRL.reduce((a, i) => a + i.gain, 0) / sim.impulsesRL.length
  );

  function runScenario() {
    if (scenarios.active) sim.runScenario(scenarios.active);
  }

  // Lista anónima: examen 01, 02, ... (orden combinado examples + user)
  let examList = $derived([...scenarios.examples, ...scenarios.list]);
  let activeIndex = $derived(examList.findIndex((s) => s.id === scenarios.activeId));
  function pickExam(e: Event) {
    const idx = +(e.target as HTMLSelectElement).value;
    if (examList[idx]) scenarios.setActive(examList[idx].id);
  }

  function snapshotImpulses(): ImpulseSnapshot[] {
    const all = [...sim.impulsesLL, ...sim.impulsesRL];
    return all.map((i) => ({
      id: i.id,
      side: i.side,
      t: Array.from(i.t),
      head: Array.from(i.head),
      eye: Array.from(i.eye),
      gain: i.gain,
    }));
  }

  function generateReport() {
    if (sim.impulsesLL.length + sim.impulsesRL.length === 0) {
      alert('Realiza un examen antes de generar el informe.');
      return;
    }
    if (sim.mode !== 'idle') {
      alert('Detén el examen antes de generar el informe.');
      return;
    }
    const id = crypto.randomUUID();
    const examIndex = examList.findIndex((s) => s.id === scenarios.activeId);
    const examCode = examIndex >= 0
      ? `Examen ${String(examIndex + 1).padStart(2, '0')}`
      : 'Examen libre';
    const r: Report = {
      id,
      examenCode: examCode,
      scenarioId: scenarios.activeId ?? '',
      examiner: '',
      examinerTitle: '',
      institution: '',
      patientName: '',
      patientId: '',
      patientAge: '',
      patientReason: '',
      date: Date.now(),
      impulses: snapshotImpulses(),
      gainLL: gainLL,
      gainRL: gainRL,
      countLL: sim.impulsesLL.length,
      countRL: sim.impulsesRL.length,
      findings: emptyFindings(),
      interpretation: '',
      diagnosis: '',
      comments: '',
      submitted: false,
    };
    reports.upsert(r);
    goto(`/informe/${id}`);
  }
</script>

<div class="card results">
  <div class="card-title">
    <span>Captura en vivo · Resultados</span>
    <span class="title-actions">
      <button
        class="icon-btn"
        class:on={audio.enabled}
        onclick={() => audio.toggleEnabled()}
        title={audio.enabled ? 'Silenciar sonido' : 'Activar sonido'}
        aria-label="Toggle sonido"
      >{audio.enabled ? '🔊' : '🔇'}</button>
      <button class="icon-btn" onclick={() => (audioModalOpen = true)} title="Configurar sonido">⚙</button>
    </span>
  </div>
  <div class="card-body grid">
    <div class="head-live-wrap">
      <HeadLiveView />
    </div>
    <div class="scenario-info">
      <label class="picker">
        <span>Examen</span>
        <select onchange={pickExam} disabled={sim.mode !== 'idle'} value={String(activeIndex)}>
          {#each examList as s, i}
            <option value={i}>{String(i + 1).padStart(2, '0')}</option>
          {/each}
        </select>
      </label>
      {#if sim.mode === 'scenario'}
        <span class="status running"><span class="led"></span>En curso</span>
      {:else if sim.mode === 'free'}
        <span class="status running"><span class="led"></span>Modo libre</span>
      {:else}
        <span class="status idle"><span class="led"></span>Listo</span>
      {/if}
    </div>
    <div class="actions">
      <button
        class="primary"
        disabled={!sim.connected || !scenarios.active}
        onclick={() => (sim.mode === 'scenario' ? sim.stop() : runScenario())}
      >
        {sim.mode === 'scenario' ? '■ Detener test' : '▶ Iniciar test'}
      </button>
      <button
        disabled={!sim.connected}
        onclick={() => (sim.mode === 'free' ? sim.stop() : sim.startFreeMode())}
      >
        {sim.mode === 'free' ? '■ Detener libre' : '⤧ Modo libre'}
      </button>
      <button onclick={() => sim.clearImpulses()}>Limpiar</button>
      <button
        class="primary"
        disabled={sim.impulsesLL.length + sim.impulsesRL.length === 0}
        onclick={generateReport}
      >
        📄 Generar informe
      </button>
    </div>
  </div>
</div>

<AudioSettings open={audioModalOpen} onClose={() => (audioModalOpen = false)} />

<style>
  .results { display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
  .results .card-body { overflow: auto; min-height: 0; }
  .grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 8px;
  }
  .head-live-wrap { padding: 0 2px; }
  .card-title { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .title-actions { display: inline-flex; gap: 4px; }
  .icon-btn {
    width: 28px; height: 28px; padding: 0; font-size: 14px;
    border: 1px solid var(--border-strong); background: var(--surface);
    border-radius: var(--radius-sm); cursor: pointer; display: inline-flex;
    align-items: center; justify-content: center;
  }
  .icon-btn:hover { background: var(--primary-soft); border-color: var(--primary); }
  .icon-btn.on { background: var(--success); color: white; border-color: var(--success); }
  .scenario-info {
    grid-column: 1 / -1;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 6px 10px;
    font-size: 11px;
    display: flex; flex-wrap: wrap; gap: 6px; align-items: center;
  }
  .scenario-info .muted { color: var(--text-muted); font-style: italic; }
  .picker { display: inline-flex; align-items: center; gap: 6px; }
  .picker span { font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: .04em; font-weight: 600; }
  .picker select {
    font: inherit; font-size: 12px;
    padding: 3px 6px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font-family: ui-monospace, monospace;
    font-weight: 600;
  }
  .picker select:disabled { opacity: .5; cursor: not-allowed; }
  .status { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
  .status .led { width: 8px; height: 8px; border-radius: 50%; background: #cbd5e1; }
  .status.running { color: var(--success); }
  .status.running .led { background: var(--success); box-shadow: 0 0 0 3px rgba(22,163,74,.15); animation: pulse 1.4s ease-in-out infinite; }
  .status.idle { color: var(--text-muted); }
  @keyframes pulse { 50% { opacity: .5; } }
  .actions {
    grid-column: 1 / -1;
    display: flex; gap: 8px;
    justify-content: center;
    flex-wrap: wrap;
  }
  .actions button { font-size: 12px; padding: 6px 10px; }
  button:disabled { opacity: .4; cursor: not-allowed; }
</style>
