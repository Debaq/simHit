<script lang="ts">
  import { goto } from '$app/navigation';
  import { sim } from '$lib/simulator.svelte';
  import { serial } from '$lib/serial.svelte';
  import { scenarios } from '$lib/scenario.svelte';
  import { reports, emptyFindings, type ImpulseSnapshot, type Report } from '$lib/report.svelte';
  import HeadLiveView from './HeadLiveView.svelte';
  import AudioSettings from './AudioSettings.svelte';
  import { audio } from '$lib/audio.svelte';
  import { ui } from '$lib/dialog.svelte';

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

  // Mínimo de impulsos válidos por lado para habilitar 'Generar informe'.
  // Subir aquí cuando se quiera endurecer la regla (ej. 3 ó 5).
  const MIN_IMPULSES_PER_SIDE = 1;

  let includedLL = $derived(sim.impulsesLL.filter((i) => !sim.excludedIds.has(i.id)));
  let includedRL = $derived(sim.impulsesRL.filter((i) => !sim.excludedIds.has(i.id)));
  let gainLL = $derived(
    includedLL.length === 0 ? 0 : includedLL.reduce((a, i) => a + i.gain, 0) / includedLL.length
  );
  let gainRL = $derived(
    includedRL.length === 0 ? 0 : includedRL.reduce((a, i) => a + i.gain, 0) / includedRL.length
  );

  let canGenerate = $derived(
    includedLL.length >= MIN_IMPULSES_PER_SIDE && includedRL.length >= MIN_IMPULSES_PER_SIDE
  );
  let generateTooltip = $derived.by(() => {
    const missLL = MIN_IMPULSES_PER_SIDE - includedLL.length;
    const missRL = MIN_IMPULSES_PER_SIDE - includedRL.length;
    if (missLL > 0 && missRL > 0) return `Faltan ${missLL} impulso(s) izq. y ${missRL} der.`;
    if (missLL > 0) return `Falta${missLL > 1 ? 'n' : ''} ${missLL} impulso(s) del lado izquierdo`;
    if (missRL > 0) return `Falta${missRL > 1 ? 'n' : ''} ${missRL} impulso(s) del lado derecho`;
    return '';
  });


  function runScenario() {
    if (scenarios.active) sim.runScenario(scenarios.active);
  }

  let examList = $derived([...scenarios.examples, ...scenarios.list]);

  function snapshotImpulses(): ImpulseSnapshot[] {
    // Solo incluidos: los excluidos en captura no se llevan al informe.
    const all = [...includedLL, ...includedRL];
    return all.map((i) => ({
      id: i.id,
      side: i.side,
      t: Array.from(i.t),
      head: Array.from(i.head),
      eye: Array.from(i.eye),
      gain: i.gain,
    }));
  }

  async function generateReport() {
    if (!canGenerate) {
      await ui.alert('Faltan impulsos', generateTooltip || `Se requieren al menos ${MIN_IMPULSES_PER_SIDE} impulso(s) por lado.`);
      return;
    }
    if (sim.mode !== 'idle') {
      await ui.alert('Examen en curso', 'Detén el examen antes de generar el informe.');
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
      countLL: includedLL.length,
      countRL: includedRL.length,
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
    <div class="actions">
      <button
        class="primary"
        disabled={!sim.connected || !scenarios.active || (serial.connected && !serial.calibrated)}
        title={serial.connected && !serial.calibrated ? 'Calibrar SimHit antes de iniciar' : ''}
        onclick={() => (sim.mode === 'scenario' ? sim.stop() : runScenario())}
      >
        {sim.mode === 'scenario' ? (serial.connected ? '■ Detener test' : '■ Detener demo') : (serial.connected ? '▶ Iniciar test' : '▶ Iniciar demo')}
      </button>
      <button
        disabled={!sim.connected || (serial.connected && !serial.calibrated)}
        title={serial.connected && !serial.calibrated ? 'Calibrar SimHit antes de iniciar' : ''}
        onclick={() => (sim.mode === 'free' ? sim.stop() : sim.startFreeMode())}
      >
        {sim.mode === 'free' ? '■ Detener libre' : '⤧ Modo libre'}
      </button>
      <button
        disabled={sim.impulsesLL.length + sim.impulsesRL.length === 0}
        onclick={() => sim.clearImpulses()}
      >Limpiar</button>
      <button
        class="primary"
        disabled={!canGenerate}
        title={canGenerate ? '' : generateTooltip}
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
  .actions {
    grid-column: 1 / -1;
    display: flex; gap: 8px;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 6px 10px;
  }
  .actions button { font-size: 12px; padding: 6px 10px; }
  button:disabled { opacity: .4; cursor: not-allowed; }
</style>
