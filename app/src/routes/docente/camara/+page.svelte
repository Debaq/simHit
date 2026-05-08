<script lang="ts">
  import { onMount } from 'svelte';
  import TopBar from '$lib/components/TopBar.svelte';
  import {
    eyeset, RAY_KEYS,
    type RayKey, type FrameRef, type Frame,
  } from '$lib/eyeset.svelte';
  import { frameRefEq } from '$lib/eyeset.svelte';
  import type { ArtifactKind } from '$lib/scenario.svelte';

  const ARTIFACT_LABELS: Record<ArtifactKind, string> = {
    blink: 'Parpadeo',
    slip: 'Deslizamiento gafas',
    wrong_dir: 'Dirección errada',
    overshoot: 'Overshoot ojo',
    fixation_loss: 'Pérdida fijación',
  };
  const ARTIFACT_KINDS: ArtifactKind[] = ['blink', 'slip', 'wrong_dir', 'overshoot', 'fixation_loss'];

  let selected = $state<FrameRef>({ kind: 'center' });
  onMount(() => eyeset.load());

  let active = $derived(eyeset.active);
  let centerFrame = $derived(active?.centerFrame ?? null);
  let blink = $derived(active?.blink ?? []);

  let selectedFrame = $derived(active ? eyeset.getFrame(active, selected) : null);

  // ── Convención espejo: dirección en pantalla → ray del paciente ──────────
  // pantalla-izq → paciente mira a su derecha (ray 'right'), etc.
  const SCREEN_DIRS = ['up', 'down', 'left', 'right', 'upLeft', 'upRight', 'downLeft', 'downRight'] as const;
  type ScreenDir = typeof SCREEN_DIRS[number];

  const SCREEN_TO_DATA: Record<ScreenDir, RayKey> = {
    up: 'up',
    down: 'down',
    left: 'right',
    right: 'left',
    upLeft: 'upRight',
    upRight: 'upLeft',
    downLeft: 'downRight',
    downRight: 'downLeft',
  };
  const DATA_TO_SCREEN = Object.fromEntries(
    Object.entries(SCREEN_TO_DATA).map(([s, d]) => [d, s as ScreenDir]),
  ) as Record<RayKey, ScreenDir>;

  const SCREEN_LABEL: Record<ScreenDir, string> = {
    up: 'Arriba',
    down: 'Abajo',
    left: 'Izquierda',
    right: 'Derecha',
    upLeft: 'Sup. izq.',
    upRight: 'Sup. der.',
    downLeft: 'Inf. izq.',
    downRight: 'Inf. der.',
  };

  // ── Selección de archivo (input file directo, sin modal) ────────────────
  function pickFile(): Promise<File | null> {
    return new Promise((resolve) => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = 'image/*';
      inp.onchange = () => resolve(inp.files?.[0] ?? null);
      inp.oncancel = () => resolve(null);
      inp.click();
    });
  }

  async function addFrameAt(kind: 'center' | 'ray' | 'blink', opts?: { ray?: RayKey; index?: number }) {
    if (!active || active.builtin) return;
    const f = await pickFile();
    if (!f) return;
    if (kind === 'center') {
      await eyeset.addFrame({ kind: 'center' }, f);
      selected = { kind: 'center' };
    } else if (kind === 'ray' && opts?.ray !== undefined && opts.index !== undefined) {
      const created = await eyeset.addFrame({ kind: 'ray', ray: opts.ray, index: opts.index }, f);
      if (created) selected = { kind: 'ray', ray: opts.ray, index: opts.index };
    } else if (kind === 'blink' && opts?.index !== undefined) {
      await eyeset.addFrame({ kind: 'blink', index: opts.index }, f);
      selected = { kind: 'blink', index: opts.index };
    }
  }

  async function replaceSelected() {
    if (!active || active.builtin || !selectedFrame) return;
    const f = await pickFile();
    if (!f) return;
    await eyeset.replaceFrameImage(selected, f);
  }

  function handleEditorClick(e: MouseEvent) {
    if (!selectedFrame) return;
    const target = e.currentTarget as HTMLDivElement;
    const r = target.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    eyeset.setPupil(selected, {
      pupilX: Math.max(0, Math.min(1, x)),
      pupilY: Math.max(0, Math.min(1, y)),
    });
  }

  function newSet() {
    const name = prompt('Nombre del set', 'Mi set');
    if (!name) return;
    eyeset.createCustom(name);
  }
  function duplicateActive() { if (active) eyeset.duplicate(active.id); }
  function removeActive() {
    if (!active || active.builtin) return;
    if (confirm(`Eliminar set "${active.name}"?`)) eyeset.remove(active.id);
  }
  function renameActive() {
    if (!active) return;
    const name = prompt('Renombrar set', active.name);
    if (name) eyeset.rename(active.id, name);
  }

  function frameImageStyle(f: Frame): { backgroundImage?: string; backgroundPositionY?: string } {
    if (f.spriteY !== undefined && active?.spriteUrl) {
      return { backgroundImage: `url(${active.spriteUrl})`, backgroundPositionY: `${f.spriteY}%` };
    }
    if (f.url) return { backgroundImage: `url(${f.url})` };
    return {};
  }

  function frameHasImage(f: Frame): boolean {
    return !!f.url || (f.spriteY !== undefined && !!active?.spriteUrl);
  }

  // contar pupilas marcadas: cualquier frame con pupilX|Y > 0
  let totalFrames = $derived.by(() => {
    if (!active) return 0;
    let n = (active.centerFrame ? 1 : 0) + active.blink.length;
    for (const k of RAY_KEYS) n += active.rays[k].length;
    return n;
  });
  let markedFrames = $derived.by(() => {
    if (!active) return 0;
    const marked = (f: Frame | null) => f && (f.pupilX !== 0 || f.pupilY !== 0);
    let n = (marked(active.centerFrame) ? 1 : 0);
    for (const k of RAY_KEYS) n += active.rays[k].filter(marked).length;
    n += active.blink.filter(marked).length;
    return n;
  });
