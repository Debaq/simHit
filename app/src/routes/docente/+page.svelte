<script lang="ts">
  import { onMount } from 'svelte';
  import TopBar from '$lib/components/TopBar.svelte';
  import { bundles, type Escenario } from '$lib/bundle.svelte';
  import { scenarios } from '$lib/scenario.svelte';
  import { acceptance } from '$lib/acceptance.svelte';
  import { eyeset } from '$lib/eyeset.svelte';
  import { settings } from '$lib/settings.svelte';
  import { ui } from '$lib/dialog.svelte';

  onMount(async () => {
    await scenarios.load();
    await settings.load();
    if (bundles.active) bundles.applyActive();
  });

  let active = $derived(bundles.active);

  async function newBundle() {
    const name = await ui.prompt('Nombre del escenario', 'Nuevo escenario');
    if (!name) return;
    bundles.create(name);
  }

  function pick(id: string) { bundles.setActive(id); }

  async function remove(b: Escenario) {
    if (!(await ui.confirm(`Eliminar "${b.name}"`, 'Esta acción no se puede deshacer.', { danger: true }))) return;
    bundles.remove(b.id);
  }

  function duplicate(b: Escenario) { bundles.duplicate(b.id); }

  async function rename(b: Escenario) {
    const name = await ui.prompt('Nuevo nombre', b.name);
    if (!name) return;
    bundles.update(b.id, { name });
  }

  function setCaso(id: string) {
    if (!active) return;
    bundles.update(active.id, { casoId: id });
  }
  function setAcceptance(id: string) {
    if (!active) return;
    bundles.update(active.id, { acceptanceId: id });
  }
  function setEyeset(id: string) {
    if (!active) return;
    bundles.update(active.id, { eyesetId: id });
  }

  let allCasos = $derived([...scenarios.examples, ...scenarios.list]);
  let casoActive = $derived(active ? allCasos.find((c) => c.id === active.casoId) : null);
  let acceptanceActive = $derived(active ? acceptance.all.find((a) => a.id === active.acceptanceId) : null);
  let eyesetActive = $derived(active ? eyeset.sets.find((e) => e.id === active.eyesetId) : null);
</script>

