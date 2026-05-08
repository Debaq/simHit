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
    // Colores distintos a side-ll (azul) y side-rl (rojo) para no confundir lados.
    const head = '#111827';   // gris carbón → cabeza
    const eye  = '#ca8a04';   // ámbar → ojo
    const grid = css.getPropertyValue('--grid').trim() || '#ede9fe';
    const muted = css.getPropertyValue('--text-muted').trim() || '#64748b';

    const r = host.getBoundingClientRect();
    const opts: uPlot.Options = {
      width: Math.max(200, Math.floor(r.width)),
      height: Math.max(120, Math.floor(r.height)),
      padding: [8, 12, 0, 0],
      scales: {
        x: { time: false },
        // Autoscale con piso ±260°/s para que picos altos no se corten.
        y: {
          range: (_u, dataMin, dataMax) => {
            const m = Math.max(260, Math.abs(dataMin ?? 0), Math.abs(dataMax ?? 0)) * 1.1;
            return [-m, m];
          },
        },
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
          label: 'velocidad angular (°/s)',
          labelSize: 26,
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
      <span><i style:background="#111827"></i><b>Cabeza</b> (gyro)</span>
      <span><i style:background="#ca8a04"></i><b>Ojo</b> (VOR)</span>
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
    display: flex; gap: 14px; font-size: 12px;
    text-transform: none; letter-spacing: 0;
    color: var(--text);
  }
  .legend span { display: inline-flex; align-items: center; gap: 6px; }
  .legend b { font-weight: 700; }
  .legend i { width: 18px; height: 4px; border-radius: 2px; display: inline-block; }
  :global(.uplot) { font-family: inherit; }
  :global(.uplot .u-legend) { display: none; }
</style>
