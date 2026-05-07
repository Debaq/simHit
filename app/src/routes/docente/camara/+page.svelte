<script lang="ts">
  import { onMount } from 'svelte';
  import TopBar from '$lib/components/TopBar.svelte';
  import { eyeset, FRAMES_COUNT, FRAME_LABELS } from '$lib/eyeset.svelte';

  let selected = $state(3);

  onMount(() => eyeset.load());

  let active = $derived(eyeset.active);
  let pupils = $derived(active?.pupils ?? []);
  let annotated = $derived(pupils.filter((f) => f).length);
  let posPctOf = (idx: number) => (idx / (FRAMES_COUNT - 1)) * 100;

  function handleClick(e: MouseEvent, idx: number) {
    const target = e.currentTarget as HTMLDivElement;
    const r = target.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    eyeset.setMarker(idx, {
      pupilX: Math.max(0, Math.min(1, x)),
      pupilY: Math.max(0, Math.min(1, y)),
    });
  }

  function newSet() {
    const name = prompt('Nombre del set', 'Mi set');
    if (!name) return;
    eyeset.createCustom(name);
  }

  function duplicateActive() {
    if (active) eyeset.duplicate(active.id);
  }

  function removeActive() {
    if (!active || active.builtin) return;
    if (confirm(`Eliminar set "${active.name}"?`)) eyeset.remove(active.id);
  }

  function renameActive() {
    if (!active) return;
    const name = prompt('Renombrar set', active.name);
    if (name) eyeset.rename(active.id, name);
  }

  async function uploadFrame(idx: number, file: File) {
    if (!active || active.builtin) return;
    await eyeset.setFrameFromFile(active.id, idx, file);
  }

  function customFrameSrc(idx: number): string {
    if (!active || active.builtin) return '';
    return active.frameUrls?.[idx] ?? '';
  }
</script>

