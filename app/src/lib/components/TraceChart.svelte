<script lang="ts">
  import { onMount } from 'svelte';
  import uPlot from 'uplot';
  import 'uplot/dist/uPlot.min.css';
  import { sim } from '$lib/simulator.svelte';

  let { title = 'Tiempo real' }: { title?: string } = $props();
  let host: HTMLDivElement;
  let container: HTMLDivElement;
  let plot: uPlot | undefined;
  let raf = 0;

  onMount(() => {
    const css = getComputedStyle(document.documentElement);
    const head = css.getPropertyValue('--head-color').trim() || '#7c3aed';
    const eye = css.getPropertyValue('--eye-color').trim() || '#f59e0b';
    const grid = css.getPropertyValue('--grid').trim() || '#ede9fe';
    const muted = css.getPropertyValue('--text-muted').trim() || '#64748b';

    const r = host.getBoundingClientRect();
    const opts: uPlot.Options = {
      width: Math.max(200, Math.floor(r.width)),
      height: Math.max(120, Math.floor(r.height)),
      padding: [8, 12, 0, 0],
      scales: {
        x: { time: false },
        y: { range: [-260, 260] },
      },
      axes: [
        {
          stroke: muted,
          grid: { stroke: grid, width: 1 },
          ticks: { stroke: grid },
          values: (_, vals) => vals.map((v) => v.toFixed(1) + 's'),
        },
        {
          stroke: muted,
          grid: { stroke: grid, width: 1 },
          ticks: { stroke: grid },
          label: '°/s',
          labelSize: 24,
        },
      ],
      series: [
        {},
        { label: 'cabeza', stroke: head, width: 1.5 },
        { label: 'ojo', stroke: eye, width: 1.5 },
      ],
      cursor: { drag: { x: false, y: false }, points: { show: false } },
      legend: { show: false },
    };

    plot = new uPlot(
      opts,
      [sim.tBuf, sim.headBuf, sim.eyeBuf] as unknown as uPlot.AlignedData,
      container
    );

    const tick = () => {
      if (plot && sim.connected) {
        plot.setData(
          [sim.tBuf, sim.headBuf, sim.eyeBuf] as unknown as uPlot.AlignedData,
          true
        );
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const ro = new ResizeObserver(() => {
      if (!plot || !host) return;
      const r2 = host.getBoundingClientRect();
      plot.setSize({
        width: Math.max(200, Math.floor(r2.width)),
        height: Math.max(120, Math.floor(r2.height)),
      });
    });
    ro.observe(host);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      plot?.destroy();
    };
  });
</script>

<div class="card chart">
  <div class="card-title">
    {title}
    <span class="legend">
      <span><i style:background="var(--head-color)"></i>Cabeza</span>
      <span><i style:background="var(--eye-color)"></i>Ojo</span>
    </span>
  </div>
  <div bind:this={host} class="plot-host">
    <div bind:this={container} class="plot-inner"></div>
  </div>
</div>

<style>
  .chart { display: flex; flex-direction: column; min-height: 0; flex: 1; height: 100%; }
  .card-title {
    display: flex; justify-content: space-between; align-items: center;
  }
  .plot-host {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  .plot-inner {
    position: absolute;
    inset: 0;
  }
  .legend {
    display: flex; gap: 12px; font-size: 11px;
    text-transform: none; letter-spacing: 0;
  }
  .legend span { display: inline-flex; align-items: center; gap: 5px; }
  .legend i { width: 10px; height: 3px; border-radius: 2px; display: inline-block; }
  :global(.uplot) { font-family: inherit; }
  :global(.uplot .u-legend) { display: none; }
</style>
