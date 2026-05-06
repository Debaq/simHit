<script lang="ts">
  let {
    value = 0,
    blinkFrame = null,
    connected = true
  }: {
    value?: number;       // -3..3 (continuous OK, will be rounded)
    blinkFrame?: number | null; // 0..4 when blinking
    connected?: boolean;
  } = $props();

  const HORIZ_FRAMES = 7;     // idx 0..6, center = 3
  const BLINK_FRAMES = 5;     // idx 7..11
  const TOTAL = HORIZ_FRAMES + BLINK_FRAMES;

  let idx = $derived.by(() => {
    if (!connected) return -1; // signal black overlay
    if (blinkFrame !== null && blinkFrame !== undefined) {
      return HORIZ_FRAMES + Math.max(0, Math.min(BLINK_FRAMES - 1, blinkFrame));
    }
    const clamped = Math.max(-3, Math.min(3, value));
    return 3 + Math.round(clamped);
  });

  let posPct = $derived(idx >= 0 ? (idx / (TOTAL - 1)) * 100 : 0);
</script>

<div class="card eye-card">
  <div class="card-title">Ojo</div>
  <div class="eye-wrap">
    <div class="eye-frame" class:disconnected={!connected} style:background-position-y="{posPct}%"></div>
    <div class="meta">
      <span>posición: <code>{value.toFixed(1)}</code></span>
      <span>frame: <code>{idx}</code></span>
      <span class:on={connected} class="conn-dot">{connected ? 'conectado' : 'sin señal'}</span>
    </div>
  </div>
</div>

<style>
  .eye-card { display: flex; flex-direction: column; }
  .eye-wrap {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 16px;
    gap: 12px;
  }
  .eye-frame {
    width: 100%;
    max-width: 520px;
    aspect-ratio: 640 / 360;
    background-image: url('/eye/sprite.webp');
    background-repeat: no-repeat;
    background-size: 100% 1200%;
    background-position-x: 0;
    border-radius: 10px;
    border: 1px solid var(--border);
    box-shadow: var(--shadow-sm);
    background-color: #000;
  }
  .eye-frame.disconnected {
    background-image: none;
  }
  .meta {
    display: flex; gap: 16px; align-items: center;
    font-size: 12px; color: var(--text-muted);
  }
  code {
    background: var(--primary-soft);
    color: var(--primary);
    padding: 1px 6px; border-radius: 4px;
    font-size: 12px;
  }
  .conn-dot {
    display: inline-flex; align-items: center; gap: 6px;
    text-transform: uppercase; letter-spacing: .04em; font-size: 10px;
  }
  .conn-dot::before {
    content: ''; width: 8px; height: 8px; border-radius: 50%;
    background: #cbd5e1;
  }
  .conn-dot.on { color: var(--success); }
  .conn-dot.on::before { background: var(--success); box-shadow: 0 0 0 3px rgba(22,163,74,.15); }
</style>