<div class="app">
  <TopBar />

  <main class="page">
    <header class="head">
      <div>
        <h1>Editor de cámara</h1>
        <p class="muted">Sets de imágenes del ojo + posición de la pupila por frame.</p>
      </div>
      <div class="actions">
        <a href="/docente">← Escenarios</a>
      </div>
    </header>

    <!-- Set picker -->
    <div class="set-bar">
      <label>
        <span>Set activo</span>
        <select value={eyeset.activeId} onchange={(e) => eyeset.setActive((e.target as HTMLSelectElement).value)}>
          {#each eyeset.sets as s}
            <option value={s.id}>{s.builtin ? '🔒 ' : ''}{s.name}</option>
          {/each}
        </select>
      </label>
      <button onclick={newSet}>+ Nuevo set</button>
      <button onclick={duplicateActive} disabled={!active}>⎘ Duplicar</button>
      <button onclick={renameActive} disabled={!active || active.builtin}>✎ Renombrar</button>
      <button class="danger" onclick={removeActive} disabled={!active || active.builtin}>× Eliminar</button>
      <span class="counter">{annotated}/{FRAMES_COUNT} pupilas marcadas</span>
      <button onclick={() => { if (confirm('Borrar marcas de este set?')) eyeset.clearActiveMarkers(); }}>Limpiar marcas</button>
    </div>

    {#if active?.builtin}
      <div class="hint-banner">🔒 Set predefinido — los frames no se pueden reemplazar, pero podés marcar las pupilas. Para crear un set propio: <b>Duplicar</b> o <b>+ Nuevo set</b>.</div>
    {/if}

    <div class="layout">
      <div class="grid">
        {#each Array(FRAMES_COUNT) as _, i}
          <div class="frame-card" class:active={selected === i}>
            <div class="frame-label">
              <span class="num">{i + 1}</span>
              <span>{FRAME_LABELS[i]}</span>
              {#if pupils[i]}<span class="dot-ok" title="Marcado"></span>{/if}
            </div>
            <div
              class="frame thumb"
              role="button" tabindex="0"
              onclick={() => (selected = i)}
              onkeydown={(e) => (e.key === 'Enter' && (selected = i))}
            >
              {#if active?.builtin}
                <div
                  class="sprite"
                  style:background-image="url({active.spriteUrl})"
                  style:background-position-y="{posPctOf(i)}%"
                ></div>
              {:else if customFrameSrc(i)}
                <img class="sprite img" src={customFrameSrc(i)} alt="" />
              {:else}
                <div class="placeholder">Sin imagen</div>
              {/if}
              {#if pupils[i]}
                {@const a = pupils[i]!}
                <span class="marker" style:left="{a.pupilX * 100}%" style:top="{a.pupilY * 100}%"></span>
              {/if}
            </div>
          </div>
        {/each}
      </div>

      <aside class="editor">
        <div class="ed-head">
          <span class="num">{selected + 1}</span>
          <h2>{FRAME_LABELS[selected]}</h2>
        </div>

        {#if !active?.builtin}
          <label class="upload-btn">
            <input type="file" accept="image/*" onchange={(e) => {
              const f = (e.target as HTMLInputElement).files?.[0];
              if (f) uploadFrame(selected, f);
              (e.target as HTMLInputElement).value = '';
            }} />
            <span>📁 Reemplazar imagen del frame</span>
          </label>
        {/if}

        <div
          class="frame big"
          role="button" tabindex="0"
          onclick={(e) => handleClick(e, selected)}
          onkeydown={(e) => (e.key === 'Delete' && eyeset.setMarker(selected, null))}
          title="Clic para marcar el centro de la pupila"
        >
          {#if active?.builtin}
            <div
              class="sprite"
              style:background-image="url({active.spriteUrl})"
              style:background-position-y="{posPctOf(selected)}%"
            ></div>
          {:else if customFrameSrc(selected)}
            <img class="sprite img" src={customFrameSrc(selected)} alt="" />
          {:else}
            <div class="placeholder big-ph">Sin imagen — usá "Reemplazar imagen del frame"</div>
          {/if}
          {#if pupils[selected]}
            {@const a = pupils[selected]!}
            <span class="crosshair" style:left="{a.pupilX * 100}%" style:top="{a.pupilY * 100}%">
              <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.5"/><line x1="12" y1="0" x2="12" y2="24" stroke="currentColor" stroke-width="1"/><line x1="0" y1="12" x2="24" y2="12" stroke="currentColor" stroke-width="1"/></svg>
            </span>
          {/if}
        </div>

        <div class="ed-info">
          {#if pupils[selected]}
            {@const a = pupils[selected]!}
            <div class="coord">x: <code>{(a.pupilX * 100).toFixed(1)}%</code> · y: <code>{(a.pupilY * 100).toFixed(1)}%</code></div>
            <button class="link-danger" onclick={() => eyeset.setMarker(selected, null)}>Borrar marca</button>
          {:else}
            <div class="hint">Clic sobre la imagen para colocar la pupila.</div>
          {/if}
        </div>
        <div class="nav-arrows">
          <button onclick={() => (selected = (selected - 1 + FRAMES_COUNT) % FRAMES_COUNT)}>← Anterior</button>
          <button onclick={() => (selected = (selected + 1) % FRAMES_COUNT)}>Siguiente →</button>
        </div>
      </aside>
    </div>
  </main>
</div>

<style>
  .app { min-height: 100vh; background: var(--bg); display: flex; flex-direction: column; }
  .page { padding: 16px; max-width: 1300px; width: 100%; margin: 0 auto; box-sizing: border-box; }
  .head { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 12px; gap: 16px; }
  .head h1 { margin: 0 0 4px; font-size: 22px; }
  .muted { color: var(--text-muted); font-size: 12px; }
  .actions a { color: var(--primary); text-decoration: none; font-size: 13px; }
  .actions a:hover { text-decoration: underline; }

  .set-bar {
    display: flex; align-items: center; gap: 8px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 10px 14px;
    margin-bottom: 12px;
    flex-wrap: wrap;
  }
  .set-bar label { display: inline-flex; align-items: center; gap: 6px; }
  .set-bar label span { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: .04em; font-weight: 600; }
  .set-bar select {
    font: inherit; font-size: 13px;
    padding: 5px 10px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font-weight: 600;
    min-width: 200px;
  }
  .set-bar button.danger { color: var(--danger); border-color: var(--danger); }
  .set-bar button.danger:hover { background: var(--danger); color: white; }
  .counter { margin-left: auto; background: var(--primary-soft); color: var(--primary); padding: 4px 12px; border-radius: var(--radius-sm); font-size: 11px; font-weight: 600; }

  .hint-banner {
    background: var(--accent-soft);
    color: var(--accent);
    border: 1px solid var(--accent);
    padding: 8px 12px;
    border-radius: var(--radius-sm);
    margin-bottom: 12px;
    font-size: 12px;
  }

  .layout { display: grid; grid-template-columns: 1fr 420px; gap: 16px; }

  .grid {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 14px;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 12px;
    align-content: start;
  }
  .frame-card { display: flex; flex-direction: column; gap: 4px; cursor: pointer; }
  .frame-card.active .thumb { outline: 2px solid var(--primary); outline-offset: 2px; }
  .frame-label { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--text-muted); }
  .num {
    background: var(--primary); color: white; font-weight: 700;
    width: 18px; height: 18px; border-radius: 50%; display: inline-flex;
    align-items: center; justify-content: center; font-size: 10px; font-family: ui-monospace, monospace;
  }
  .dot-ok { width: 8px; height: 8px; border-radius: 50%; background: var(--success); margin-left: auto; }

  .frame {
    width: 100%;
    aspect-ratio: 640 / 360;
    background-color: #000;
    border-radius: 6px;
    border: 1px solid var(--border);
    position: relative;
    overflow: hidden;
  }
  .sprite { width: 100%; height: 100%; background-repeat: no-repeat; background-size: 100% 1200%; background-position-x: 0; }
  .sprite.img { object-fit: cover; display: block; background: none; }
  .placeholder { display: flex; align-items: center; justify-content: center; height: 100%; color: #888; font-size: 11px; font-style: italic; }
  .placeholder.big-ph { font-size: 13px; padding: 20px; text-align: center; }
  .frame.thumb { cursor: pointer; }
  .frame.big { cursor: crosshair; max-width: 420px; border-radius: var(--radius-sm); }

  .marker { position: absolute; width: 10px; height: 10px; border-radius: 50%; background: var(--primary); border: 2px solid white; transform: translate(-50%, -50%); pointer-events: none; box-shadow: 0 0 0 1px rgba(0,0,0,0.5); }
  .crosshair { position: absolute; width: 32px; height: 32px; transform: translate(-50%, -50%); pointer-events: none; color: var(--primary); filter: drop-shadow(0 0 1px white); }
  .crosshair svg { width: 100%; height: 100%; }

  .editor { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px; display: flex; flex-direction: column; gap: 10px; height: fit-content; position: sticky; top: 16px; }
  .ed-head { display: flex; align-items: center; gap: 8px; }
  .ed-head h2 { margin: 0; font-size: 15px; }
  .ed-info { display: flex; align-items: center; gap: 12px; font-size: 12px; }
  .coord code { font-family: ui-monospace, monospace; background: var(--primary-soft); color: var(--primary); padding: 2px 6px; border-radius: 4px; }
  .hint { color: var(--text-muted); font-style: italic; }
  .link-danger { background: transparent; border: none; color: var(--danger); cursor: pointer; padding: 0; font-size: inherit; margin-left: auto; }
  .link-danger:hover { text-decoration: underline; }
  .nav-arrows { display: flex; gap: 8px; }
  .nav-arrows button { flex: 1; }

  .upload-btn {
    display: inline-flex; align-items: center; justify-content: center;
    background: var(--primary-soft); color: var(--primary);
    border: 1px dashed var(--primary);
    padding: 8px 12px; border-radius: var(--radius-sm);
    cursor: pointer; font-size: 12px; font-weight: 600;
  }
  .upload-btn:hover { background: var(--primary); color: white; }
  .upload-btn input { display: none; }
</style>
