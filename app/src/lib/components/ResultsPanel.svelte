<script lang="ts">
  import { sim } from '$lib/simulator.svelte';

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
    <div class="actions">
      <button
        class="primary"
        disabled={!sim.connected}
        onclick={() => (sim.running ? sim.stopRunning() : sim.startRunning())}
      >
        {sim.running ? '■ Detener' : '▶ Iniciar test'}
      </button>
      <button onclick={() => sim.clearImpulses()}>Limpiar</button>
      <button disabled>Exportar</button>
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
  .actions {
    grid-column: 1 / -1;
    display: flex; gap: 8px;
    justify-content: center;
  }
  button:disabled { opacity: .4; cursor: not-allowed; }
</style>
