<script lang="ts">
  import type { ImpulseSnapshot, Side } from '$lib/report.svelte';

  type Props = {
    open: boolean;
    side: Side;
    /** Lista de canales disponibles. Hoy LL/RL; futuro: 6 canales. */
    channels: { id: Side; label: string; color?: string }[];
    /** Función que devuelve los impulsos para un canal dado */
    impulsesBy: (side: Side) => ImpulseSnapshot[];
    onClose: () => void;
    onChangeSide: (s: Side) => void;
  };

  let { open, side, channels, impulsesBy, onClose, onChangeSide }: Props = $props();

  let focusedId = $state<number | null>(null);
  let excluded = $state<Set<number>>(new Set());
  let mode = $state<'single' | 'overlay'>('single');
  let tWindow = $state<[number, number]>([-50, 250]);
  let normalize = $state(false);

  let impulses = $derived(impulsesBy(side));
  let included = $derived(impulses.filter((i) => !excluded.has(i.id)));
  let focused = $derived(impulses.find((i) => i.id === focusedId) ?? impulses[0] ?? null);

  $effect(() => {
    if (impulses.length && (focusedId == null || !impulses.some((i) => i.id === focusedId))) {
      focusedId = impulses[0]?.id ?? null;
    }
  });

  function sideColor(s: Side) {
    const ch = channels.find((c) => c.id === s);
    if (ch?.color) return ch.color;
    return s === 'LL' ? 'var(--side-ll)' : 'var(--side-rl)';
  }
  let flip = $derived(side === 'LL' ? -1 : 1);

  function peak(arr: number[]) {
    let m = 0;
    for (const v of arr) if (Math.abs(v) > Math.abs(m)) m = v;
    return m;
  }
  function peakTime(t: number[], v: number[]) {
    let im = 0; let mv = 0;
    for (let i = 0; i < v.length; i++) if (Math.abs(v[i]) > Math.abs(mv)) { mv = v[i]; im = i; }
    return t[im] ?? 0;
  }
  function onsetTime(t: number[], v: number[], thr = 30) {
    for (let i = 0; i < v.length; i++) if (Math.abs(v[i]) > thr) return t[i];
    return null;
  }

  // ====== Geometría del gráfico grande ======
  const W = 720, H = 360;
  const PAD = { l: 48, r: 14, t: 14, b: 32 };
  let PW = $derived(W - PAD.l - PAD.r);
  let PH = $derived(H - PAD.t - PAD.b);
  const V_MAX = 280;

  function xScale(t: number) {
    const [a, b] = tWindow;
    return PAD.l + ((t - a) / (b - a)) * PW;
  }
  function yScale(v: number) {
    return PAD.t + PH - ((v + V_MAX) / (2 * V_MAX)) * PH;
  }
  function pathFor(t: number[], v: number[], sign: number, scale: number) {
    if (!t.length) return '';
    let d = '';
    for (let i = 0; i < t.length; i++) {
      d += (i === 0 ? 'M' : 'L') + xScale(t[i]).toFixed(1) + ',' + yScale(sign * v[i] * scale).toFixed(1);
    }
    return d;
  }
  function scaleFor(imp: ImpulseSnapshot) {
    if (!normalize) return 1;
    const ph = peak(imp.head);
    return ph !== 0 ? 200 / Math.abs(ph) : 1;
  }

  function toggleExclude(id: number) {
    const next = new Set(excluded);
    if (next.has(id)) next.delete(id); else next.add(id);
    excluded = next;
  }

  function onKeydown(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === 'Escape') onClose();
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      const idx = impulses.findIndex((i) => i.id === focusedId);
      if (idx >= 0 && idx < impulses.length - 1) focusedId = impulses[idx + 1].id;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      const idx = impulses.findIndex((i) => i.id === focusedId);
      if (idx > 0) focusedId = impulses[idx - 1].id;
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
  <div class="backdrop" onclick={onClose} role="presentation">
    <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
      <header class="head">
        <div class="tabs">
          {#each channels as ch}
            <button
              class="tab"
              class:active={ch.id === side}
              style:--tab-color={sideColor(ch.id)}
              onclick={() => onChangeSide(ch.id)}
            >
              {ch.label}
              <span class="count">{impulsesBy(ch.id).length}</span>
            </button>
          {/each}
        </div>
        <div class="title">Análisis detallado</div>
        <button class="close" onclick={onClose} aria-label="Cerrar">✕</button>
      </header>

      <div class="body">
        <!-- Lista de pruebas -->
        <aside class="list">
          <div class="list-head">
            <span>Pruebas</span>
            <span class="muted">{included.length}/{impulses.length}</span>
          </div>
          {#if impulses.length === 0}
            <p class="empty">Sin impulsos en este canal.</p>
          {/if}
          {#each impulses as imp, idx}
            <div class="trial" class:focused={imp.id === focusedId} class:excluded={excluded.has(imp.id)}>
              <button class="trial-btn" onclick={() => (focusedId = imp.id)}>
                <span class="num">#{idx + 1}</span>
                <span class="g" style:color={sideColor(side)}>g {imp.gain.toFixed(2)}</span>
                <span class="muted small">peak {peak(imp.head).toFixed(0)}°/s</span>
              </button>
              <button
                class="excl-btn"
                title={excluded.has(imp.id) ? 'Incluir' : 'Excluir del cálculo'}
                onclick={() => toggleExclude(imp.id)}
              >{excluded.has(imp.id) ? '⊕' : '⊖'}</button>
            </div>
          {/each}
        </aside>

        <!-- Gráfico principal -->
        <div class="main">
          <div class="toolbar">
            <div class="modes">
              <button class:active={mode === 'single'} onclick={() => (mode = 'single')}>Individual</button>
              <button class:active={mode === 'overlay'} onclick={() => (mode = 'overlay')}>Superpuestas</button>
            </div>
            <label class="tool">
              <input type="checkbox" bind:checked={normalize} /> Normalizar
            </label>
            <div class="tool">
              <span class="muted small">Ventana</span>
              <input type="number" bind:value={tWindow[0]} step="10" /> a
              <input type="number" bind:value={tWindow[1]} step="10" /> ms
            </div>
          </div>

          <svg viewBox="0 0 {W} {H}" class="plot" style:--side={sideColor(side)}>
            <!-- ejes velocidad -->
            {#each [-200, -100, 0, 100, 200] as v}
              <line x1={PAD.l} x2={W - PAD.r} y1={yScale(v)} y2={yScale(v)} stroke="var(--grid)" />
              <text x={PAD.l - 6} y={yScale(v) + 3} text-anchor="end" font-size="10" fill="var(--text-muted)">{v}</text>
            {/each}
            <!-- eje cero -->
            <line x1={PAD.l} x2={W - PAD.r} y1={yScale(0)} y2={yScale(0)} stroke="var(--border-strong)" />
            <line x1={xScale(0)} x2={xScale(0)} y1={PAD.t} y2={PAD.t + PH} stroke="var(--border-strong)" stroke-dasharray="2 3" />
            <!-- ticks tiempo -->
            {#each [-50, 0, 50, 100, 150, 200, 250] as t}
              {#if t >= tWindow[0] && t <= tWindow[1]}
                <text x={xScale(t)} y={H - 12} text-anchor="middle" font-size="10" fill="var(--text-muted)">{t}</text>
              {/if}
            {/each}
            <text x={W / 2} y={H - 2} text-anchor="middle" font-size="10" fill="var(--text-muted)">tiempo (ms)</text>
            <text x={12} y={PAD.t + 8} font-size="10" fill="var(--text-muted)">°/s</text>

            {#if mode === 'overlay'}
              {#each included as imp (imp.id)}
                {@const sc = scaleFor(imp)}
                <path d={pathFor(imp.t, imp.head, flip, sc)} fill="none" stroke={sideColor(side)} stroke-width="1.4" opacity="0.4" />
                <path d={pathFor(imp.t, imp.eye, flip, sc)} fill="none" stroke={sideColor(side)} stroke-width="1.2" opacity="0.55" stroke-dasharray="3 2" />
              {/each}
            {:else if focused}
              {@const sc = scaleFor(focused)}
              <!-- cabeza (sólida) -->
              <path d={pathFor(focused.t, focused.head, flip, sc)} fill="none" stroke={sideColor(side)} stroke-width="2" />
              <!-- ojo (punteado) -->
              <path d={pathFor(focused.t, focused.eye, flip, sc)} fill="none" stroke="var(--accent)" stroke-width="1.6" stroke-dasharray="4 3" />
              <!-- onset cabeza -->
              {#if onsetTime(focused.t, focused.head) != null}
                {@const ot = onsetTime(focused.t, focused.head)}
                {#if ot != null && ot >= tWindow[0] && ot <= tWindow[1]}
                  <line x1={xScale(ot)} x2={xScale(ot)} y1={PAD.t} y2={PAD.t + PH} stroke="var(--success)" stroke-dasharray="2 2" opacity="0.6" />
                {/if}
              {/if}
            {/if}
            {#if !focused && impulses.length === 0}
              <text x={W / 2} y={H / 2} text-anchor="middle" font-size="14" fill="var(--text-muted)">sin impulsos</text>
            {/if}
          </svg>

          <div class="legend">
            <span><i style:background={sideColor(side)}></i>Cabeza</span>
            <span><i class="dashed" style:background="var(--accent)"></i>Ojo</span>
            <span><i class="dashed" style:background="var(--success)"></i>Inicio (head &gt;30°/s)</span>
          </div>
        </div>

        <!-- Métricas -->
        <aside class="metrics">
          <div class="m-head">Métricas</div>
          {#if focused && mode === 'single'}
            <dl>
              <dt>Ganancia VOR</dt><dd><b>{focused.gain.toFixed(2)}</b></dd>
              <dt>Pico cabeza</dt><dd>{peak(focused.head).toFixed(0)} °/s</dd>
              <dt>Pico ojo</dt><dd>{peak(focused.eye).toFixed(0)} °/s</dd>
              <dt>Tiempo pico</dt><dd>{peakTime(focused.t, focused.head).toFixed(0)} ms</dd>
              <dt>Inicio cabeza</dt><dd>{onsetTime(focused.t, focused.head)?.toFixed(0) ?? '—'} ms</dd>
              <dt>Muestras</dt><dd>{focused.t.length}</dd>
            </dl>
          {:else if mode === 'overlay'}
            {@const gains = included.map((i) => i.gain)}
            {@const avg = gains.length ? gains.reduce((a, b) => a + b, 0) / gains.length : 0}
            {@const sd = gains.length ? Math.sqrt(gains.reduce((a, b) => a + (b - avg) ** 2, 0) / gains.length) : 0}
            <dl>
              <dt>Impulsos incluidos</dt><dd>{included.length}</dd>
              <dt>Ganancia media</dt><dd><b>{avg.toFixed(2)}</b></dd>
              <dt>Desv. estándar</dt><dd>{sd.toFixed(2)}</dd>
              <dt>Min / Máx</dt><dd>{gains.length ? `${Math.min(...gains).toFixed(2)} / ${Math.max(...gains).toFixed(2)}` : '—'}</dd>
              <dt>Excluidos</dt><dd>{excluded.size}</dd>
            </dl>
          {/if}
          <div class="hint muted small">
            ↑/↓ navega · Esc cierra
          </div>
        </aside>
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed; inset: 0;
    background: rgba(15, 23, 42, .55);
    backdrop-filter: blur(2px);
    z-index: 100;
    display: flex; align-items: center; justify-content: center;
    padding: 24px;
  }
  .modal {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: 0 20px 60px rgba(0,0,0,.25);
    width: 100%; max-width: 1280px;
    max-height: calc(100vh - 80px);
    display: flex; flex-direction: column;
    overflow: hidden;
  }
  .head {
    display: flex; align-items: center; gap: 16px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
    background: var(--surface-2);
  }
  .title { flex: 1; font-weight: 600; font-size: 13px; color: var(--text-muted); text-align: right; }
  .close {
    border: none; background: transparent; font-size: 16px; color: var(--text-muted);
    width: 32px; height: 32px; border-radius: var(--radius-sm); cursor: pointer;
  }
  .close:hover { background: var(--primary-soft); color: var(--primary); }

  .tabs { display: flex; gap: 4px; }
  .tab {
    --tab-color: var(--primary);
    border: 1px solid var(--border-strong);
    background: var(--surface);
    padding: 6px 12px; border-radius: var(--radius-sm);
    font-size: 12px; font-weight: 600;
    cursor: pointer;
    display: inline-flex; align-items: center; gap: 6px;
  }
  .tab.active { background: var(--tab-color); color: white; border-color: var(--tab-color); }
  .tab .count { font-size: 10px; opacity: .8; background: rgba(0,0,0,.12); padding: 1px 6px; border-radius: 999px; }
  .tab.active .count { background: rgba(255,255,255,.2); }

  .body {
    display: grid;
    grid-template-columns: 220px 1fr 240px;
    gap: 0;
    flex: 1;
    min-height: 0;
  }
  .list, .metrics {
    border-right: 1px solid var(--border);
    background: var(--surface-2);
    overflow: auto;
  }
  .metrics { border-right: none; border-left: 1px solid var(--border); }

  .list-head, .m-head {
    padding: 8px 12px; font-size: 11px; text-transform: uppercase;
    color: var(--text-muted); letter-spacing: .05em; font-weight: 700;
    display: flex; justify-content: space-between;
    border-bottom: 1px solid var(--border);
    position: sticky; top: 0; background: var(--surface-2); z-index: 1;
  }
  .empty { padding: 16px; color: var(--text-muted); font-size: 12px; }
  .trial {
    display: grid; grid-template-columns: 1fr auto; align-items: stretch;
    border-bottom: 1px solid var(--border);
  }
  .trial.focused { background: var(--primary-soft); }
  .trial.excluded { opacity: .5; }
  .trial-btn {
    border: none; background: transparent; padding: 8px 10px;
    text-align: left; cursor: pointer;
    display: flex; align-items: center; gap: 8px;
    font-size: 12px;
  }
  .trial-btn:hover { background: var(--primary-soft); }
  .num { font-family: ui-monospace, monospace; font-weight: 700; color: var(--text-muted); min-width: 28px; }
  .g { font-weight: 700; }
  .small { font-size: 11px; }
  .muted { color: var(--text-muted); }
  .excl-btn {
    border: none; background: transparent; cursor: pointer;
    font-size: 14px; padding: 0 10px; color: var(--text-muted);
  }
  .excl-btn:hover { background: var(--danger); color: white; }

  .main {
    display: flex; flex-direction: column;
    min-width: 0;
    padding: 10px 14px;
  }
  .toolbar {
    display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
    padding-bottom: 8px;
  }
  .modes { display: inline-flex; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); overflow: hidden; }
  .modes button {
    border: none; background: var(--surface); padding: 4px 10px; font-size: 12px; cursor: pointer;
    border-radius: 0;
  }
  .modes button.active { background: var(--primary); color: white; }
  .tool { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; }
  .tool input[type="number"] {
    width: 60px; padding: 3px 6px; font-size: 12px;
    border: 1px solid var(--border-strong); border-radius: var(--radius-sm);
    background: var(--surface); color: var(--text);
    font-family: ui-monospace, monospace;
  }
  .plot { width: 100%; height: auto; flex: 1; min-height: 0; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm); }
  .legend {
    display: flex; gap: 14px; padding-top: 6px;
    font-size: 11px; color: var(--text-muted);
  }
  .legend i {
    display: inline-block; width: 14px; height: 3px; vertical-align: middle;
    margin-right: 4px; border-radius: 2px;
  }
  .legend i.dashed { height: 0; border-top: 2px dashed currentColor; background: transparent; }

  dl {
    margin: 0; padding: 8px 12px;
    display: grid; grid-template-columns: 1fr auto; gap: 4px 10px; font-size: 12px;
  }
  dt { color: var(--text-muted); }
  dd { margin: 0; text-align: right; }
  .hint { padding: 8px 12px; border-top: 1px solid var(--border); font-size: 10px; }
</style>
