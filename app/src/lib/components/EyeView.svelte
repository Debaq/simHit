<script lang="ts">
  let { value = 0 }: { value?: number } = $props();
  // value ∈ [-14, 14] → sprite index ∈ [0, 28]
  const FRAMES = 29;
  let idx = $derived(Math.max(0, Math.min(FRAMES - 1, Math.round(value) + 14)));
  let posPct = $derived((idx / (FRAMES - 1)) * 100);
</script>

<div class="card eye-card">
  <div class="card-title">Ojo</div>
  <div class="eye-wrap">
    <div class="eye-frame" style:background-position-y="{posPct}%"></div>
    <div class="meta">
      <span>posición: <code>{value}</code></span>
      <span>frame: <code>{idx}</code></span>
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
    max-width: 480px;
    aspect-ratio: 400 / 240;
    background-image: url('/eye/sprite.webp');
    background-repeat: no-repeat;
    background-size: 100% 2900%;
    background-position-x: 0;
    border-radius: 8px;
    border: 1px solid var(--border);
    box-shadow: var(--shadow-sm);
    image-rendering: auto;
  }
  .meta {
    display: flex; gap: 16px;
    font-size: 12px; color: var(--text-muted);
  }
  code {
    background: var(--primary-soft);
    color: var(--primary);
    padding: 1px 6px; border-radius: 4px;
    font-size: 12px;
  }
</style>
