<script lang="ts">
  import { sim } from '$lib/simulator.svelte';

  let { side = 'LL', label = 'Lateral Izquierdo' }: { side?: 'LL' | 'RL'; label?: string } = $props();

  const W = 280;
  const H = 160;
  const T_MIN = -80;
  const T_MAX = 280;
  const V_MAX = 260;
  const PAD = { l: 28, r: 8, t: 8, b: 18 };
  const PW = W - PAD.l - PAD.r;
  const PH = H - PAD.t - PAD.b;

  // signo: leftward (LL) lo invertimos para que pico apunte hacia arriba (convención vHIT)
  let flip = $derived(side === 'LL' ? -1 : 1);
  let sideColor = $derived(side === 'LL' ? 'var(--side-ll)' : 'var(--side-rl)');

  let impulses = $derived(side === 'LL' ? sim.impulsesLL : sim.impulsesRL);
  let gain = $derived(impulses.length === 0 ? 0 : impulses.reduce((a, i) => a + i.gain, 0) / impulses.length);
  let gainColor = $derived(gain >= 0.8 ? 'var(--success)' : gain >= 0.6 ? 'var(--warn)' : 'var(--danger)');

  function xScale(t: number) {
    return PAD.l + ((t - T_MIN) / (T_MAX - T_MIN)) * PW;
  }
  function yScale(v: number) {
    return PAD.t + PH - ((v + V_MAX) / (2 * V_MAX)) * PH;
  }
  function pathFor(t: Float64Array, v: Float64Array, sign: number): string {
    if (t.length === 0) return '';
    let d = '';
    for (let i = 0; i < t.length; i++) {
      const x = xScale(t[i]);
      const y = yScale(sign * v[i]);
      d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1);
    }
    return d;
  }
</script>

<div class="card impulse" style:--side={sideColor}>
  <div class="card-title">
    <span class="side-tag">{side}</span> {label}
    <span class="count">{impulses.length}</span>
    <span class="gain" style:color={gainColor} title="Ganancia VOR media">
      <span class="gain-lab">gain</span>
      <b>{impulses.length ? gain.toFixed(2) : '—'}</b>
    </span>
    <span class="legend">
      <span><i class="solid"></i>cabeza</span>
      <span><i class="dashed"></i>ojo</span>
    </span>
  </div>
  <div class="card-body">
    <svg viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMid meet" class="plot">
      <!-- grid horizontal -->
      {#each [-200, -100, 0, 100, 200] as v}
        <line x1={PAD.l} x2={W - PAD.r} y1={yScale(v)} y2={yScale(v)} stroke="var(--grid)" stroke-width="1" />
        <text x={PAD.l - 4} y={yScale(v) + 3} text-anchor="end" font-size="9" fill="var(--text-muted)">{v}</text>
      {/each}
      <!-- eje vertical en t=0 -->
      <line x1={xScale(0)} x2={xScale(0)} y1={PAD.t} y2={PAD.t + PH} stroke="var(--border-strong)" stroke-width="1" stroke-dasharray="2 3" />
      <!-- baseline 0 -->
      <line x1={PAD.l} x2={W - PAD.r} y1={yScale(0)} y2={yScale(0)} stroke="var(--border-strong)" stroke-width="1" />
      <!-- eje x ticks -->
      {#each [-50, 0, 100, 200] as t}
        <text x={xScale(t)} y={H - 4} text-anchor="middle" font-size="9" fill="var(--text-muted)">{t}</text>
      {/each}

      {#each impulses as imp (imp.id)}
        <path d={pathFor(imp.t, imp.head, flip)} fill="none" stroke={sideColor} stroke-width="1.6" opacity="0.55" />
        <path d={pathFor(imp.t, imp.eye, flip)} fill="none" stroke={sideColor} stroke-width="1.2" opacity="0.7" stroke-dasharray="3 2" />
      {/each}

      {#if impulses.length === 0}
        <text x={W / 2} y={H / 2} text-anchor="middle" font-size="10" fill="var(--text-muted)">sin impulsos aún</text>
      {/if}
    </svg>
  </div>
</div>

<style>
  .impulse { display: flex; flex-direction: column; min-height: 0; }
  .card-title { display: flex; align-items: center; justify-content: space-between; }
  .card-body { padding: 4px 6px; flex: 1; min-height: 0; display: flex; }
  .plot { width: 100%; height: 100%; min-height: 0; display: block; }
  .impulse { border-top: 3px solid var(--side); }
  .side-tag {
    display: inline-block;
    background: var(--side);
    color: white;
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 10px;
    margin-right: 6px;
  }
  .count {
    background: var(--side);
    color: white;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    opacity: 0.9;
  }
  .card-title { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .gain { display: inline-flex; align-items: baseline; gap: 4px; font-family: ui-monospace, monospace; }
  .gain-lab { font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: .04em; }
  .gain b { font-size: 16px; font-weight: 700; }
  .legend { display: inline-flex; gap: 8px; margin-left: auto; font-size: 10px; text-transform: none; letter-spacing: 0; color: var(--text-muted); }
  .legend span { display: inline-flex; align-items: center; gap: 4px; }
  .legend i {
    width: 14px; height: 0; border-top: 2px solid var(--side);
    display: inline-block;
  }
  .legend i.dashed { border-top-style: dashed; }
</style>