<div class="app">
  <TopBar />

  <div class="docente">
    <aside class="left">
      <div class="section-title">Escenarios</div>
      <button class="primary" onclick={newBundle}>+ Nuevo escenario</button>
      <ul>
        {#each bundles.list as b (b.id)}
          <li class:active={b.id === bundles.activeId}>
            <button class="name" onclick={() => pick(b.id)}>
              {#if b.id === bundles.activeId}<span class="dot">●</span>{/if}
              {b.name}
            </button>
            <button class="dup" onclick={() => duplicate(b)} title="Duplicar">⎘</button>
            <button class="del" onclick={() => remove(b)} title="Eliminar">×</button>
          </li>
        {:else}
          <li class="empty-li">— sin escenarios —</li>
        {/each}
      </ul>

      <div class="section-title">Configuración general</div>
      <label class="cfg-row">
        <input
          type="checkbox"
          checked={settings.debug}
          onchange={(e) => settings.setDebug((e.currentTarget as HTMLInputElement).checked)}
        />
        <span class="cfg-label">
          <b>Debug</b>
          <em>Muestra x, y, frame y parpadeo sobre la imagen del ojo.</em>
        </span>
      </label>
    </aside>

    <main class="canvas">
      {#if !active}
        <div class="empty">
          <h2>No hay escenario activo</h2>
          <p>Un escenario combina un <b>caso clínico</b>, un <b>nivel de dificultad</b> y un <b>set de cámara</b>.</p>
          <p>Crea uno nuevo para empezar.</p>
          <button class="primary big" onclick={newBundle}>+ Nuevo escenario</button>
        </div>
      {:else}
        <header class="hd">
          <div class="hd-title">
            <h2>{active.name}</h2>
            <p class="desc">Activo. Las tres partes se aplican al simulador.</p>
          </div>
          <div class="hd-actions">
            <button onclick={() => rename(active)}>Renombrar</button>
            <button onclick={() => duplicate(active)}>⎘ Duplicar</button>
          </div>
        </header>

        <section class="parts">
          <!-- Parte 1: Caso clínico -->
          <div class="part">
            <div class="part-head">
              <h3>🩺 Caso clínico</h3>
              <a class="edit-link" href="/docente/caso">Editar →</a>
            </div>
            <select value={active.casoId} oninput={(e) => setCaso((e.currentTarget as HTMLSelectElement).value)}>
              <option value="">— seleccionar —</option>
              {#if scenarios.examples.length}
                <optgroup label="📚 Predefinidos">
                  {#each scenarios.examples as c (c.id)}
                    <option value={c.id}>{c.name}</option>
                  {/each}
                </optgroup>
              {/if}
              {#if scenarios.list.length}
                <optgroup label="Mis casos">
                  {#each scenarios.list as c (c.id)}
                    <option value={c.id}>{c.name}</option>
                  {/each}
                </optgroup>
              {/if}
            </select>
            {#if casoActive}
              <div class="summary">
                {#if casoActive.description}<p class="summary-desc">{casoActive.description}</p>{/if}
                <div class="summary-grid">
                  <div><span>LL</span> gain {casoActive.channels.LL.gain.toFixed(2)} · {casoActive.channels.LL.peakVel}°/s · sacada {casoActive.channels.LL.saccade}</div>
                  <div><span>RL</span> gain {casoActive.channels.RL.gain.toFixed(2)} · {casoActive.channels.RL.peakVel}°/s · sacada {casoActive.channels.RL.saccade}</div>
                </div>
              </div>
            {:else}
              <p class="muted">Selecciona un caso clínico.</p>
            {/if}
          </div>

          <!-- Parte 2: Nivel de aceptación -->
          <div class="part">
            <div class="part-head">
              <h3>🎓 Nivel de dificultad</h3>
              <a class="edit-link" href="/docente/dificultad">Editar →</a>
            </div>
            <select value={active.acceptanceId} oninput={(e) => setAcceptance((e.currentTarget as HTMLSelectElement).value)}>
              <optgroup label="📚 Predefinidos">
                {#each acceptance.all.filter((p) => p.builtin) as p (p.id)}
                  <option value={p.id}>{p.name}</option>
                {/each}
              </optgroup>
              {#if acceptance.all.some((p) => !p.builtin)}
                <optgroup label="Mis niveles">
                  {#each acceptance.all.filter((p) => !p.builtin) as p (p.id)}
                    <option value={p.id}>{p.name}</option>
                  {/each}
                </optgroup>
              {/if}
            </select>
            {#if acceptanceActive}
              <div class="summary-grid">
                <div><span>Pose</span> ±{acceptanceActive.yawTol}° / ±{acceptanceActive.pitchTol}° / ±{acceptanceActive.rollTol}°</div>
                <div><span>Pico</span> {acceptanceActive.peakMin}–{acceptanceActive.peakMax} °/s</div>
                <div><span>Desplaz.</span> {acceptanceActive.ampMin}–{acceptanceActive.ampMax}°</div>
                <div><span>Ganancia</span> {acceptanceActive.gainMin.toFixed(2)}–{acceptanceActive.gainMax.toFixed(2)}</div>
                <div><span>Duración</span> {acceptanceActive.durMinMs}–{acceptanceActive.durMaxMs} ms</div>
              </div>
            {/if}
          </div>

          <!-- Parte 3: Set de cámara -->
          <div class="part">
            <div class="part-head">
              <h3>📷 Set de cámara</h3>
              <a class="edit-link" href="/docente/camara">Editar →</a>
            </div>
            <select value={active.eyesetId} oninput={(e) => setEyeset((e.currentTarget as HTMLSelectElement).value)}>
              {#each eyeset.sets as s (s.id)}
                <option value={s.id}>{s.name}</option>
              {/each}
            </select>
            {#if eyesetActive}
              {@const total = (eyesetActive.centerFrame ? 1 : 0)
                + Object.values(eyesetActive.rays).reduce((a, r) => a + r.length, 0)
                + eyesetActive.blink.length}
              <p class="muted small">{total} frames</p>
            {/if}
          </div>
        </section>
      {/if}
    </main>
  </div>
</div>

<style>
  .app { min-height: 100vh; background: var(--bg); display: flex; flex-direction: column; }
  .docente { flex: 1; display: grid; grid-template-columns: 280px 1fr; gap: 12px; padding: 12px; }
  aside.left {
    background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
    padding: 10px; box-shadow: var(--shadow-sm); display: flex; flex-direction: column; gap: 8px;
    overflow-y: auto;
  }
  .section-title {
    font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--text-muted);
    margin-top: 4px; padding-bottom: 4px; border-bottom: 1px solid var(--border);
  }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  li {
    display: flex; align-items: center; gap: 4px; padding: 4px;
    border-radius: var(--radius-sm); border: 1px solid transparent;
  }
  li.active { background: var(--primary-soft); border-color: var(--primary); }
  li.empty-li { color: var(--text-muted); font-size: 12px; padding: 6px 4px; font-style: italic; }
  .name {
    flex: 1; text-align: left; padding: 4px 6px; font-size: 13px;
    background: transparent; border: none; cursor: pointer; color: inherit;
  }
  .name:hover { color: var(--primary); }
  .dot { color: var(--success); margin-right: 4px; }
  .dup, .del {
    width: 22px; height: 22px; padding: 0; font-size: 14px; line-height: 1;
    background: transparent; border: 1px solid var(--border); border-radius: 4px; cursor: pointer;
  }
  .dup:hover { border-color: var(--primary); color: var(--primary); }
  .del:hover { background: var(--danger); color: white; border-color: var(--danger); }
  button.primary {
    background: var(--primary); color: white; border: none; padding: 6px 10px;
    border-radius: var(--radius-sm); font-size: 12px; cursor: pointer;
  }
  button.primary.big { padding: 10px 16px; font-size: 14px; margin-top: 12px; }

  main.canvas {
    background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
    padding: 16px; box-shadow: var(--shadow-sm); display: flex; flex-direction: column; gap: 12px;
    overflow-y: auto;
  }
  .empty { text-align: center; padding: 40px 20px; color: var(--text-muted); }
  .empty h2 { color: var(--text); margin-bottom: 12px; }
  .empty p { margin: 4px 0; }

  .hd { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
  .hd-title h2 { margin: 0 0 4px; font-size: 18px; }
  .hd-title .desc { margin: 0; color: var(--text-muted); font-size: 12px; }
  .hd-actions { display: flex; gap: 6px; }
  .hd-actions button {
    background: var(--surface-2); border: 1px solid var(--border); padding: 6px 10px;
    border-radius: var(--radius-sm); font-size: 12px; cursor: pointer; color: inherit;
  }
  .hd-actions button:hover { border-color: var(--primary); }

  .parts { display: grid; grid-template-columns: 1fr; gap: 12px; }
  @media (min-width: 1100px) { .parts { grid-template-columns: 1fr 1fr; } }
  .part {
    background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius-sm);
    padding: 12px; display: flex; flex-direction: column; gap: 8px;
  }
  .part-head { display: flex; justify-content: space-between; align-items: center; }
  .part-head h3 { margin: 0; font-size: 13px; color: var(--primary); }
  .edit-link {
    font-size: 11px; color: var(--text-muted); text-decoration: none;
    padding: 2px 6px; border: 1px solid var(--border); border-radius: 4px;
  }
  .edit-link:hover { color: var(--primary); border-color: var(--primary); }
  select {
    font: inherit; font-size: 13px; padding: 6px 10px;
    border: 1px solid var(--border-strong); border-radius: var(--radius-sm);
    background: var(--surface); color: var(--text); width: 100%;
  }
  .summary { display: flex; flex-direction: column; gap: 4px; }
  .summary-desc { margin: 0; color: var(--text-muted); font-size: 12px; font-style: italic; }
  .summary-grid {
    display: grid; gap: 4px; font-size: 12px; color: var(--text);
  }
  .summary-grid div { display: flex; gap: 6px; }
  .summary-grid span {
    color: var(--text-muted); font-weight: 600; font-size: 11px; text-transform: uppercase;
    min-width: 70px;
  }
  .muted { color: var(--text-muted); font-size: 12px; margin: 0; }
  .small { font-size: 11px; }
  .cfg-row {
    display: flex; gap: 8px; align-items: flex-start; padding: 6px 4px; cursor: pointer;
    font-size: 12px;
  }
  .cfg-row input[type=checkbox] { margin-top: 2px; }
  .cfg-label { display: flex; flex-direction: column; gap: 2px; }
  .cfg-label em { font-style: normal; color: var(--text-muted); font-size: 11px; }
</style>
