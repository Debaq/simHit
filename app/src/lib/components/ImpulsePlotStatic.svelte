<script lang="ts">
  import type { ImpulseSnapshot, Side } from '$lib/report.svelte';
  let { side, impulses }: { side: Side; impulses: ImpulseSnapshot[] } = $props();

  const W = 320, H = 180;
  const T_MIN = -80, T_MAX = 280, V_MAX = 260;
  const PAD = { l: 32, r: 8, t: 8, b: 22 };
  const PW = W - PAD.l - PAD.r;
  const PH = H - PAD.t - PAD.b;
  let flip = $derived(side === 'LL' ? -1 : 1);
  let sideColor = $derived(side === 'LL' ? 'var(--side-ll)' : 'var(--side-rl)');

  function xScale(t: number) { return PAD.l + ((t - T_MIN) / (T_MAX - T_MIN)) * PW; }
  function yScale(v: number) { return PAD.t + PH - ((v + V_MAX) / (2 * V_MAX)) * PH; }
  function pathFor(t: number[], v: number[], sign: number): string {
    if (!t.length) return '';
    let d = '';
    for (let i = 0; i < t.length; i++) {
      d += (i === 0 ? 'M' : 'L') + xScale(t[i]).toFixed(1) + ',' + yScale(sign * v[i]).toFixed(1);
    }
    return d;
  }
</script>

<svg viewBox="0 0 {W} {H}" class="plot" style:--side={sideColor}>
  {#each [-200, -100, 0, 100, 200] as v}
    <line x1={PAD.l} x2={W - PAD.r} y1={yScale(v)} y2={yScale(v)} stroke="var(--grid)" />
    <text x={PAD.l - 4} y={yScale(v) + 3} text-anchor="end" font-size="9" fill="var(--text-muted)">{v}</text>
  {/each}
  <line x1={xScale(0)} x2={xScale(0)} y1={PAD.t} y2={PAD.t + PH} stroke="var(--border-strong)" stroke-dasharray="2 3" />
  <line x1={PAD.l} x2={W - PAD.r} y1={yScale(0)} y2={yScale(0)} stroke="var(--border-strong)" />
  {#each [-50, 0, 100, 200] as t}
    <text x={xScale(t)} y={H - 8} text-anchor="middle" font-size="9" fill="var(--text-muted)">{t}</text>
  {/each}
  <text x={W / 2} y={H - 1} text-anchor="middle" font-size="9" fill="var(--text-muted)">tiempo (ms)</text>
  {#each impulses as imp (imp.id)}
    <path d={pathFor(imp.t, imp.head, flip)} fill="none" stroke={sideColor} stroke-width="1.6" opacity="0.55" />
    <path d={pathFor(imp.t, imp.eye, flip)} fill="none" stroke={sideColor} stroke-width="1.2" opacity="0.7" stroke-dasharray="3 2" />
  {/each}
  {#if impulses.length === 0}
    <text x={W / 2} y={H / 2} text-anchor="middle" font-size="11" fill="var(--text-muted)">sin impulsos</text>
  {/if}
</svg>

<style>
  .plot { width: 100%; height: auto; display: block; }
</style>
