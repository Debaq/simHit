<script lang="ts">
  import { eyeset, FRAMES_COUNT } from '$lib/eyeset.svelte';
  import { onMount } from 'svelte';

  let {
    value = 0,
    blinkFrame = null,
    connected = true,
    showTracker = true,
  }: {
    value?: number;
    blinkFrame?: number | null;
    connected?: boolean;
    showTracker?: boolean;
  } = $props();

  onMount(() => eyeset.load());

  const HORIZ_FRAMES = 7;
  const BLINK_FRAMES = 5;
  const TOTAL = HORIZ_FRAMES + BLINK_FRAMES;

  let idx = $derived.by(() => {
    if (!connected) return -1;
    if (blinkFrame !== null && blinkFrame !== undefined) {
      return HORIZ_FRAMES + Math.max(0, Math.min(BLINK_FRAMES - 1, blinkFrame));
    }
    const clamped = Math.max(-3, Math.min(3, value));
    return 3 + Math.round(clamped);
  });

  let posPct = $derived(idx >= 0 ? (idx / (TOTAL - 1)) * 100 : 0);
  let active = $derived(eyeset.active);
  let marker = $derived(idx >= 0 && showTracker && active ? active.pupils[idx] : null);
  let customSrc = $derived(active && !active.builtin && idx >= 0 ? (active.frameUrls?.[idx] ?? '') : '');
</script>

<div class="card eye-card">
  <div class="card-title">Ojo</div>
  <div class="eye-wrap">
    <div class="eye-frame" class:disconnected={!connected}>
      {#if !connected}
        <!-- bloque negro -->
      {:else if active?.builtin}
        <div
          class="sprite"
          style:background-image="url({active.spriteUrl})"
          style:background-position-y="{posPct}%"
        ></div>
      {:else if customSrc}
        <img class="sprite img" src={customSrc} alt="" />
      {:else}
        <div class="placeholder">Frame sin imagen</div>
      {/if}

      {#if marker && connected}
        <span class="tracker" style:left="{marker.pupilX * 100}%" style:top="{marker.pupilY * 100}%">
          <svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" stroke-width="1.5"/><line x1="16" y1="2" x2="16" y2="30" stroke="currentColor" stroke-width="1"/><line x1="2" y1="16" x2="30" y2="16" stroke="currentColor" stroke-width="1"/></svg>
        </span>
      {/if}
    </div>
    <div class="meta">
      <span>posición: <code>{value.toFixed(1)}</code></span>
      <span>frame: <code>{idx}</code></span>
      <span class:on={connected} class="conn-dot">{connected ? 'conectado' : 'sin señal'}</span>
    </div>
  </div>
</div>

<style>
  .eye-card { display: flex; flex-direction: column; }
  .eye-wrap { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 16px; gap: 12px; }
  .eye-frame {
    width: 100%; max-width: 520px;
    aspect-ratio: 640 / 360;
    border-radius: 10px;
    border: 1px solid var(--border);
    box-shadow: var(--shadow-sm);
    background-color: #000;
    position: relative;
    overflow: hidden;
  }
  .sprite {
    width: 100%; height: 100%;
    background-repeat: no-repeat;
    background-size: 100% 1200%;
    background-position-x: 0;
  }
  .sprite.img { object-fit: cover; display: block; }
  .placeholder {
    width: 100%; height: 100%;
    display: flex; align-items: center; justify-content: center;
    color: #888; font-size: 12px; font-style: italic;
  }
  .tracker {
    position: absolute;
    width: 36px; height: 36px;
    transform: translate(-50%, -50%);
    pointer-events: none;
    color: #ec4899;
    filter: drop-shadow(0 0 1px rgba(0,0,0,0.6));
  }
  .tracker svg { width: 100%; height: 100%; }
  .meta { display: flex; gap: 16px; align-items: center; font-size: 12px; color: var(--text-muted); }
  code { background: var(--primary-soft); color: var(--primary); padding: 1px 6px; border-radius: 4px; font-size: 12px; }
  .conn-dot { display: inline-flex; align-items: center; gap: 6px; text-transform: uppercase; letter-spacing: .04em; font-size: 10px; }
  .conn-dot::before { content: ''; width: 8px; height: 8px; border-radius: 50%; background: #cbd5e1; }
  .conn-dot.on { color: var(--success); }
  .conn-dot.on::before { background: var(--success); box-shadow: 0 0 0 3px rgba(22,163,74,.15); }
</style>
