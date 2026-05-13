<script lang="ts">
  import { onMount } from 'svelte';
  import TopBar from '$lib/components/TopBar.svelte';
  import { bundles, defaultGoals, type Escenario, type BundleKind, type PracticeGoal, type PracticeOrder, type PracticeMode } from '$lib/bundle.svelte';
  import { scenarios, CHANNELS, CHANNEL_LABELS, type Channel } from '$lib/scenario.svelte';
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

  async function newBundle(kind: BundleKind = 'clinico') {
    const defaultName = kind === 'clinico' ? 'Nuevo escenario'
      : kind === 'practica-horiz' ? 'Práctica horizontal'
      : kind === 'practica-vert' ? 'Práctica vertical'
      : 'Práctica multicanal';
    const name = await ui.prompt('Nombre del escenario', defaultName);
    if (!name) return;
    bundles.create(name, kind);
  }

  function setGoals(goals: PracticeGoal[]) {
    if (!active) return;
    bundles.update(active.id, { goals });
  }
  function addGoal(acceptanceId: string) {
    if (!active) return;
    const cur = active.goals ?? [];
    if (cur.some((g) => g.acceptanceId === acceptanceId)) return;
    setGoals([...cur, { acceptanceId, count: 3 }]);
  }
  function updateGoalCount(acceptanceId: string, count: number) {
    if (!active) return;
    const cur = active.goals ?? [];
    setGoals(cur.map((g) => g.acceptanceId === acceptanceId ? { ...g, count: Math.max(0, count | 0) } : g));
  }
  /** En 'practica-multi' los goals pueden repetir acceptanceId con distintos
   *  targetChannel. La clave estable es el índice de posición. */
  function updateGoalCountAt(idx: number, count: number) {
    if (!active) return;
    const cur = (active.goals ?? []).slice();
    if (idx < 0 || idx >= cur.length) return;
    cur[idx] = { ...cur[idx], count: Math.max(0, count | 0) };
    setGoals(cur);
  }
  function updateGoalChannelAt(idx: number, ch: Channel | '') {
    if (!active) return;
    const cur = (active.goals ?? []).slice();
    if (idx < 0 || idx >= cur.length) return;
    const next: PracticeGoal = { acceptanceId: cur[idx].acceptanceId, count: cur[idx].count };
    if (ch) next.targetChannel = ch;
    cur[idx] = next;
    setGoals(cur);
  }
  function removeGoalAt(idx: number) {
    if (!active) return;
    const cur = (active.goals ?? []).slice();
    if (idx < 0 || idx >= cur.length) return;
    cur.splice(idx, 1);
    setGoals(cur);
  }
  function moveGoalAt(idx: number, dir: -1 | 1) {
    if (!active) return;
    const cur = (active.goals ?? []).slice();
    const j = idx + dir;
    if (idx < 0 || j < 0 || j >= cur.length) return;
    [cur[idx], cur[j]] = [cur[j], cur[idx]];
    setGoals(cur);
  }
  function addMultiGoal(acceptanceId: string, channel: Channel) {
    if (!active) return;
    const cur = active.goals ?? [];
    setGoals([...cur, { acceptanceId, count: 5, targetChannel: channel }]);
  }
  function removeGoal(acceptanceId: string) {
    if (!active) return;
    const cur = active.goals ?? [];
    setGoals(cur.filter((g) => g.acceptanceId !== acceptanceId));
  }
  function moveGoal(acceptanceId: string, dir: -1 | 1) {
    if (!active) return;
    const cur = (active.goals ?? []).slice();
    const i = cur.findIndex((g) => g.acceptanceId === acceptanceId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= cur.length) return;
    [cur[i], cur[j]] = [cur[j], cur[i]];
    setGoals(cur);
  }
  function setOrder(order: PracticeOrder) {
    if (!active) return;
    bundles.update(active.id, { order });
  }
  function setMode(mode: PracticeMode) {
    if (!active) return;
    bundles.update(active.id, { mode });
  }
  function setKind(kind: BundleKind) {
    if (!active) return;
    const patch: Partial<Escenario> = { kind };
    if (kind !== 'clinico' && !active.goals) {
      patch.goals = defaultGoals();
      patch.order = 'random';
      patch.mode = 'attempts';
    }
    bundles.update(active.id, patch);
  }
  function kindLabel(k: BundleKind) {
    return k === 'clinico' ? 'Clínico'
      : k === 'practica-horiz' ? 'Práctica H'
      : k === 'practica-vert' ? 'Práctica V'
      : 'Práctica M';
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
  let goalsView = $derived<PracticeGoal[]>(active?.goals ?? []);
  let goalsTotal = $derived(goalsView.reduce((a, g) => a + g.count, 0));
  let availableLevels = $derived(
    acceptance.all.filter((p) => !goalsView.some((g) => g.acceptanceId === p.id))
  );
  function levelName(id: string) {
    return acceptance.all.find((p) => p.id === id)?.name ?? id;
  }
  let casoActive = $derived(active ? allCasos.find((c) => c.id === active.casoId) : null);
  let acceptanceActive = $derived(active ? acceptance.all.find((a) => a.id === active.acceptanceId) : null);
  let eyesetActive = $derived(active ? eyeset.sets.find((e) => e.id === active.eyesetId) : null);
</script>

<div class="app">
  <TopBar />

  <div class="docente">
    <aside class="left">
      <div class="section-title">Escenarios</div>
      <button class="primary" onclick={() => newBundle('clinico')}>+ Clínico</button>
      <button class="primary alt" onclick={() => newBundle('practica-horiz')}>+ Práctica H</button>
      <button class="primary alt" onclick={() => newBundle('practica-vert')}>+ Práctica V</button>
      <button class="primary alt" onclick={() => newBundle('practica-multi')}>+ Práctica M</button>
      <ul>
        {#each bundles.list as b (b.id)}
          <li class:active={b.id === bundles.activeId}>
            <button class="name" onclick={() => pick(b.id)}>
              {#if b.id === bundles.activeId}<span class="dot">●</span>{/if}
              {b.name}
              <span class="kind-tag kind-{b.kind}">{kindLabel(b.kind)}</span>
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
          <button class="primary big" onclick={() => newBundle('clinico')}>+ Nuevo escenario</button>
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

        <section class="kind-row">
          <span class="kind-lab">Tipo:</span>
          <select value={active.kind} onchange={(e) => setKind((e.currentTarget as HTMLSelectElement).value as BundleKind)}>
            <option value="clinico">Clínico</option>
            <option value="practica-horiz">Práctica — Horizontal</option>
            <option value="practica-vert">Práctica — Vertical</option>
            <option value="practica-multi">Práctica — Multicanal (6 canales)</option>
          </select>
        </section>

        {#if active.kind !== 'clinico'}
          <section class="parts practice-cfg">
            <div class="part">
              <div class="part-head">
                <h3>⚙️ Configuración de la práctica</h3>
              </div>
              <div class="cfg-grid">
                <label class="cfg-field">
                  <span>Orden de objetivos</span>
                  <select value={active.order ?? 'random'}
                    onchange={(e) => setOrder((e.currentTarget as HTMLSelectElement).value as PracticeOrder)}>
                    <option value="random">Aleatorio (mezclados)</option>
                    <option value="sequential">Secuencial (en el orden de la lista)</option>
                  </select>
                </label>
                <label class="cfg-field">
                  <span>Finaliza cuando</span>
                  <select value={active.mode ?? 'attempts'}
                    onchange={(e) => setMode((e.currentTarget as HTMLSelectElement).value as PracticeMode)}>
                    <option value="attempts">Se completen los intentos pedidos (cuenta cada impulso)</option>
                    <option value="hits">Se logren los aciertos pedidos por nivel (los fallos no cuentan)</option>
                  </select>
                </label>
              </div>
              <p class="muted small">
                Canales: {active.kind === 'practica-horiz' ? 'horizontales (LL/RL)'
                  : active.kind === 'practica-vert' ? 'verticales (LA/RP/RA/LP)'
                  : 'los 6 canales — cada objetivo fija un canal específico'}.
              </p>
            </div>

            <div class="part">
              <div class="part-head">
                <h3>🎯 Objetivos de la práctica</h3>
                <a class="edit-link" href="/docente/dificultad">Editar niveles →</a>
              </div>

              {#if active.kind === 'practica-multi'}
                <!-- Multi: cada goal lleva un targetChannel obligatorio. La clave
                     estable es el índice (no acceptanceId) porque puede repetirse. -->
                {#if goalsView.length === 0}
                  <p class="muted">— sin objetivos —</p>
                {:else}
                  <ul class="goal-list multi">
                    {#each goalsView as g, i (i)}
                      <li>
                        <select class="g-channel"
                          value={g.targetChannel ?? ''}
                          onchange={(e) => updateGoalChannelAt(i, (e.currentTarget as HTMLSelectElement).value as Channel | '')}
                        >
                          <option value="">— canal —</option>
                          {#each CHANNELS as c (c)}
                            <option value={c}>{c} · {CHANNEL_LABELS[c]}</option>
                          {/each}
                        </select>
                        <div class="g-name muted small">{levelName(g.acceptanceId)}</div>
                        <input class="g-count" type="number" min="0" max="99" value={g.count}
                          oninput={(e) => updateGoalCountAt(i, +(e.currentTarget as HTMLInputElement).value)} />
                        <span class="g-unit">{active.mode === 'hits' ? 'aciertos' : 'intentos'}</span>
                        <button class="g-mv" disabled={i === 0} onclick={() => moveGoalAt(i, -1)} title="Subir">↑</button>
                        <button class="g-mv" disabled={i === goalsView.length - 1} onclick={() => moveGoalAt(i, 1)} title="Bajar">↓</button>
                        <button class="g-del" onclick={() => removeGoalAt(i)} title="Quitar">×</button>
                      </li>
                    {/each}
                  </ul>
                  <div class="g-total">Total: <b>{goalsTotal}</b> {active.mode === 'hits' ? 'aciertos' : 'intentos'}</div>
                {/if}
                <div class="g-add">
                  <span class="muted small">Agregar objetivo por canal:</span>
                  {#each CHANNELS as c (c)}
                    <button class="g-add-btn" onclick={() => addMultiGoal(active.acceptanceId, c)}>+ {c}</button>
                  {/each}
                </div>
              {:else}
                {#if goalsView.length === 0}
                  <p class="muted">— sin objetivos —</p>
                {:else}
                  <ul class="goal-list">
                    {#each goalsView as g, i (g.acceptanceId)}
                      <li>
                        <div class="g-name"><b>{levelName(g.acceptanceId)}</b></div>
                        <input class="g-count" type="number" min="0" max="99" value={g.count}
                          oninput={(e) => updateGoalCount(g.acceptanceId, +(e.currentTarget as HTMLInputElement).value)} />
                        <span class="g-unit">{active.mode === 'hits' ? 'aciertos' : 'intentos'}</span>
                        <button class="g-mv" disabled={i === 0} onclick={() => moveGoal(g.acceptanceId, -1)} title="Subir">↑</button>
                        <button class="g-mv" disabled={i === goalsView.length - 1} onclick={() => moveGoal(g.acceptanceId, 1)} title="Bajar">↓</button>
                        <button class="g-del" onclick={() => removeGoal(g.acceptanceId)} title="Quitar">×</button>
                      </li>
                    {/each}
                  </ul>
                  <div class="g-total">Total: <b>{goalsTotal}</b> {active.mode === 'hits' ? 'aciertos' : 'intentos'}</div>
                {/if}

                {#if availableLevels.length}
                  <div class="g-add">
                    <span class="muted small">Agregar nivel:</span>
                    {#each availableLevels as p (p.id)}
                      <button class="g-add-btn" onclick={() => addGoal(p.id)}>+ {p.name}</button>
                    {/each}
                  </div>
                {:else}
                  <p class="muted small">Todos los niveles están agregados. Crea más en el editor de niveles.</p>
                {/if}
              {/if}
            </div>
          </section>
        {:else}
        <section class="parts">
          <!-- Parte 1: Caso clínico -->
          <div class="part">
            <div class="part-head">
              <h3>🩺 Caso clínico</h3>
              <a class="edit-link" href="/docente/caso">Editar →</a>
            </div>
            <select value={active.casoId} onchange={(e) => setCaso((e.currentTarget as HTMLSelectElement).value)}>
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
            <select value={active.acceptanceId} onchange={(e) => setAcceptance((e.currentTarget as HTMLSelectElement).value)}>
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
                <div><span>Amplitud</span> ±{acceptanceActive.yawTol}° H / ±{acceptanceActive.pitchTol}° V / ±{acceptanceActive.rollTol}° R</div>
                <div><span>Pico</span> {acceptanceActive.peakMin}–{acceptanceActive.peakMax} °/s</div>
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
            <select value={active.eyesetId} onchange={(e) => setEyeset((e.currentTarget as HTMLSelectElement).value)}>
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
  button.primary.alt { background: var(--surface-2); color: var(--text); border: 1px solid var(--border-strong); }
  button.primary.alt:hover { background: var(--primary-soft); color: var(--primary); }
  .kind-tag {
    margin-left: 6px; font-size: 9px; padding: 1px 5px; border-radius: 3px;
    background: var(--surface-2); color: var(--text-muted);
    text-transform: uppercase; letter-spacing: .04em; font-weight: 700;
  }
  .kind-tag.kind-practica-horiz { background: #fde68a; color: #92400e; }
  .kind-tag.kind-practica-vert { background: #c7d2fe; color: #3730a3; }
  .kind-tag.kind-practica-multi { background: #bbf7d0; color: #14532d; }

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

  .kind-row {
    display: flex; align-items: center; gap: 8px;
    background: var(--surface-2); border: 1px solid var(--border);
    border-radius: var(--radius-sm); padding: 8px 12px;
  }
  .kind-lab { font-size: 12px; color: var(--text-muted); font-weight: 600; }
  .kind-row select { width: auto; flex: 1; max-width: 360px; }

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

  .cfg-grid { display: flex; flex-direction: column; gap: 10px; }
  .cfg-field { display: flex; flex-direction: column; gap: 4px; }
  .cfg-field span {
    font-size: 11px; color: var(--text-muted); text-transform: uppercase;
    letter-spacing: .04em; font-weight: 600;
  }
  .goal-list { list-style: none; margin: 0 0 8px; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .goal-list li {
    display: grid;
    grid-template-columns: 1fr 80px 70px 28px 28px 28px;
    gap: 8px; align-items: center;
    padding: 6px 10px;
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius-sm);
  }
  /* Variante multi: añade columna `canal` antes del nombre del nivel. */
  .goal-list.multi li {
    grid-template-columns: 170px 1fr 80px 70px 28px 28px 28px;
  }
  .g-channel {
    font: inherit; font-size: 12px;
    padding: 4px 8px; border: 1px solid var(--border-strong);
    border-radius: 4px; background: var(--surface-2); color: var(--text);
  }
  .g-name { font-size: 13px; }
  .g-count {
    font: inherit; font-size: 16px; font-family: ui-monospace, monospace;
    padding: 4px 8px; border: 1px solid var(--border-strong);
    border-radius: 4px; background: var(--surface-2); color: var(--text);
    text-align: center;
  }
  .g-unit { font-size: 11px; color: var(--text-muted); }
  .g-mv, .g-del {
    width: 26px; height: 26px; padding: 0; font-size: 13px; line-height: 1;
    background: var(--surface-2); border: 1px solid var(--border);
    border-radius: 4px; cursor: pointer;
  }
  .g-mv:hover { border-color: var(--primary); color: var(--primary); }
  .g-mv:disabled { opacity: .35; cursor: not-allowed; }
  .g-del:hover { background: var(--danger); color: white; border-color: var(--danger); }
  .g-total { font-size: 13px; padding: 4px 0; }
  .g-total b { font-family: ui-monospace, monospace; color: var(--primary); font-size: 16px; }
  .g-add {
    display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
    padding-top: 6px; border-top: 1px dashed var(--border);
  }
  .g-add-btn {
    font-size: 12px; padding: 4px 10px;
    background: var(--surface-2); border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm); cursor: pointer;
    color: var(--text);
  }
  .g-add-btn:hover { background: var(--primary-soft); color: var(--primary); border-color: var(--primary); }
</style>