</script>

<div class="app">
  <TopBar />

  <main class="page">
    <header class="head">
      <div>
        <h1>Editor de cámara</h1>
        <p class="muted">Sets de imágenes del ojo: centro + 8 direcciones + secuencia de parpadeo.</p>
      </div>
      <div class="actions"><a href="/docente">← Escenarios</a></div>
    </header>

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
      <span class="counter">{markedFrames}/{totalFrames} pupilas marcadas</span>
      <button onclick={() => { if (confirm('Borrar marcas de este set?')) eyeset.clearActiveMarkers(); }}>Limpiar marcas</button>
    </div>

    {#if active?.builtin}
      <div class="hint-banner">🔒 Set predefinido — los frames no se pueden reemplazar ni agregar, pero podés marcar las pupilas. Para crear un set propio: <b>Duplicar</b> o <b>+ Nuevo set</b>.</div>
    {/if}

    <div class="layout">
      <!-- ── PANEL IZQUIERDO: estrella + parpadeo ──────────────────────── -->
      <div class="canvas">
        <h3 class="group-title">Posiciones del ojo</h3>
        <div class="star" class:builtin={active?.builtin}>
          {#each SCREEN_DIRS as sdir}
            {@const dataKey = SCREEN_TO_DATA[sdir]}
            {@const rayFrames = active?.rays[dataKey] ?? []}
            <div class="ray ray-{sdir}">
              <span class="ray-label">{SCREEN_LABEL[sdir]}</span>
              <div class="ray-track">
                {#if !active?.builtin}
                  <button class="plus inline" type="button" onclick={() => addFrameAt('ray', { ray: dataKey, index: 0 })} title="Insertar más cerca del centro">+</button>
                {/if}
                {#each rayFrames as f, i}
                  <button
                    type="button"
                    class="frame-btn"
                    class:selected={frameRefEq(selected, { kind: 'ray', ray: dataKey, index: i })}
                    onclick={() => (selected = { kind: 'ray', ray: dataKey, index: i })}
                    title="{SCREEN_LABEL[sdir]} #{i + 1}"
                  >
                    {#if frameHasImage(f)}
                      <span class="thumb" class:sprite={f.spriteY !== undefined}
                            style:background-image={frameImageStyle(f).backgroundImage}
                            style:background-position-y={frameImageStyle(f).backgroundPositionY}></span>
                    {:else}
                      <span class="thumb empty"></span>
                    {/if}
                    {#if f.pupilX || f.pupilY}<span class="dot-ok"></span>{/if}
                  </button>
                  {#if !active?.builtin}
                    <button class="plus inline" type="button" onclick={() => addFrameAt('ray', { ray: dataKey, index: i + 1 })} title="Insertar después">+</button>
                  {/if}
                {/each}
                {#if rayFrames.length === 0 && active?.builtin}
                  <span class="empty-ray">—</span>
                {/if}
              </div>
            </div>
          {/each}

          <!-- Centro -->
          <div class="center-slot">
            <span class="center-label">Centro</span>
            {#if centerFrame}
              <button
                type="button"
                class="frame-btn center-btn"
                class:selected={frameRefEq(selected, { kind: 'center' })}
                onclick={() => (selected = { kind: 'center' })}
                title="Centro"
              >
                {#if frameHasImage(centerFrame)}
                  <span class="thumb" class:sprite={centerFrame.spriteY !== undefined}
                        style:background-image={frameImageStyle(centerFrame).backgroundImage}
                        style:background-position-y={frameImageStyle(centerFrame).backgroundPositionY}></span>
                {:else}
                  <span class="thumb empty"></span>
                {/if}
                {#if centerFrame.pupilX || centerFrame.pupilY}<span class="dot-ok"></span>{/if}
              </button>
            {:else if !active?.builtin}
              <button class="plus big-plus" type="button" onclick={() => addFrameAt('center')} title="Agregar frame central">+ centro</button>
            {:else}
              <span class="thumb empty center-thumb"></span>
            {/if}
          </div>
        </div>

        <h3 class="group-title">Parpadeo</h3>
        <div class="blink-strip">
          {#if !active?.builtin}
            <button class="plus" type="button" onclick={() => addFrameAt('blink', { index: 0 })} title="Insertar al inicio">+</button>
          {/if}
          {#each blink as f, i}
            <button
              type="button"
              class="frame-btn blink-frame"
              class:selected={frameRefEq(selected, { kind: 'blink', index: i })}
              onclick={() => (selected = { kind: 'blink', index: i })}
              title="Parpadeo {i + 1}"
            >
              {#if frameHasImage(f)}
                <span class="thumb" class:sprite={f.spriteY !== undefined}
                      style:background-image={frameImageStyle(f).backgroundImage}
                      style:background-position-y={frameImageStyle(f).backgroundPositionY}></span>
              {:else}
                <span class="thumb empty"></span>
              {/if}
              <span class="frame-num">{i + 1}</span>
              {#if f.pupilX || f.pupilY}<span class="dot-ok"></span>{/if}
            </button>
            {#if !active?.builtin}
              <button class="plus" type="button" onclick={() => addFrameAt('blink', { index: i + 1 })} title="Insertar después">+</button>
            {/if}
          {/each}
          {#if blink.length === 0 && active?.builtin}
            <span class="empty-hint">Sin frames de parpadeo</span>
          {/if}
        </div>
      </div>

      <!-- ── PANEL DERECHO: editor del frame seleccionado ─────────────── -->
      <aside class="editor">
        <div class="ed-head">
          <h2>{
            selected.kind === 'center' ? 'Centro' :
            selected.kind === 'ray' ? `${SCREEN_LABEL[DATA_TO_SCREEN[selected.ray]]} #${selected.index + 1}` :
            `Parpadeo ${selected.index + 1}`
          }</h2>
        </div>

        {#if selectedFrame}
          {#if !active?.builtin}
            <div class="ed-actions">
              <button onclick={replaceSelected}>📁 Reemplazar imagen</button>
              <button class="link-danger" onclick={() => { if (confirm('Eliminar este frame?')) { eyeset.removeFrame(selected); selected = { kind: 'center' }; } }}>Eliminar frame</button>
            </div>
          {/if}

          <div
            class="frame big"
            role="button" tabindex="0"
            onclick={handleEditorClick}
            onkeydown={(e) => (e.key === 'Delete' && eyeset.clearPupil(selected))}
            title="Clic para marcar el centro de la pupila"
          >
            {#if frameHasImage(selectedFrame)}
              <div class="sprite" class:is-sprite={selectedFrame.spriteY !== undefined}
                   style:background-image={frameImageStyle(selectedFrame).backgroundImage}
                   style:background-position-y={frameImageStyle(selectedFrame).backgroundPositionY}></div>
            {:else}
              <div class="placeholder big-ph">Sin imagen</div>
            {/if}
            {#if selectedFrame.pupilX || selectedFrame.pupilY}
              <span class="crosshair" style:left="{selectedFrame.pupilX * 100}%" style:top="{selectedFrame.pupilY * 100}%">
                <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.5"/><line x1="12" y1="0" x2="12" y2="24" stroke="currentColor" stroke-width="1"/><line x1="0" y1="12" x2="24" y2="12" stroke="currentColor" stroke-width="1"/></svg>
              </span>
            {/if}
          </div>

          <div class="ed-info">
            {#if selectedFrame.pupilX || selectedFrame.pupilY}
              <div class="coord">x: <code>{(selectedFrame.pupilX * 100).toFixed(1)}%</code> · y: <code>{(selectedFrame.pupilY * 100).toFixed(1)}%</code></div>
              <button class="link-danger" onclick={() => eyeset.clearPupil(selected)}>Borrar marca</button>
            {:else}
              <div class="hint">Clic sobre la imagen para colocar la pupila.</div>
            {/if}
          </div>
        {:else}
          <div class="placeholder big-ph">Sin frame seleccionado. Hacé clic en uno o agregá imágenes con +.</div>
        {/if}
      </aside>
    </div>

    <section class="artifacts">
      <header class="art-head">
        <h2>Artefactos del set</h2>
        <p class="muted">Probabilidad de aparición durante cada impulso. Heredados por todos los casos que usen este set, salvo override por nodo impulse.</p>
      </header>
      {#if active}
        {#if active.artifacts.length === 0}
          <em class="empty-art">— sin artefactos definidos —</em>
        {:else}
          <ul class="art-list">
            {#each active.artifacts as a, i}
              <li class="art-row">
                <select value={a.artifact} onchange={(e) => eyeset.updateArtifact(active!.id, i, { artifact: (e.target as HTMLSelectElement).value as ArtifactKind })}>
                  {#each ARTIFACT_KINDS as k}
                    <option value={k}>{ARTIFACT_LABELS[k]}</option>
                  {/each}
                </select>
                <input type="range" min="0" max="1" step="0.05" value={a.probability}
                       oninput={(e) => eyeset.updateArtifact(active!.id, i, { probability: +(e.target as HTMLInputElement).value })} />
                <span class="prob">{(a.probability * 100).toFixed(0)}%</span>
                <button class="del-mini" onclick={() => eyeset.removeArtifact(active!.id, i)} title="Quitar">×</button>
              </li>
            {/each}
          </ul>
        {/if}
        <button class="add-art" onclick={() => eyeset.addArtifact(active!.id, { artifact: 'blink', probability: 0.3 })}>+ Agregar artefacto</button>
      {/if}
    </section>
  </main>
</div>

<style>
  .app { min-height: 100vh; background: var(--bg); }
  .page { padding: 16px; width: 100%; box-sizing: border-box; }
  .head { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 12px; gap: 16px; }
  .head h1 { margin: 0 0 4px; font-size: 22px; }
  .muted { color: var(--text-muted); font-size: 12px; max-width: 720px; }
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

  .layout { display: grid; grid-template-columns: 1fr 420px; gap: 16px; align-items: start; }

  .canvas { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 18px; }
  .group-title { margin: 0 0 12px; font-size: 13px; color: var(--text-muted); text-transform: uppercase; letter-spacing: .06em; }

  /* ── Estrella (grid 3x3) ──────────────────────────────────────────── */
  .star {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    grid-template-rows: 1fr auto 1fr;
    gap: 14px;
    width: 100%;
    max-width: 880px;
    margin: 0 auto 28px;
    background:
      linear-gradient(to right, transparent calc(50% - 1px), var(--border) calc(50% - 1px), var(--border) calc(50% + 1px), transparent calc(50% + 1px)),
      linear-gradient(to bottom, transparent calc(50% - 1px), var(--border) calc(50% - 1px), var(--border) calc(50% + 1px), transparent calc(50% + 1px));
    background-repeat: no-repeat;
    padding: 12px;
    border-radius: var(--radius);
  }

  /* Posicionamiento por celda */
  .ray {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .ray-track {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: nowrap;
  }
  .ray-label {
    font-size: 10px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: .04em;
    font-weight: 600;
    white-space: nowrap;
  }

  /* Cardinales — alineación hacia el centro */
  .ray-up    { grid-column: 2; grid-row: 1; align-self: end;    justify-self: center; align-items: center; }
  .ray-up    .ray-track { flex-direction: column-reverse; }
  .ray-down  { grid-column: 2; grid-row: 3; align-self: start;  justify-self: center; align-items: center; }
  .ray-down  .ray-track { flex-direction: column; }
  .ray-left  { grid-column: 1; grid-row: 2; align-self: center; justify-self: end;    align-items: flex-end; }
  .ray-left  .ray-track { flex-direction: row-reverse; }
  .ray-right { grid-column: 3; grid-row: 2; align-self: center; justify-self: start;  align-items: flex-start; }
  .ray-right .ray-track { flex-direction: row; }

  /* Diagonales — strips horizontales en las esquinas, ancladas hacia el centro */
  .ray-upLeft    { grid-column: 1; grid-row: 1; align-self: end;   justify-self: end;   align-items: flex-end; }
  .ray-upLeft    .ray-track { flex-direction: row-reverse; }
  .ray-upRight   { grid-column: 3; grid-row: 1; align-self: end;   justify-self: start; align-items: flex-start; }
  .ray-upRight   .ray-track { flex-direction: row; }
  .ray-downLeft  { grid-column: 1; grid-row: 3; align-self: start; justify-self: end;   align-items: flex-end; }
  .ray-downLeft  .ray-track { flex-direction: row-reverse; }
  .ray-downRight { grid-column: 3; grid-row: 3; align-self: start; justify-self: start; align-items: flex-start; }
  .ray-downRight .ray-track { flex-direction: row; }

  /* Centro */
  .center-slot {
    grid-column: 2; grid-row: 2;
    display: flex; flex-direction: column; align-items: center; gap: 4px;
    z-index: 1;
  }
  .center-label { font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: .04em; font-weight: 700; }

  .empty-ray { color: var(--text-muted); font-size: 12px; padding: 4px 6px; }

  /* ── Frame thumbnails ─────────────────────────────────────────────── */
  .frame-btn {
    position: relative;
    background: #0f172a;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0;
    cursor: pointer;
    overflow: visible;
    width: 84px; height: 48px;
    flex-shrink: 0;
    transition: transform .12s ease, border-color .12s ease;
  }
  .frame-btn:hover { border-color: var(--primary); transform: translateY(-1px); }
  .frame-btn.selected { outline: 2px solid var(--primary); outline-offset: 2px; }

  .center-btn { width: 120px; height: 68px; border-width: 2px; }
  .blink-frame { width: 88px; height: 50px; }

  .thumb {
    display: block;
    width: 100%; height: 100%;
    background-color: #000;
    background-repeat: no-repeat;
    background-size: cover;
    background-position: center;
    border-radius: 5px;
  }
  .thumb.sprite { background-size: 100% 1200%; background-position-x: 0; }
  .thumb.empty {
    background: repeating-linear-gradient(45deg, var(--surface-2, #f1f5f9), var(--surface-2, #f1f5f9) 4px, var(--border) 4px, var(--border) 8px);
  }
  .center-thumb { width: 120px; height: 68px; }
  .frame-btn .frame-num {
    position: absolute;
    top: -7px; left: -7px;
    background: var(--primary); color: white;
    font-size: 9px; font-weight: 700;
    width: 16px; height: 16px; border-radius: 50%;
    display: inline-flex; align-items: center; justify-content: center;
    font-family: ui-monospace, monospace;
  }
  .dot-ok {
    position: absolute; top: -5px; right: -5px;
    width: 10px; height: 10px; border-radius: 50%;
    background: var(--success);
    border: 2px solid var(--surface);
  }

  /* ── Botón + ──────────────────────────────────────────────────────── */
  .plus {
    width: 24px; height: 24px;
    border-radius: 50%;
    border: 1px dashed var(--primary);
    background: var(--primary-soft);
    color: var(--primary);
    font-size: 16px; font-weight: 700; line-height: 1;
    cursor: pointer;
    display: inline-flex; align-items: center; justify-content: center;
    flex-shrink: 0;
    padding: 0;
    transition: background .12s ease, color .12s ease;
  }
  .plus:hover { background: var(--primary); color: white; }
  .plus.inline { opacity: .6; }
  .plus.inline:hover { opacity: 1; }
  .big-plus {
    width: 120px; height: 68px; border-radius: 6px; font-size: 13px; font-weight: 600;
    border-style: dashed; border-width: 2px;
    letter-spacing: .04em; text-transform: uppercase;
  }

  /* ── Parpadeo ─────────────────────────────────────────────────────── */
  .blink-strip {
    display: flex; align-items: center; gap: 6px;
    flex-wrap: wrap;
    background: var(--surface-2, #f8fafc);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 14px;
    min-height: 70px;
  }
  .empty-hint { color: var(--text-muted); font-style: italic; font-size: 12px; }

  /* ── Editor lateral ──────────────────────────────────────────────── */
  .editor { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px; display: flex; flex-direction: column; gap: 10px; height: fit-content; position: sticky; top: 16px; }
  .ed-head h2 { margin: 0; font-size: 15px; }
  .ed-actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .ed-info { display: flex; align-items: center; gap: 12px; font-size: 12px; }
  .coord code { font-family: ui-monospace, monospace; background: var(--primary-soft); color: var(--primary); padding: 2px 6px; border-radius: 4px; }
  .hint { color: var(--text-muted); font-style: italic; }
  .link-danger { background: transparent; border: none; color: var(--danger); cursor: pointer; padding: 0; font-size: inherit; margin-left: auto; }
  .link-danger:hover { text-decoration: underline; }

  .frame {
    width: 100%;
    aspect-ratio: 640 / 360;
    background-color: #000;
    border-radius: 6px;
    border: 1px solid var(--border);
    position: relative;
    overflow: hidden;
  }
  .frame.big { cursor: crosshair; max-width: 420px; border-radius: var(--radius-sm); }
  .sprite { width: 100%; height: 100%; background-repeat: no-repeat; background-size: cover; background-position: center; }
  .sprite.is-sprite { background-size: 100% 1200%; background-position-x: 0; }
  .placeholder { display: flex; align-items: center; justify-content: center; height: 100%; color: #888; font-size: 11px; font-style: italic; }
  .placeholder.big-ph { font-size: 13px; padding: 20px; text-align: center; }
  .crosshair { position: absolute; width: 32px; height: 32px; transform: translate(-50%, -50%); pointer-events: none; color: var(--primary); filter: drop-shadow(0 0 1px white); }
  .crosshair svg { width: 100%; height: 100%; }

  .artifacts { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px 18px; margin-top: 16px; }
  .artifacts .art-head h2 { margin: 0 0 4px; font-size: 15px; }
  .artifacts .art-head .muted { font-size: 11px; max-width: 720px; }
  .empty-art { display: block; padding: 12px 0; color: var(--text-muted); font-style: italic; font-size: 12px; }
  .art-list { list-style: none; margin: 8px 0 12px; padding: 0; display: flex; flex-direction: column; gap: 6px; max-width: 720px; }
  .art-row { display: grid; grid-template-columns: 240px 1fr 50px 28px; gap: 10px; align-items: center; padding: 6px 10px; background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-sm); }
  .art-row select { font: inherit; font-size: 12px; padding: 4px 8px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); }
  .art-row input[type="range"] { accent-color: var(--primary); }
  .art-row .prob { font-family: ui-monospace, monospace; font-size: 11px; color: var(--primary); font-weight: 600; text-align: right; }
  .del-mini { background: transparent; border: 1px solid var(--border); color: var(--text-muted); border-radius: 50%; width: 24px; height: 24px; padding: 0; line-height: 1; font-size: 14px; cursor: pointer; }
  .del-mini:hover { color: var(--danger); border-color: var(--danger); }
  .add-art { font-size: 12px; padding: 6px 12px; background: var(--primary-soft); color: var(--primary); border: 1px dashed var(--primary); border-radius: var(--radius-sm); cursor: pointer; }
  .add-art:hover { background: var(--primary); color: white; }
</style>
