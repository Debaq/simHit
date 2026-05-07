<script lang="ts">
  import { sim } from '$lib/simulator.svelte';
  import { scenarios } from '$lib/scenario.svelte';

  const fmt = (n: number) => n.toFixed(2);
  const gainColor = (g: number) =>
    g >= 0.8 ? 'var(--success)' : g >= 0.6 ? 'var(--warn)' : 'var(--danger)';

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
</script>

<div class="card results">
  <div class="card-title">Resultados</div>
  <div class="card-body grid">
    <div class="metric">
      <div class="m-label">Ganancia LL</div>
      <div class="m-value" style:color={gainColor(gainLL)}>
        {sim.impulsesLL.length ? fmt(gainLL) : '—'}
      </div>
      <div class="m-sub">{sim.impulsesLL.length} impulsos</div>
    </div>
    <div class="metric">
      <div class="m-label">Ganancia RL</div>
      <div class="m-value" style:color={gainColor(gainRL)}>
        {sim.impulsesRL.length ? fmt(gainRL) : '—'}
      </div>
      <div class="m-sub">{sim.impulsesRL.length} impulsos</div>
    </div>
    <div class="scenario-info">
      {#if scenarios.active}
        <span class="label">Escenario:</span>
        <span class="name">{scenarios.active.name}</span>
      {:else}
        <span class="muted">Sin escenario activo</span>
      {/if}
      {#if sim.currentStep}
        <span class="step">→ {sim.currentStep}</span>
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
    </div>
  </div>
</div>

<style>
  .results { display: flex; flex-direction: column; }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .metric {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 10px 12px;
    text-align: center;
  }
  .m-label { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: .05em; }
  .m-value { font-size: 28px; font-weight: 700; line-height: 1.1; margin: 4px 0; font-family: ui-monospace, monospace; }
  .m-sub { font-size: 11px; color: var(--text-muted); }
  .scenario-info {
    grid-column: 1 / -1;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 6px 10px;
    font-size: 11px;
    display: flex; flex-wrap: wrap; gap: 6px; align-items: center;
  }
  .scenario-info .label { color: var(--text-muted); text-transform: uppercase; letter-spacing: .04em; font-weight: 600; font-size: 10px; }
  .scenario-info .name { color: var(--primary); font-weight: 600; }
  .scenario-info .step { color: var(--text-muted); font-style: italic; }
  .scenario-info .muted { color: var(--text-muted); font-style: italic; }
  .actions {
    grid-column: 1 / -1;
    display: flex; gap: 8px;
    justify-content: center;
    flex-wrap: wrap;
  }
  .actions button { font-size: 12px; padding: 6px 10px; }
  button:disabled { opacity: .4; cursor: not-allowed; }
</style>
