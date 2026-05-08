<script lang="ts">
  import { eyeset, type Frame } from '$lib/eyeset.svelte';
  import { sim } from '$lib/simulator.svelte';
  import { onMount } from 'svelte';

  let {
    value = 0,
    valueY = 0,
    blinkFrame = null,
    connected = true,
    showTracker = true,
  }: {
    value?: number;
    valueY?: number;
    blinkFrame?: number | null;
    connected?: boolean;
    showTracker?: boolean;
  } = $props();

  onMount(() => eyeset.load());

  let active = $derived(eyeset.active);

  // Selección de frame en función de (value, valueY) en grilla -3..3 o blinkFrame.
  // value > 0 → paciente derecha; valueY > 0 → arriba.
  let currentFrame = $derived.by<Frame | null>(() => {
    if (!connected || !active) return null;
    if (blinkFrame !== null && blinkFrame !== undefined) {
      const arr = active.blink;
      if (arr.length === 0) return null;
      const idx = Math.max(0, Math.min(arr.length - 1, Math.round(blinkFrame)));
      return arr[idx];
    }
    const rx = Math.round(Math.max(-3, Math.min(3, value)));
    const ry = Math.round(Math.max(-3, Math.min(3, valueY)));
    if (rx === 0 && ry === 0) return active.centerFrame;
    let rayKey: keyof typeof active.rays;
    if (rx === 0) rayKey = ry > 0 ? 'up' : 'down';
    else if (ry === 0) rayKey = rx > 0 ? 'right' : 'left';
    else if (rx > 0) rayKey = ry > 0 ? 'upRight' : 'downRight';
    else rayKey = ry > 0 ? 'upLeft' : 'downLeft';
    const arr = active.rays[rayKey];
    if (arr.length === 0) return active.centerFrame;
    const mag = Math.max(Math.abs(rx), Math.abs(ry));
    return arr[Math.min(arr.length - 1, mag - 1)];
  });

  let bgImage = $derived.by(() => {
    if (!currentFrame) return '';
    if (currentFrame.spriteY !== undefined && active?.spriteUrl) return `url(${active.spriteUrl})`;
    if (currentFrame.url) return `url(${currentFrame.url})`;
    return '';
  });
  let bgPosY = $derived(currentFrame?.spriteY ?? 0);
  let isSprite = $derived(!!(currentFrame?.spriteY !== undefined && active?.spriteUrl));
  let marker = $derived(showTracker && currentFrame ? { x: currentFrame.pupilX, y: currentFrame.pupilY } : null);
  let hasMarker = $derived(!!marker && (marker.x !== 0 || marker.y !== 0));
</script>

<div class="card eye-card">
  <div class="card-title">Ojo</div>
  <div class="eye-wrap">
    <div class="eye-frame" class:disconnected={!connected}>
      {#if !connected}
        <!-- bloque negro -->
      {:else if bgImage}
        <div
          class="sprite"
          class:fit={!isSprite}
          style:background-image={bgImage}
          style:background-position-y={isSprite ? `${bgPosY}%` : '50%'}
        ></div>
      {:else}
        <div class="placeholder">Frame sin imagen</div>
      {/if}

      {#if hasMarker && connected && marker}
        <span class="tracker" style:left="{marker.x * 100}%" style:top="{marker.y * 100}%">
          <svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" stroke-width="1.5"/><line x1="16" y1="2" x2="16" y2="30" stroke="currentColor" stroke-width="1"/><line x1="2" y1="16" x2="30" y2="16" stroke="currentColor" stroke-width="1"/></svg>
        </span>
      {/if}
    </div>
    <div class="meta">
      <span>x: <code>{value.toFixed(1)}</code></span>
      <span>y: <code>{valueY.toFixed(1)}</code></span>
      {#if currentFrame}<span>frame: <code>{currentFrame.id}</code></span>{/if}
      <button
        type="button"
        class="blink-toggle"
        class:off={!sim.blinkEnabled}
        onclick={() => (sim.blinkEnabled = !sim.blinkEnabled)}
        title="Activar/desactivar parpadeo"
      >Parpadeo: {sim.blinkEnabled ? 'ON' : 'OFF'}</button>
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
  .sprite.fit { background-size: cover; background-position: center; }
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
  .meta { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; font-size: 12px; color: var(--text-muted); }
  .blink-toggle {
    border: 1px solid var(--border); background: var(--primary-soft); color: var(--primary);
    padding: 2px 8px; border-radius: 4px; font-size: 11px; cursor: pointer;
    text-transform: uppercase; letter-spacing: .04em;
  }
  .blink-toggle.off { background: transparent; color: var(--text-muted); }
  code { background: var(--primary-soft); color: var(--primary); padding: 1px 6px; border-radius: 4px; font-size: 12px; }
  .conn-dot { display: inline-flex; align-items: center; gap: 6px; text-transform: uppercase; letter-spacing: .04em; font-size: 10px; }
  .conn-dot::before { content: ''; width: 8px; height: 8px; border-radius: 50%; background: #cbd5e1; }
  .conn-dot.on { color: var(--success); }
  .conn-dot.on::before { background: var(--success); box-shadow: 0 0 0 3px rgba(22,163,74,.15); }
</style>
