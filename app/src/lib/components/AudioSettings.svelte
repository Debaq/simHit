<script lang="ts">
  import { audio } from '$lib/audio.svelte';

  let { open, onClose }: { open: boolean; onClose: () => void } = $props();

  function onKey(e: KeyboardEvent) {
    if (open && e.key === 'Escape') onClose();
  }
</script>

<svelte:window onkeydown={onKey} />

{#if open}
  <div class="backdrop" onclick={onClose} role="presentation">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1">
      <header class="head">
        <span>Configuración de sonido</span>
        <button class="close" onclick={onClose} aria-label="Cerrar">✕</button>
      </header>

      <div class="body">
        <section class="block">
          <label class="row toggle">
            <input type="checkbox" checked={audio.enabled} onchange={() => audio.toggleEnabled()} />
            <span><b>Sonido activo</b><span class="muted small">Beeps post-impulso y metrónomo.</span></span>
          </label>
          <label class="row">
            <span>Volumen</span>
            <input type="range" min="0" max="1" step="0.05" bind:value={audio.volume} />
            <span class="val">{Math.round(audio.volume * 100)}%</span>
          </label>
        </section>

        <section class="block">
          <h3>Beep de impulso aceptado</h3>
          <div class="grid">
            <label class="row">
              <span>Frecuencia</span>
              <input type="range" min="200" max="1600" step="20" bind:value={audio.okTone.freq} />
              <span class="val">{audio.okTone.freq} Hz</span>
            </label>
            <label class="row">
              <span>Duración</span>
              <input type="range" min="40" max="400" step="10" bind:value={audio.okTone.durMs} />
              <span class="val">{audio.okTone.durMs} ms</span>
            </label>
            <label class="row">
              <span>Onda</span>
              <select bind:value={audio.okTone.type}>
                <option value="sine">sine</option>
                <option value="triangle">triangle</option>
                <option value="square">square</option>
                <option value="sawtooth">sawtooth</option>
              </select>
              <button class="prev" onclick={() => audio.beepOk()}>▶ probar</button>
            </label>
          </div>
        </section>

        <section class="block">
          <h3>Beep de impulso rechazado</h3>
          <div class="grid">
            <label class="row">
              <span>Frecuencia</span>
              <input type="range" min="100" max="1200" step="20" bind:value={audio.errorTone.freq} />
              <span class="val">{audio.errorTone.freq} Hz</span>
            </label>
            <label class="row">
              <span>Duración</span>
              <input type="range" min="60" max="600" step="10" bind:value={audio.errorTone.durMs} />
              <span class="val">{audio.errorTone.durMs} ms</span>
            </label>
            <label class="row">
              <span>Onda</span>
              <select bind:value={audio.errorTone.type}>
                <option value="sine">sine</option>
                <option value="triangle">triangle</option>
                <option value="square">square</option>
                <option value="sawtooth">sawtooth</option>
              </select>
              <button class="prev" onclick={() => audio.beepError()}>▶ probar</button>
            </label>
          </div>
        </section>

        <section class="block">
          <label class="row toggle">
            <input type="checkbox" checked={audio.metroEnabled} onchange={() => audio.toggleMetro()} />
            <span><b>Metrónomo</b><span class="muted small">Marca el ritmo para entrenar a estudiantes.</span></span>
          </label>
          <div class="grid" class:dim={!audio.metroEnabled}>
            <label class="row">
              <span>BPM</span>
              <input type="range" min="20" max="180" step="2" bind:value={audio.metroBpm}
                     onchange={() => audio.metroEnabled && audio.startMetronome()} />
              <span class="val">{audio.metroBpm}</span>
            </label>
            <label class="row">
              <span>Acento cada</span>
              <input type="number" min="0" max="16" bind:value={audio.metroAccentEvery} />
              <span class="muted small">pulsos (0 = sin acento)</span>
            </label>
          </div>
        </section>

        <p class="hint muted small">
          Los sonidos se sintetizan en el navegador. El primer click activa el contexto de audio.
        </p>
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
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius); box-shadow: 0 20px 60px rgba(0,0,0,.25);
    width: 100%; max-width: 560px; max-height: calc(100vh - 80px);
    display: flex; flex-direction: column; overflow: hidden;
  }
  .head {
    display: flex; justify-content: space-between; align-items: center;
    padding: 10px 14px; border-bottom: 1px solid var(--border);
    background: var(--surface-2); font-weight: 600; font-size: 13px;
  }
  .close {
    border: none; background: transparent; font-size: 16px; color: var(--text-muted);
    width: 30px; height: 30px; border-radius: var(--radius-sm); cursor: pointer;
  }
  .close:hover { background: var(--primary-soft); color: var(--primary); }
  .body { padding: 12px 16px; overflow: auto; display: flex; flex-direction: column; gap: 14px; }
  .block { border-top: 1px solid var(--border); padding-top: 10px; }
  .block:first-child { border-top: none; padding-top: 0; }
  h3 { margin: 0 0 8px; font-size: 11px; text-transform: uppercase; color: var(--text-muted); letter-spacing: .05em; }
  .grid { display: flex; flex-direction: column; gap: 6px; }
  .grid.dim { opacity: .5; pointer-events: none; }
  .row {
    display: grid; grid-template-columns: 90px 1fr auto auto; gap: 10px; align-items: center;
    font-size: 12px;
  }
  .row > span:first-child { color: var(--text-muted); font-weight: 600; }
  .row.toggle { grid-template-columns: auto 1fr; }
  .row.toggle b { display: block; }
  .val { font-family: ui-monospace, monospace; font-size: 12px; min-width: 60px; text-align: right; color: var(--text-muted); }
  input[type="range"] { width: 100%; accent-color: var(--primary); }
  input[type="number"] {
    width: 60px; padding: 3px 6px; font-size: 12px;
    border: 1px solid var(--border-strong); border-radius: var(--radius-sm);
    background: var(--surface); color: var(--text); font-family: ui-monospace, monospace;
  }
  select {
    font: inherit; font-size: 12px; padding: 3px 8px;
    border: 1px solid var(--border-strong); border-radius: var(--radius-sm);
    background: var(--surface); color: var(--text);
  }
  .prev { padding: 3px 10px; font-size: 11px; }
  .muted { color: var(--text-muted); }
  .small { font-size: 11px; }
  .hint { margin: 0; padding-top: 4px; }
</style>
