<script lang="ts">
  import TopBar from '$lib/components/TopBar.svelte';
  import { acceptance, type AcceptanceCfg, type AcceptancePreset } from '$lib/acceptance.svelte';
  import { ui } from '$lib/dialog.svelte';

  let active = $derived(acceptance.active);
  let editable = $derived(!active.builtin);

  function pick(id: string) { acceptance.setActive(id); }

  async function createCustom() {
    const name = await ui.prompt('Nombre del nivel', 'Mi nivel');
    if (!name) return;
    acceptance.create(name);
  }

  async function deletePreset(p: AcceptancePreset) {
    if (p.builtin) return;
    if (!(await ui.confirm(`Eliminar "${p.name}"`, 'Esta acción no se puede deshacer.', { danger: true }))) return;
    acceptance.remove(p.id);
  }

  async function renameActive() {
    if (!editable) return;
    const name = await ui.prompt('Nuevo nombre', active.name);
    if (!name) return;
    acceptance.update(active.id, { name });
  }

  function patch(p: Partial<AcceptanceCfg> & { clinicallyValid?: boolean }) {
    if (!editable) return;
    acceptance.update(active.id, p);
  }

  /** Badge visual de validez clínica por preset. */
  function clinicalBadge(p: { id: string; clinicallyValid: boolean }): { txt: string; cls: string } {
    if (p.id === 'inicial')  return { txt: '❌ No clínico',    cls: 'no-clin' };
    if (p.id === 'basico')   return { txt: '⚠ Límite',         cls: 'limit' };
    if (p.id === 'estandar') return { txt: '✅ Clínico',        cls: 'clin' };
    if (p.id === 'avanzado') return { txt: '✅✅ Experto',      cls: 'expert' };
    return p.clinicallyValid
      ? { txt: '✅ Clínico (custom)', cls: 'clin' }
      : { txt: '❌ No clínico (custom)', cls: 'no-clin' };
  }

  function parseAccel(s: string): number | null {
    const t = s.trim();
    if (t === '' || t === '-') return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }

  async function duplicateActive() {
    const name = await ui.prompt('Nombre del nuevo nivel', `${active.name} (copia)`);
    if (!name) return;
    acceptance.create(name, active);
  }
</script>

