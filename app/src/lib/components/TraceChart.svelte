<script lang="ts">
  let { title = 'Trazado' }: { title?: string } = $props();
</script>

<div class="card chart">
  <div class="card-title">{title}</div>
  <div class="card-body chart-area">
    <svg viewBox="0 0 600 220" preserveAspectRatio="none" class="plot">
      <!-- grid -->
      {#each [0,1,2,3,4] as i}
        <line x1="0" x2="600" y1={i*55} y2={i*55} stroke="var(--grid)" stroke-width="1" />
      {/each}
      {#each [0,1,2,3,4,5,6] as i}
        <line y1="0" y2="220" x1={i*100} x2={i*100} stroke="var(--grid)" stroke-width="1" />
      {/each}
      <!-- baseline -->
      <line x1="0" x2="600" y1="110" y2="110" stroke="var(--border-strong)" stroke-width="1" stroke-dasharray="2 4" />
      <!-- placeholder traces -->
      <path d="M0,110 Q150,30 300,110 T600,110" fill="none" stroke="var(--head-color)" stroke-width="2" opacity="0.85" />
      <path d="M0,110 Q150,50 300,110 T600,110" fill="none" stroke="var(--eye-color)" stroke-width="2" opacity="0.85" />
    </svg>
    <div class="legend">
      <span><i style:background="var(--head-color)"></i>Cabeza</span>
      <span><i style:background="var(--eye-color)"></i>Ojo</span>
    </div>
  </div>
</div>

<style>
  .chart { display: flex; flex-direction: column; }
  .chart-area { flex: 1; display: flex; flex-direction: column; gap: 6px; }
  .plot { width: 100%; height: 100%; min-height: 160px; }
  .legend {
    display: flex; gap: 16px; padding: 4px 4px 0;
    font-size: 12px; color: var(--text-muted);
  }
  .legend span { display: inline-flex; align-items: center; gap: 6px; }
  .legend i { width: 10px; height: 3px; border-radius: 2px; display: inline-block; }
</style>
