<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import TopBar from '$lib/components/TopBar.svelte';
  import EyeView from '$lib/components/EyeView.svelte';
  import TraceChart from '$lib/components/TraceChart.svelte';
  import ImpulseChart from '$lib/components/ImpulseChart.svelte';
  import ResultsPanel from '$lib/components/ResultsPanel.svelte';
  import ImpulseModal from '$lib/components/ImpulseModal.svelte';
  import { sim } from '$lib/simulator.svelte';
  import { scenarios } from '$lib/scenario.svelte';
  import { bundles } from '$lib/bundle.svelte';
  import type { ImpulseSnapshot, Side } from '$lib/report.svelte';

  onMount(async () => {
    await scenarios.load();
    if (bundles.active && bundles.active.kind !== 'clinico') {
      goto('/practica');
      return;
    }
    sim.connect();
  });
  onDestroy(() => sim.disconnect());

  let editorOpen = $state(false);
  let editorSide = $state<Side>('LL');
  function openEditor(s: Side) { editorSide = s; editorOpen = true; }

  const EDITOR_CHANNELS: { id: Side; label: string }[] = [
    { id: 'LL', label: 'Lateral izquierdo' },
    { id: 'RL', label: 'Lateral derecho' },
  ];
  function editorImpulsesBy(s: Side): ImpulseSnapshot[] {
    // El editor del simulador clínico opera sólo sobre canales horizontales.
    const arr = s === 'LL' ? sim.impulsesLL : sim.impulsesRL;
    return arr.map((i) => ({
      id: i.id,
      side: i.side as 'LL' | 'RL',
      t: Array.from(i.t),
      head: Array.from(i.head),
      eye: Array.from(i.eye),
      gain: i.gain,
    }));
  }
</script>

<div class="app">
  <TopBar />

  <main class="layout">
    <section class="row top">
      <div class="trace">
        <TraceChart title="Velocidad cabeza vs ojo (tiempo real)" />
      </div>
      <div class="eye">
        <EyeView value={sim.gaze} valueY={sim.gazeY} blinkFrame={sim.blinkFrame} connected={sim.cameraOn} />
      </div>
    </section>

    <section class="row bottom">
      <ImpulseChart side="LL" label="Lateral Izquierdo" onEdit={openEditor} />
      <ResultsPanel />
      <ImpulseChart side="RL" label="Lateral Derecho" onEdit={openEditor} />
    </section>
  </main>
</div>

<ImpulseModal
  open={editorOpen}
  side={editorSide}
  channels={EDITOR_CHANNELS}
  impulsesBy={editorImpulsesBy}
  excluded={sim.excludedIds}
  onToggleExclude={(id) => sim.toggleExclude(id)}
  onDelete={(id) => sim.deleteImpulse(id)}
  onClose={() => (editorOpen = false)}
  onChangeSide={(s) => (editorSide = s)}
/>

<style>
  .app {
    height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--bg);
  }
  .layout {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px;
    min-height: 0;
  }
  .row {
    display: grid;
    gap: 12px;
    min-height: 0;
  }
  .row.top {
    grid-template-columns: 2fr 1fr;
    flex: 1.1;
    min-height: 0;
  }
  .row.bottom {
    grid-template-columns: 1fr 1.2fr 1fr;
    flex: 1;
    min-height: 0;
  }
  .row > * { min-height: 0; min-width: 0; overflow: hidden; }
  .trace, .eye { display: flex; flex-direction: column; min-height: 0; }
  .eye { gap: 8px; }
  .eye :global(.eye-card) { flex: 1; }
</style>
