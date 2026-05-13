<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import uPlot from 'uplot';
  import 'uplot/dist/uPlot.min.css';

  let {
    t, head, eye, hideEye = false,
    peakMin, peakMax, durMinMs, durMaxMs,
  }: {
    t: number[]; head: number[]; eye: number[]; hideEye?: boolean;
    peakMin?: number; peakMax?: number;
    durMinMs?: number; durMaxMs?: number;
  } = $props();

  let host: HTMLDivElement;
  let container: HTMLDivElement;
  let plot: uPlot | undefined;

  // tiempo en segundos para el eje x
  function buildData(): uPlot.AlignedData {
    const xs = t.map((v) => v / 1000);
    return (hideEye ? [xs, head] : [xs, head, eye]) as unknown as uPlot.AlignedData;
  }

  $effect(() => {
    // Suscribirse a cambios de props para forzar re-render del plot
    void t; void head; void eye; void hideEye;
    if (plot) plot.setData(buildData(), true);
  });

  onMount(() => {
    const css = getComputedStyle(document.documentElement);
    const headCol = '#111827';
    const eyeCol = '#ca8a04';
    const grid = css.getPropertyValue('--grid').trim() || '#ede9fe';
    const muted = css.getPropertyValue('--text-muted').trim() || '#64748b';

    const r = host.getBoundingClientRect();
    const opts: uPlot.Options = {
      width: Math.max(300, Math.floor(r.width)),
      height: Math.max(220, Math.floor(r.height)),
      padding: [8, 12, 0, 0],
      scales: {
        x: { time: false },
        y: {
          range: (_u, dMin, dMax) => {
            const m = Math.max(260, Math.abs(dMin ?? 0), Math.abs(dMax ?? 0)) * 1.1;
            return [-m, m];
          },
        },
      },
      axes: [
        {
          stroke: muted,
          grid: { stroke: grid, width: 1 },
          ticks: { stroke: grid },
          values: (_, vals) => vals.map((v) => v.toFixed(2) + 's'),
        },
        {
          stroke: muted,
          grid: { stroke: grid, width: 1 },
          ticks: { stroke: grid },
          label: '°/s',
          labelSize: 26,
        },
      ],
      series: hideEye
        ? [{}, { label: 'cabeza', stroke: headCol, width: 1.5 }]
        : [
            {},
            { label: 'cabeza', stroke: headCol, width: 1.5 },
            { label: 'ojo', stroke: eyeCol, width: 1.5 },
          ],
      cursor: { drag: { x: false, y: false }, points: { show: true, size: 4 } },
      legend: { show: false },
      hooks: {
        drawClear: [
          (u) => {
            const ctx = u.ctx;
            ctx.save();
            const left = u.bbox.left;
            const top = u.bbox.top;
            const w = u.bbox.width;
            const h = u.bbox.height;
            // Recorte al área del plot
            ctx.beginPath();
            ctx.rect(left, top, w, h);
            ctx.clip();

            // Banda verde horizontal de pico (positivo y negativo, mirror)
            if (peakMin != null && peakMax != null) {
              ctx.fillStyle = 'rgba(34,197,94,0.10)';
              const yA = u.valToPos(peakMax, 'y', true);
              const yB = u.valToPos(peakMin, 'y', true);
              ctx.fillRect(left, yA, w, yB - yA);
              const yC = u.valToPos(-peakMin, 'y', true);
              const yD = u.valToPos(-peakMax, 'y', true);
              ctx.fillRect(left, yC, w, yD - yC);
              ctx.strokeStyle = 'rgba(34,197,94,0.55)';
              ctx.setLineDash([4, 4]);
              ctx.lineWidth = 1;
              for (const v of [peakMin, peakMax, -peakMin, -peakMax]) {
                const y = u.valToPos(v, 'y', true);
                ctx.beginPath();
                ctx.moveTo(left, y);
                ctx.lineTo(left + w, y);
                ctx.stroke();
              }
              ctx.setLineDash([]);
              // Etiquetas
              ctx.fillStyle = 'rgb(22,163,74)';
              ctx.font = '10px ui-monospace, monospace';
              ctx.textBaseline = 'bottom';
              ctx.fillText(`pico ${peakMin}–${peakMax} °/s`, left + 4, u.valToPos(peakMax, 'y', true) - 2);
            }

            // Banda verde vertical de duración
            if (durMinMs != null && durMaxMs != null) {
              const xA = u.valToPos(durMinMs / 1000, 'x', true);
              const xB = u.valToPos(durMaxMs / 1000, 'x', true);
              ctx.fillStyle = 'rgba(34,197,94,0.08)';
              ctx.fillRect(xA, top, xB - xA, h);
              ctx.strokeStyle = 'rgba(34,197,94,0.55)';
              ctx.setLineDash([4, 4]);
              for (const x of [xA, xB]) {
                ctx.beginPath();
                ctx.moveTo(x, top);
                ctx.lineTo(x, top + h);
                ctx.stroke();
              }
              ctx.setLineDash([]);
              ctx.fillStyle = 'rgb(22,163,74)';
              ctx.font = '10px ui-monospace, monospace';
              ctx.textBaseline = 'top';
              ctx.fillText(`dur ${durMinMs}–${durMaxMs} ms`, xA + 4, top + 4);
            }
            ctx.restore();
          },
        ],
      },
    };
    plot = new uPlot(opts, buildData(), container);

    const ro = new ResizeObserver(() => {
      if (!plot || !host) return;
      const r2 = host.getBoundingClientRect();
      plot.setSize({
        width: Math.max(300, Math.floor(r2.width)),
        height: Math.max(220, Math.floor(r2.height)),
      });
    });
    ro.observe(host);
    return () => ro.disconnect();
  });
  onDestroy(() => plot?.destroy());
</script>

<div bind:this={host} class="trace-host">
  <div bind:this={container} class="trace-inner"></div>
</div>

<style>
  .trace-host { position: relative; width: 100%; height: 280px; }
  .trace-inner { position: absolute; inset: 0; }
</style>
