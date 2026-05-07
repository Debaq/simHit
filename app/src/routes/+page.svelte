<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import TopBar from '$lib/components/TopBar.svelte';
  import EyeView from '$lib/components/EyeView.svelte';
  import TraceChart from '$lib/components/TraceChart.svelte';
  import ImpulseChart from '$lib/components/ImpulseChart.svelte';
  import ResultsPanel from '$lib/components/ResultsPanel.svelte';
  import { sim } from '$lib/simulator.svelte';
  import { scenarios } from '$lib/scenario.svelte';

  onMount(() => {
    scenarios.load();
    sim.connect();
  });
  onDestroy(() => sim.disconnect());
</script>

<div class="app">
  <TopBar />

  <main class="layout">
    <section class="row top">
      <div class="trace">
        <TraceChart title="Velocidad cabeza vs ojo (tiempo real)" />
      </div>
      <div class="eye">
        <EyeView value={sim.gaze} blinkFrame={sim.blinkFrame} connected={sim.connected} />
        <div class="eye-controls">
          <button onclick={() => (sim.connected ? sim.disconnect() : sim.connect())}>
            {sim.connected ? 'Desconectar' : 'Conectar'}
          </button>
        </div>
      </div>
    </section>

    <section class="row bottom">
      <ImpulseChart side="LL" label="Lateral Izquierdo" />
      <ResultsPanel />
      <ImpulseChart side="RL" label="Lateral Derecho" />
    </section>
  </main>
</div>

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
    flex: 1.3;
    min-height: 0;
  }
  .row.bottom {
    grid-template-columns: 1fr 1fr 1fr;
    flex: 1;
    min-height: 0;
  }
  .trace, .eye { display: flex; flex-direction: column; min-height: 0; }
  .eye { gap: 8px; }
  .eye :global(.eye-card) { flex: 1; }
  .eye-controls {
    display: flex; gap: 8px;
  }
  .eye-controls button { flex: 1; }
</style>
