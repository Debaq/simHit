<script lang="ts">
  let { side = 'LL', label = 'Lateral Izquierdo' }: { side?: 'LL' | 'RL'; label?: string } = $props();
  let traces = $derived(side === 'LL'
    ? [
        'M0,140 Q60,40 130,80 T260,140',
        'M0,140 Q60,55 130,90 T260,140',
        'M0,140 Q60,30 130,70 T260,140'
      ]
    : [
        'M0,140 Q60,40 130,80 T260,140',
        'M0,140 Q60,50 130,85 T260,140',
        'M0,140 Q60,35 130,75 T260,140'
      ]);
</script>

<div class="card impulse">
  <div class="card-title">
    <span class="side-tag">{side}</span> {label}
  </div>
  <div class="card-body">
    <svg viewBox="0 0 260 160" preserveAspectRatio="none" class="plot">
      {#each [0,1,2,3] as i}
        <line x1="0" x2="260" y1={i*40} y2={i*40} stroke="var(--grid)" stroke-width="1" />
      {/each}
      <line x1="0" x2="260" y1="140" y2="140" stroke="var(--border-strong)" stroke-width="1" />
      {#each traces as d}
        <path {d} fill="none" stroke="var(--head-color)" stroke-width="1.4" opacity="0.4" />
      {/each}
      {#each traces as d}
        <path d={d.replace('Q60,', 'Q60,').replace('T260', 'T260')} fill="none" stroke="var(--eye-color)" stroke-width="1.4" opacity="0.6" />
      {/each}
    </svg>
  </div>
</div>

<style>
  .impulse { display: flex; flex-direction: column; }
  .plot { width: 100%; height: 100%; min-height: 140px; }
  .side-tag {
    display: inline-block;
    background: var(--primary);
    color: white;
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 10px;
    margin-right: 6px;
  }
</style>
