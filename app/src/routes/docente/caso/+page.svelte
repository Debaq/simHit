<script lang="ts">
  import { onMount } from 'svelte';
  import TopBar from '$lib/components/TopBar.svelte';
  import {
    scenarios,
    HORIZONTAL_CHANNELS,
    VERTICAL_CHANNELS,
    CHANNEL_LABELS,
    type Channel,
    type ChannelConfig,
    type ArtifactKind,
    type ArtifactConfig,
  } from '$lib/scenario.svelte';
  import { ui } from '$lib/dialog.svelte';

  onMount(() => { scenarios.load(); });

  let activeScenario = $derived(scenarios.active);
  let isExampleModified = $derived(
    !!activeScenario && scenarios.isExampleActive && scenarios.isExampleModified(activeScenario.id),
  );

  async function newScenario() {
    const name = await ui.prompt('Nombre del caso', 'Nuevo caso');
    if (!name) return;
    scenarios.create(name);
  }
  async function deleteScenario(id: string) {
    if (!(await ui.confirm('Eliminar caso', 'Esta acción no se puede deshacer.', { danger: true }))) return;
    scenarios.remove(id);
  }
  function duplicateActive() {
    if (!activeScenario) return;
    scenarios.duplicate(activeScenario.id);
  }

  async function renameActive() {
    if (!activeScenario) return;
    const name = await ui.prompt('Nuevo nombre', activeScenario.name);
    if (!name) return;
    scenarios.rename(activeScenario.id, name);
  }

  async function resetActive() {
    if (!activeScenario || !scenarios.isExampleActive) return;
    if (!(await ui.confirm('Restaurar predeterminado', `Se descartarán los cambios hechos a "${activeScenario.name}" y se volverá a los valores originales.`, { danger: true }))) return;
    await scenarios.resetExample(activeScenario.id);
  }

  function updateChannel(channel: Channel, patch: Partial<ChannelConfig>) {
    if (!activeScenario) return;
    scenarios.updateChannel(activeScenario.id, channel, patch);
  }

  function addArtifact(channel: Channel) {
    if (!activeScenario) return;
    const cur = activeScenario.channels[channel].artifacts;
    const next: ArtifactConfig[] = [...cur, { artifact: 'blink', probability: 0.3 }];
    scenarios.setChannelArtifacts(activeScenario.id, channel, next);
  }
  function updateArtifact(channel: Channel, idx: number, patch: Partial<ArtifactConfig>) {
    if (!activeScenario) return;
    const cur = activeScenario.channels[channel].artifacts;
    const next = cur.map((a, i) => (i === idx ? { ...a, ...patch } : a));
    scenarios.setChannelArtifacts(activeScenario.id, channel, next);
  }
  function removeArtifact(channel: Channel, idx: number) {
    if (!activeScenario) return;
    const cur = activeScenario.channels[channel].artifacts;
    scenarios.setChannelArtifacts(activeScenario.id, channel, cur.filter((_, i) => i !== idx));
  }

  const ARTIFACT_OPTIONS: { value: ArtifactKind; label: string }[] = [
    { value: 'blink', label: 'Parpadeo' },
    { value: 'slip', label: 'Deslizamiento de gafas' },
    { value: 'wrong_dir', label: 'Dirección errónea' },
    { value: 'overshoot', label: 'Sobre-impulso' },
    { value: 'fixation_loss', label: 'Pérdida de fijación' },
  ];
</script>

