<script lang="ts">
  let { gainLL = 0, gainRL = 0, impulsesLL = 0, impulsesRL = 0 }: {
    gainLL?: number; gainRL?: number; impulsesLL?: number; impulsesRL?: number;
  } = $props();

  const fmt = (n: number) => n.toFixed(2);
  const gainColor = (g: number) => g >= 0.8 ? 'var(--success)' : g >= 0.6 ? 'var(--warn)' : 'var(--danger)';
</script>

<div class="card results">
  <div class="card-title">Resultados</div>
  <div class="card-body grid">
    <div class="metric">
      <div class="m-label">Ganancia LL</div>
      <div class="m-value" style:color={gainColor(gainLL)}>{fmt(gainLL)}</div>
      <div class="m-sub">{impulsesLL} impulsos</div>
    </div>
    <div class="metric">
      <div class="m-label">Ganancia RL</div>
      <div class="m-value" style:color={gainColor(gainRL)}>{fmt(gainRL)}</div>
      <div class="m-sub">{impulsesRL} impulsos</div>
    </div>
    <div class="actions">
      <button class="primary">Iniciar test</button>
      <button>Limpiar</button>
      <button>Exportar</button>
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
</style>
