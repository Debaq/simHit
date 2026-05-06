<script lang="ts">
  let { value = 0 }: { value?: number } = $props();
  // value ∈ [-14, 14]
  const max = 14;
  let pct = $derived(value / max);
  let pupilX = $derived(50 + pct * 28);
</script>

<div class="card eye-card">
  <div class="card-title">Ojo</div>
  <div class="eye-wrap">
    <svg viewBox="0 0 100 100" class="eye">
      <defs>
        <radialGradient id="iris" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#5b21b6" />
          <stop offset="70%" stop-color="#7c3aed" />
          <stop offset="100%" stop-color="#3730a3" />
        </radialGradient>
        <radialGradient id="sclera" cx="50%" cy="45%" r="60%">
          <stop offset="0%" stop-color="#ffffff" />
          <stop offset="100%" stop-color="#ede9fe" />
        </radialGradient>
      </defs>
      <ellipse cx="50" cy="50" rx="45" ry="28" fill="url(#sclera)" stroke="var(--border-strong)" stroke-width="0.5" />
      <circle cx={pupilX} cy="50" r="14" fill="url(#iris)" />
      <circle cx={pupilX} cy="50" r="6" fill="#0f0a1f" />
      <circle cx={pupilX - 3} cy="47" r="2" fill="white" opacity="0.85" />
    </svg>
    <div class="meta">
      <span>posición: <code>{value}</code></span>
      <span>rango: <code>-14..14</code></span>
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
  .eye {
    width: 100%;
    max-width: 360px;
    aspect-ratio: 100 / 60;
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
