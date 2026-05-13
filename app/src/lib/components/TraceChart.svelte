<script lang="ts">
  import { onMount } from 'svelte';
  import uPlot from 'uplot';
  import 'uplot/dist/uPlot.min.css';
  import { sim, CHANNEL_AXES } from '$lib/simulator.svelte';
  import type { Channel } from '$lib/scenario.svelte';
  import { acceptance } from '$lib/acceptance.svelte';

  let { title = 'Tiempo real', hideEye = false, showPeakBands = false, channel = null }:
    { title?: string; hideEye?: boolean; showPeakBands?: boolean; channel?: Channel | null } = $props();
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
      series: hideEye
        ? [{}, { label: 'cabeza', stroke: head, width: 1.5 }]
        : [
            {},
            { label: 'cabeza', stroke: head, width: 1.5 },
            { label: 'ojo', stroke: eye, width: 1.5 },
          ],
      cursor: { drag: { x: false, y: false }, points: { show: false } },
      legend: { show: false },
      hooks: {
        drawClear: showPeakBands
          ? [
              (u) => {
                const cfg = acceptance.active;
                if (!cfg) return;
                const isVertical = !!channel && channel !== 'LL' && channel !== 'RL';
                const peakMin = isVertical ? cfg.peakMinV : cfg.peakMinH;
                const peakMax = isVertical ? cfg.peakMaxV : cfg.peakMaxH;
                const ctx = u.ctx;
                const left = u.bbox.left;
                const top = u.bbox.top;
                const w = u.bbox.width;
                const h = u.bbox.height;
                ctx.save();
                ctx.beginPath();
                ctx.rect(left, top, w, h);
                ctx.clip();

                // Bandas verdes (zona ok) y líneas dashed
                ctx.fillStyle = 'rgba(34,197,94,0.08)';
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
                ctx.fillText(`+${peakMax} °/s`, left + 4, u.valToPos(peakMax, 'y', true) - 2);
                ctx.fillText(`+${peakMin} °/s`, left + 4, u.valToPos(peakMin, 'y', true) - 2);
                ctx.textBaseline = 'top';
                ctx.fillText(`-${peakMin} °/s`, left + 4, u.valToPos(-peakMin, 'y', true) + 2);
                ctx.fillText(`-${peakMax} °/s`, left + 4, u.valToPos(-peakMax, 'y', true) + 2);
                ctx.restore();
              },
            ]
          : [],
      },
    };

    // Proyecta la velocidad cefálica sobre el eje del canal activo si se
    // pasa `channel`. Para LL/RL coincide con yaw; para verticales combina
    // yaw + pitch para que el gráfico refleje el eje compuesto del canal.
    const projectedHead = (): Float64Array => {
      if (!channel || channel === 'LL' || channel === 'RL') {
        // LL/RL: ya es ±yaw. Usar headBuf directo (con signo).
        return sim.headBuf;
      }
      const axis = CHANNEL_AXES[channel];
      const n = sim.headBuf.length;
      const out = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        out[i] = sim.headBuf[i] * axis.yaw + sim.headPitchBuf[i] * axis.pitch;
      }
      return out;
    };

    const buildData = () => (hideEye
      ? [sim.tBuf, projectedHead()]
      : [sim.tBuf, projectedHead(), sim.eyeBuf]) as unknown as uPlot.AlignedData;

    plot = new uPlot(opts, buildData(), container);

    const tick = () => {
      if (plot && sim.connected) {
        plot.setData(buildData(), true);
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
      {#if !hideEye}
        <span><i style:background="#ca8a04"></i><b>Ojo</b> (VOR)</span>
      {/if}
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