<div class="app">
  <TopBar />

  <div class="docente">
    <aside class="left">
      <a class="ext-link" href="/docente">← Volver a escenarios</a>

      <div class="section-title">Casos predefinidos</div>
      <ul>
        {#each scenarios.examples as s (s.id)}
          <li class:active={s.id === scenarios.activeId}>
            <button class="name" onclick={() => scenarios.setActive(s.id)}>
              <span class="badge">📚</span>{s.name}
            </button>
            <button class="dup" title="Duplicar para editar" onclick={() => scenarios.duplicate(s.id)}>⎘</button>
          </li>
        {/each}
      </ul>

      <div class="section-title">Mis escenarios</div>
      <button class="primary" onclick={newScenario}>+ Nuevo</button>
      <ul>
        {#each scenarios.list as s (s.id)}
          <li class:active={s.id === scenarios.activeId}>
            <button class="name" onclick={() => scenarios.setActive(s.id)}>{s.name}</button>
            <button class="del" onclick={() => deleteScenario(s.id)} title="Eliminar">×</button>
          </li>
        {:else}
          <li class="empty-li">— vacío —</li>
        {/each}
      </ul>
    </aside>

    <main class="canvas">
      {#if !activeScenario}
        <div class="empty">No hay escenarios. Crea uno o selecciona un caso predefinido.</div>
      {:else}
        <header class="hd">
          <div class="hd-title">
            <h2>{activeScenario.name}</h2>
            {#if activeScenario.description}
              <p class="desc">{activeScenario.description}</p>
            {/if}
          </div>
          <div class="hd-actions">
            {#if scenarios.isExampleActive}
              <span class="tag">📚 Caso predefinido{#if isExampleModified} · ✎ modificado{/if}</span>
            {/if}
            <button onclick={renameActive}>Renombrar</button>
            <button onclick={duplicateActive}>⎘ Duplicar</button>
            {#if scenarios.isExampleActive}
              <button class="reset" disabled={!isExampleModified} onclick={resetActive} title={isExampleModified ? 'Restaurar valores originales' : 'Sin cambios respecto al predeterminado'}>↺ Restaurar predeterminado</button>
            {/if}
          </div>
        </header>

        <section class="grid">
          <div class="grp">
            <div class="grp-title">Canales horizontales</div>
            <div class="row">
              {#each HORIZONTAL_CHANNELS as ch (ch)}
                {@const cfg = activeScenario.channels[ch]}
                <div class="ch-card">
                  <div class="ch-hd">
                    <span class="ch-key">{ch}</span>
                    <span class="ch-name">{CHANNEL_LABELS[ch]}</span>
                  </div>

                  <label class="field">
                    <span class="lbl">Ganancia VOR <em>{cfg.gain.toFixed(2)}</em></span>
                    <input
                      type="range" min="0" max="1.5" step="0.05"
                      value={cfg.gain}
                     
                      oninput={(e) => updateChannel(ch, { gain: +(e.currentTarget as HTMLInputElement).value })}
                    />
                  </label>

                  <label class="field">
                    <span class="lbl">Velocidad pico <em>{cfg.peakVel} °/s</em></span>
                    <input
                      type="range" min="80" max="300" step="5"
                      value={cfg.peakVel}
                     
                      oninput={(e) => updateChannel(ch, { peakVel: +(e.currentTarget as HTMLInputElement).value })}
                    />
                  </label>

                  <label class="field">
                    <span class="lbl">Sacada correctiva</span>
                    <select
                      value={cfg.saccade}
                     
                      onchange={(e) => updateChannel(ch, { saccade: (e.currentTarget as HTMLSelectElement).value as ChannelConfig['saccade'] })}
                    >
                      <option value="none">Ninguna</option>
                      <option value="covert">Cubierta</option>
                      <option value="overt">Manifiesta</option>
                    </select>
                  </label>

                  <div class="art">
                    <div class="art-hd">
                      <span class="lbl">Artefactos</span>
                      <button onclick={() => addArtifact(ch)}>+ Añadir</button>
                    </div>
                    {#if cfg.artifacts.length === 0}
                      <p class="muted">Sin artefactos (hereda del set de ojos activo).</p>
                    {/if}
                    {#each cfg.artifacts as a, i (i)}
                      <div class="art-row">
                        <select
                          value={a.artifact}
                         
                          onchange={(e) => updateArtifact(ch, i, { artifact: (e.currentTarget as HTMLSelectElement).value as ArtifactKind })}
                        >
                          {#each ARTIFACT_OPTIONS as opt}
                            <option value={opt.value}>{opt.label}</option>
                          {/each}
                        </select>
                        <input
                          type="number" min="0" max="1" step="0.05"
                          value={a.probability}
                         
                          oninput={(e) => updateArtifact(ch, i, { probability: +(e.currentTarget as HTMLInputElement).value })}
                        />
                        <button class="del" onclick={() => removeArtifact(ch, i)}>×</button>
                      </div>
                    {/each}
                  </div>
                </div>
              {/each}
            </div>
          </div>

          <div class="grp">
            <div class="grp-title">Canales verticales</div>
            <div class="row">
              {#each VERTICAL_CHANNELS as ch (ch)}
                {@const cfg = activeScenario.channels[ch]}
                <div class="ch-card">
                  <div class="ch-hd">
                    <span class="ch-key">{ch}</span>
                    <span class="ch-name">{CHANNEL_LABELS[ch]}</span>
                  </div>

                  <label class="field">
                    <span class="lbl">Ganancia VOR <em>{cfg.gain.toFixed(2)}</em></span>
                    <input
                      type="range" min="0" max="1.5" step="0.05"
                      value={cfg.gain}
                     
                      oninput={(e) => updateChannel(ch, { gain: +(e.currentTarget as HTMLInputElement).value })}
                    />
                  </label>

                  <label class="field">
                    <span class="lbl">Velocidad pico <em>{cfg.peakVel} °/s</em></span>
                    <input
                      type="range" min="80" max="300" step="5"
                      value={cfg.peakVel}
                     
                      oninput={(e) => updateChannel(ch, { peakVel: +(e.currentTarget as HTMLInputElement).value })}
                    />
                  </label>

                  <label class="field">
                    <span class="lbl">Sacada correctiva</span>
                    <select
                      value={cfg.saccade}
                     
                      onchange={(e) => updateChannel(ch, { saccade: (e.currentTarget as HTMLSelectElement).value as ChannelConfig['saccade'] })}
                    >
                      <option value="none">Ninguna</option>
                      <option value="covert">Cubierta</option>
                      <option value="overt">Manifiesta</option>
                    </select>
                  </label>

                  <div class="art">
                    <div class="art-hd">
                      <span class="lbl">Artefactos</span>
                      <button onclick={() => addArtifact(ch)}>+ Añadir</button>
                    </div>
                    {#if cfg.artifacts.length === 0}
                      <p class="muted">Sin artefactos (hereda del set de ojos activo).</p>
                    {/if}
                    {#each cfg.artifacts as a, i (i)}
                      <div class="art-row">
                        <select
                          value={a.artifact}
                         
                          onchange={(e) => updateArtifact(ch, i, { artifact: (e.currentTarget as HTMLSelectElement).value as ArtifactKind })}
                        >
                          {#each ARTIFACT_OPTIONS as opt}
                            <option value={opt.value}>{opt.label}</option>
                          {/each}
                        </select>
                        <input
                          type="number" min="0" max="1" step="0.05"
                          value={a.probability}
                         
                          oninput={(e) => updateArtifact(ch, i, { probability: +(e.currentTarget as HTMLInputElement).value })}
                        />
                        <button class="del" onclick={() => removeArtifact(ch, i)}>×</button>
                      </div>
                    {/each}
                  </div>
                </div>
              {/each}
            </div>
          </div>
        </section>
      {/if}
    </main>
  </div>
</div>

<style>
  .app { height: 100vh; display: flex; flex-direction: column; }
  .docente {
    flex: 1;
    display: grid;
    grid-template-columns: 240px 1fr;
    min-height: 0;
  }
  aside.left {
    background: var(--surface);
    border-right: 1px solid var(--border);
    overflow-y: auto;
    padding: 12px;
    display: flex; flex-direction: column; gap: 8px;
  }
  .section-title { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--text-muted); font-weight: 600; }
  .left ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .left li { display: flex; align-items: center; gap: 4px; border-radius: var(--radius-sm); overflow: hidden; }
  .left li.active { background: var(--primary-soft); }
  .left li .name {
    flex: 1; text-align: left; padding: 6px 8px;
    background: transparent; border: none; color: var(--text);
    font-size: 12px;
  }
  .left li.active .name { color: var(--primary); font-weight: 600; }
  .left li .del, .left li .dup {
    padding: 4px 8px; background: transparent; border: none;
    color: var(--text-muted); font-size: 14px;
  }
  .left li .del:hover { color: var(--danger); }
  .left li .dup:hover { color: var(--primary); }
  .left .badge { font-size: 10px; margin-right: 4px; }
  .left .empty-li { padding: 6px 8px; font-size: 11px; color: var(--text-muted); font-style: italic; text-align: center; }
  .ext-link {
    display: block; padding: 8px 10px;
    background: var(--accent-soft); color: var(--accent);
    border-radius: var(--radius-sm); text-decoration: none;
    font-size: 12px; font-weight: 600;
    border: 1px solid var(--accent); text-align: center;
    transition: background .15s;
  }
  .ext-link:hover { background: var(--accent); color: white; }

  .canvas { overflow: auto; padding: 16px 24px 32px; background: var(--bg); }
  .empty { padding: 60px 20px; text-align: center; color: var(--text-muted); }

  .hd { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 16px; }
  .hd h2 { margin: 0; font-size: 18px; }
  .hd .desc { margin: 4px 0 0; font-size: 12px; color: var(--text-muted); max-width: 600px; }
  .hd-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .hd-actions .tag {
    background: var(--surface); border: 1px solid var(--border-strong);
    border-radius: 999px; padding: 4px 12px; font-size: 11px; color: var(--text-muted);
  }
  .hd-actions button {
    font-size: 12px; padding: 6px 10px;
    background: var(--surface-2); border: 1px solid var(--border);
    border-radius: var(--radius-sm); cursor: pointer; color: inherit;
  }
  .hd-actions button:hover:not(:disabled) { border-color: var(--primary); }
  .hd-actions button.reset { border-color: var(--warning, #d97706); color: var(--warning, #d97706); }
  .hd-actions button.reset:hover:not(:disabled) { background: var(--warning, #d97706); color: white; }
  .hd-actions button:disabled { opacity: .4; cursor: not-allowed; }

  .grid { display: flex; flex-direction: column; gap: 16px; }
  .grp { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px; }
  .grp-title {
    font-size: 11px; text-transform: uppercase; letter-spacing: .06em;
    color: var(--text-muted); font-weight: 600;
    margin-bottom: 10px; display: flex; align-items: center; gap: 8px;
  }
  .grp-title .soon {
    background: var(--surface-2); color: var(--text-muted);
    font-size: 9px; padding: 2px 6px; border-radius: 999px;
    text-transform: none; letter-spacing: 0; font-weight: 500;
  }
  .row { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }

  .ch-card {
    background: var(--surface-2); border: 1px solid var(--border);
    border-radius: var(--radius-sm); padding: 12px;
    display: flex; flex-direction: column; gap: 10px;
  }
  .ch-hd { display: flex; align-items: baseline; gap: 8px; }
  .ch-key { font-family: ui-monospace, monospace; font-weight: 700; font-size: 14px; color: var(--primary); }
  .ch-name { font-size: 12px; color: var(--text-muted); }

  .field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
  .field .lbl { color: var(--text-muted); font-size: 11px; display: flex; justify-content: space-between; }
  .field .lbl em { color: var(--text); font-style: normal; font-family: ui-monospace, monospace; font-weight: 600; }
  .field input[type="range"] { width: 100%; }
  .field select {
    padding: 4px 6px; border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm); background: var(--surface);
    color: var(--text); font-size: 12px;
  }

  .art { border-top: 1px dashed var(--border); padding-top: 8px; display: flex; flex-direction: column; gap: 6px; }
  .art-hd { display: flex; justify-content: space-between; align-items: center; }
  .art-hd button { font-size: 11px; padding: 3px 8px; }
  .art-row { display: grid; grid-template-columns: 1fr 70px auto; gap: 6px; align-items: center; }
  .art-row select, .art-row input {
    padding: 3px 6px; border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm); background: var(--surface);
    color: var(--text); font-size: 11px;
  }
  .art-row .del { background: transparent; border: none; color: var(--text-muted); font-size: 16px; padding: 0 4px; }
  .art-row .del:hover { color: var(--danger); }
  .muted { color: var(--text-muted); font-size: 11px; font-style: italic; margin: 0; }

  button:disabled { opacity: .4; cursor: not-allowed; }
</style>
