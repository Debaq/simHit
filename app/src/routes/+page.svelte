<script lang="ts">
  import TopBar from '$lib/components/TopBar.svelte';
  import EyeView from '$lib/components/EyeView.svelte';
  import TraceChart from '$lib/components/TraceChart.svelte';
  import ImpulseChart from '$lib/components/ImpulseChart.svelte';
  import ResultsPanel from '$lib/components/ResultsPanel.svelte';

  let eyeValue = $state(0);
</script>

<div class="app">
  <TopBar />

  <main class="layout">
    <section class="row top">
      <div class="trace"><TraceChart title="Velocidad cabeza vs ojo (tiempo real)" /></div>
      <div class="eye">
        <EyeView value={eyeValue} />
        <input
          type="range" min="-14" max="14" step="1"
          bind:value={eyeValue}
          aria-label="Posición del ojo (debug)"
        />
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
  }
  .row.bottom {
    grid-template-columns: 1fr 1fr 1fr;
    flex: 1;
  }
  .trace, .eye { display: flex; flex-direction: column; min-height: 0; }
  .eye { gap: 8px; }
  .eye :global(.eye-card) { flex: 1; }
  input[type="range"] { width: 100%; accent-color: var(--primary); }
</style>