<div class="app">
  <TopBar />

  <div class="docente">
    <aside class="left">
      <a class="ext-link" href="/docente">← Volver a escenarios</a>

      <div class="section-title">Niveles predefinidos</div>
      <ul>
        {#each acceptance.all.filter((p) => p.builtin) as p (p.id)}
          {@const cb = clinicalBadge(p)}
          <li class:active={p.id === acceptance.activeId}>
            <button class="name" onclick={() => pick(p.id)}>
              <span class="badge">📚</span>{p.name}
              <span class="clin-badge {cb.cls}" title="Validez clínica">{cb.txt}</span>
            </button>
          </li>
        {/each}
      </ul>

      <div class="section-title">Mis niveles</div>
      <button class="primary" onclick={createCustom}>+ Nuevo</button>
      <ul>
        {#each acceptance.all.filter((p) => !p.builtin) as p (p.id)}
          <li class:active={p.id === acceptance.activeId}>
            <button class="name" onclick={() => pick(p.id)}>{p.name}</button>
            <button class="del" onclick={() => deletePreset(p)} title="Eliminar">×</button>
          </li>
        {:else}
          <li class="empty-li">— vacío —</li>
        {/each}
      </ul>
    </aside>

    <main class="canvas">
      <header class="hd">
        <div class="hd-title">
          <h2>{active.name}</h2>
          <p class="desc">
            {#if active.builtin}
              📚 Nivel predefinido — solo lectura. Duplicalo para editar.
            {:else}
              Editable. Los cambios se aplican al simulador en tiempo real.
            {/if}
          </p>
        </div>
        <div class="hd-actions">
          <button onclick={duplicateActive}>⎘ Duplicar</button>
          {#if editable}
            <button onclick={renameActive}>Renombrar</button>
          {/if}
        </div>
      </header>

      <section class="grid">
        <div class="grp">
          <h3>Validez clínica</h3>
          <p class="hint">Si está desactivado, el preset no aparecerá como opción para examen clínico (sí se puede usar en práctica formativa).</p>
          <label class="row-line">
            <input type="checkbox" checked={active.clinicallyValid} disabled={!editable}
              onchange={(e) => patch({ clinicallyValid: (e.currentTarget as HTMLInputElement).checked })} />
            <span>Apto para examen clínico</span>
          </label>
        </div>

        <div class="grp">
          <h3>Tolerancia de pose inicial</h3>
          <p class="hint">Error angular máximo (yaw/pitch/roll) que se acepta en la pose inicial antes del impulso. Por encima, el impulso se invalida.</p>
          <label>
            <span>Tolerancia (°)</span>
            <input type="number" min="1" max="45" step="1"
              value={active.poseTolDeg} disabled={!editable}
              oninput={(e) => patch({ poseTolDeg: +(e.currentTarget as HTMLInputElement).value })} />
          </label>
        </div>

        <div class="grp">
          <h3>Amplitud máxima del impulso (zona verde)</h3>
          <p class="hint">Recorrido angular máximo permitido durante el hit. Si la cabeza se mueve más que esto, el impulso falla. Más amplio = más fácil.</p>
          <label>
            <span>Horizontal — yaw (°)</span>
            <input type="number" min="1" max="60" step="1"
              value={active.yawTol} disabled={!editable}
              oninput={(e) => patch({ yawTol: +(e.currentTarget as HTMLInputElement).value })} />
          </label>
          <label>
            <span>Vertical — pitch (°)</span>
            <input type="number" min="1" max="60" step="1"
              value={active.pitchTol} disabled={!editable}
              oninput={(e) => patch({ pitchTol: +(e.currentTarget as HTMLInputElement).value })} />
          </label>
          <label>
            <span>Inclinación — roll (°)</span>
            <input type="number" min="1" max="60" step="1"
              value={active.rollTol} disabled={!editable}
              oninput={(e) => patch({ rollTol: +(e.currentTarget as HTMLInputElement).value })} />
          </label>
        </div>

        <div class="grp">
          <h3>Amplitud mínima del impulso</h3>
          <p class="hint">Mínimo desplazamiento angular eficaz. Por debajo, el impulso se considera demasiado pequeño.</p>
          <label>
            <span>Horizontal — ampMin H (°)</span>
            <input type="number" min="0" max="30" step="1"
              value={active.ampMinH} disabled={!editable}
              oninput={(e) => patch({ ampMinH: +(e.currentTarget as HTMLInputElement).value })} />
          </label>
          <label>
            <span>Vertical — ampMin V (°)</span>
            <input type="number" min="0" max="30" step="1"
              value={active.ampMinV} disabled={!editable}
              oninput={(e) => patch({ ampMinV: +(e.currentTarget as HTMLInputElement).value })} />
          </label>
        </div>

        <div class="grp">
          <h3>Velocidad pico (°/s)</h3>
          <p class="hint">Pico de velocidad cefálica aceptable durante el impulso.</p>
          <label>
            <span>Mínima</span>
            <input type="number" min="30" max="300" step="5"
              value={active.peakMin} disabled={!editable}
              oninput={(e) => patch({ peakMin: +(e.currentTarget as HTMLInputElement).value })} />
          </label>
          <label>
            <span>Máxima</span>
            <input type="number" min="100" max="500" step="5"
              value={active.peakMax} disabled={!editable}
              oninput={(e) => patch({ peakMax: +(e.currentTarget as HTMLInputElement).value })} />
          </label>
        </div>

        <div class="grp">
          <h3>Duración (ms)</h3>
          <p class="hint">Duración aceptable del impulso de inicio a fin de movimiento.</p>
          <label>
            <span>Mínima</span>
            <input type="number" min="30" max="300" step="10"
              value={active.durMinMs} disabled={!editable}
              oninput={(e) => patch({ durMinMs: +(e.currentTarget as HTMLInputElement).value })} />
          </label>
          <label>
            <span>Máxima</span>
            <input type="number" min="100" max="600" step="10"
              value={active.durMaxMs} disabled={!editable}
              oninput={(e) => patch({ durMaxMs: +(e.currentTarget as HTMLInputElement).value })} />
          </label>
        </div>

        <div class="grp">
          <h3>Aceleración pico (°/s²) — opcional</h3>
          <p class="hint">Rango de aceleración pico estimada. Dejar vacío para ignorar el detector en este nivel (útil para principiantes).</p>
          <label>
            <span>Horizontal — mín H</span>
            <input type="number" min="0" max="10000" step="100"
              value={active.accelMinH ?? ''} disabled={!editable}
              placeholder="ignorar"
              oninput={(e) => patch({ accelMinH: parseAccel((e.currentTarget as HTMLInputElement).value) })} />
          </label>
          <label>
            <span>Horizontal — máx H</span>
            <input type="number" min="0" max="10000" step="100"
              value={active.accelMaxH ?? ''} disabled={!editable}
              placeholder="ignorar"
              oninput={(e) => patch({ accelMaxH: parseAccel((e.currentTarget as HTMLInputElement).value) })} />
          </label>
          <label>
            <span>Vertical — mín V</span>
            <input type="number" min="0" max="10000" step="100"
              value={active.accelMinV ?? ''} disabled={!editable}
              placeholder="ignorar"
              oninput={(e) => patch({ accelMinV: parseAccel((e.currentTarget as HTMLInputElement).value) })} />
          </label>
          <label>
            <span>Vertical — máx V</span>
            <input type="number" min="0" max="10000" step="100"
              value={active.accelMaxV ?? ''} disabled={!editable}
              placeholder="ignorar"
              oninput={(e) => patch({ accelMaxV: parseAccel((e.currentTarget as HTMLInputElement).value) })} />
          </label>
        </div>
      </section>
    </main>
  </div>
</div>

<style>
  .app { min-height: 100vh; background: var(--bg); display: flex; flex-direction: column; }
  .docente { flex: 1; display: grid; grid-template-columns: 260px 1fr; gap: 12px; padding: 12px; }
  aside.left {
    background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
    padding: 10px; box-shadow: var(--shadow-sm); display: flex; flex-direction: column; gap: 8px;
    overflow-y: auto;
  }
  .ext-link {
    font-size: 12px; padding: 6px 10px; background: var(--surface-2); border: 1px solid var(--border);
    border-radius: var(--radius-sm); color: var(--text); text-decoration: none; text-align: center;
  }
  .ext-link:hover { border-color: var(--primary); }
  .section-title {
    font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--text-muted);
    margin-top: 6px; padding-bottom: 4px; border-bottom: 1px solid var(--border);
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
  .badge { margin-right: 4px; }
  .del {
    width: 22px; height: 22px; padding: 0; font-size: 14px; line-height: 1;
    background: transparent; border: 1px solid var(--border); border-radius: 4px; cursor: pointer;
  }
  .del:hover { background: var(--danger); color: white; border-color: var(--danger); }
  button.primary {
    background: var(--primary); color: white; border: none; padding: 6px 10px;
    border-radius: var(--radius-sm); font-size: 12px; cursor: pointer;
  }

  main.canvas {
    background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
    padding: 16px; box-shadow: var(--shadow-sm); display: flex; flex-direction: column; gap: 12px;
    overflow-y: auto;
  }
  .hd { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
  .hd-title h2 { margin: 0 0 4px; font-size: 18px; }
  .hd-title .desc { margin: 0; color: var(--text-muted); font-size: 12px; }
  .hd-actions { display: flex; gap: 6px; }
  .hd-actions button {
    background: var(--surface-2); border: 1px solid var(--border); padding: 6px 10px;
    border-radius: var(--radius-sm); font-size: 12px; cursor: pointer; color: inherit;
  }
  .hd-actions button:hover { border-color: var(--primary); }

  .grid {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px;
  }
  .grp {
    background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius-sm);
    padding: 12px; display: flex; flex-direction: column; gap: 8px;
  }
  .grp h3 { margin: 0; font-size: 13px; color: var(--primary); }
  .grp .hint { margin: 0 0 4px; color: var(--text-muted); font-size: 11px; line-height: 1.4; }
  .grp label { display: flex; flex-direction: column; gap: 3px; font-size: 12px; }
  .grp label span { color: var(--text-muted); font-weight: 600; font-size: 11px; }
  .grp input {
    font: inherit; font-size: 13px; padding: 5px 8px;
    border: 1px solid var(--border-strong); border-radius: var(--radius-sm);
    background: var(--surface); color: var(--text);
  }
  .grp input:disabled { background: var(--surface); color: var(--text-muted); cursor: not-allowed; }
  .row-line {
    flex-direction: row !important; align-items: center; gap: 8px !important;
  }
  .row-line input[type="checkbox"] { width: auto; }
  .clin-badge {
    display: inline-block;
    margin-left: 6px;
    padding: 1px 6px;
    border-radius: 999px;
    font-size: 10px;
    font-weight: 700;
    line-height: 1.4;
    vertical-align: middle;
  }
  .clin-badge.no-clin { background: #fee2e2; color: #991b1b; }
  .clin-badge.limit   { background: #fef3c7; color: #92400e; }
  .clin-badge.clin    { background: #dcfce7; color: #166534; }
  .clin-badge.expert  { background: #c7d2fe; color: #3730a3; }
</style>
