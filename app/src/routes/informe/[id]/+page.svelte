<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import TopBar from '$lib/components/TopBar.svelte';
  import ImpulsePlotStatic from '$lib/components/ImpulsePlotStatic.svelte';
  import { reports, DIAGNOSIS_LABELS, emptyFindings, type Report, type Diagnosis } from '$lib/report.svelte';
  import { scenarios } from '$lib/scenario.svelte';

  let report = $state<Report | null>(null);
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  onMount(() => {
    reports.load();
    scenarios.load();
    const id = page.params.id ?? '';
    const r = reports.get(id);
    if (!r) {
      goto('/informe');
      return;
    }
    if (!r.findings) r.findings = emptyFindings();
    report = r;
  });

  function scheduleSave() {
    if (!report) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (report) reports.upsert($state.snapshot(report) as Report);
    }, 300);
  }

  function gainColor(g: number) {
    if (g >= 0.8) return 'var(--success)';
    if (g >= 0.6) return 'var(--warn)';
    return 'var(--danger)';
  }
  function gainText(g: number) {
    if (g >= 0.8) return 'Normal';
    if (g >= 0.6) return 'Reducida';
    return 'Severamente reducida';
  }

  function impulsesOf(side: 'LL' | 'RL') {
    return report?.impulses.filter((i) => i.side === side) ?? [];
  }

  function submit() {
    if (!report) return;
    if (!report.diagnosis) {
      alert('Selecciona un diagnóstico antes de enviar.');
      return;
    }
    if (!confirm('Una vez enviado el informe queda definitivo. ¿Continuar?')) return;
    report.submitted = true;
    report.submittedAt = Date.now();
    reports.upsert($state.snapshot(report) as Report);
  }

  function downloadPdf() {
    window.print();
  }

  let allScenarios = $derived([...scenarios.examples, ...scenarios.list]);
  let trueScenario = $derived(report ? allScenarios.find((s) => s.id === report!.scenarioId) ?? null : null);

  // resumen del escenario verdadero (para reveal)
  let trueSummary = $derived(() => {
    if (!trueScenario) return null;
    const impulses = trueScenario.nodes.filter((n) => n.type === 'impulse');
    const sides = impulses.map((n) => (n.data as any).side);
    const gains = impulses.map((n) => (n.data as any).gain);
    const saccades = impulses.map((n) => (n.data as any).saccade);
    const artifacts = trueScenario.nodes.filter((n) => n.type === 'artifact').map((n) => (n.data as any).artifact);
    return {
      name: trueScenario.name,
      description: trueScenario.description,
      sides, gains, saccades, artifacts,
    };
  });

  function fmtDate(ts: number) {
    return new Date(ts).toLocaleString('es-CL', { dateStyle: 'long', timeStyle: 'short' });
  }
</script>

{#if report}
  <div class="app">
    <div class="no-print">
      <TopBar />
    </div>

    <main class="page">
      <article class="report">
        <header class="rep-head">
          <div class="brand">
            <img src="/brand/logo-sm.png" alt="" />
            <div>
              <div class="title">SIMHIT</div>
              <div class="sub">Informe vHIT (video Head Impulse Test)</div>
            </div>
          </div>
          <div class="meta">
            <div><strong>Fecha:</strong> {fmtDate(report.date)}</div>
            <div><strong>Examen:</strong> <code>{report.examenCode}</code></div>
            <div>
              {#if report.submitted}
                <span class="tag ok">✓ Enviado</span>
              {:else}
                <span class="tag draft">Borrador</span>
              {/if}
            </div>
          </div>
        </header>

        <section class="datos">
          <h2>Identificación</h2>
          <div class="grid-3">
            <label>
              <span>Profesional responsable</span>
              <input type="text" bind:value={report.examiner} oninput={scheduleSave} disabled={report.submitted} placeholder="Nombre y apellido" />
            </label>
            <label>
              <span>Profesión / cargo</span>
              <input type="text" bind:value={report.examinerTitle} oninput={scheduleSave} disabled={report.submitted} placeholder="Fonoaudiólogo, Otorrino, etc." />
            </label>
            <label>
              <span>Institución</span>
              <input type="text" bind:value={report.institution} oninput={scheduleSave} disabled={report.submitted} placeholder="Centro / clínica" />
            </label>
          </div>
          <h3>Paciente</h3>
          <div class="grid-3">
            <label>
              <span>Nombre y apellido</span>
              <input type="text" bind:value={report.patientName} oninput={scheduleSave} disabled={report.submitted} />
            </label>
            <label>
              <span>RUT / Ficha</span>
              <input type="text" bind:value={report.patientId} oninput={scheduleSave} disabled={report.submitted} />
            </label>
            <label>
              <span>Edad</span>
              <input type="text" bind:value={report.patientAge} oninput={scheduleSave} disabled={report.submitted} placeholder="años" />
            </label>
          </div>
          <label class="full">
            <span>Motivo de consulta / antecedentes relevantes</span>
            <textarea
              rows="2"
              bind:value={report.patientReason}
              oninput={scheduleSave}
              disabled={report.submitted}
              placeholder="Vértigo agudo, mareos, hipoacusia, antecedentes de ototoxicidad, etc."
            ></textarea>
          </label>
        </section>

        <section class="resultados">
          <h2>Resultados cuantitativos</h2>
          <table class="result-table">
            <thead>
              <tr><th>Lado</th><th>Impulsos</th><th>Ganancia VOR</th><th>Interpretación</th></tr>
            </thead>
            <tbody>
              <tr>
                <td><span class="side-chip ll">LL</span> Lateral izquierdo</td>
                <td>{report.countLL}</td>
                <td style:color={gainColor(report.gainLL)}><b>{report.countLL ? report.gainLL.toFixed(2) : '—'}</b></td>
                <td>{report.countLL ? gainText(report.gainLL) : '—'}</td>
              </tr>
              <tr>
                <td><span class="side-chip rl">RL</span> Lateral derecho</td>
                <td>{report.countRL}</td>
                <td style:color={gainColor(report.gainRL)}><b>{report.countRL ? report.gainRL.toFixed(2) : '—'}</b></td>
                <td>{report.countRL ? gainText(report.gainRL) : '—'}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section class="plots">
          <h2>Gráficos por lado</h2>
          <div class="grid-2">
            <div class="plot-card">
              <div class="plot-title"><span class="side-chip ll">LL</span> Lateral izquierdo</div>
              <ImpulsePlotStatic side="LL" impulses={impulsesOf('LL')} />
            </div>
            <div class="plot-card">
              <div class="plot-title"><span class="side-chip rl">RL</span> Lateral derecho</div>
              <ImpulsePlotStatic side="RL" impulses={impulsesOf('RL')} />
            </div>
          </div>
        </section>

        <section class="findings">
          <h2>Hallazgos</h2>
          <div class="check-grid">
            <label><input type="checkbox" bind:checked={report.findings.normal} oninput={scheduleSave} disabled={report.submitted} /> Patrón normal</label>
            <label><input type="checkbox" bind:checked={report.findings.hipofuncion_left} oninput={scheduleSave} disabled={report.submitted} /> Hipofunción izquierda</label>
            <label><input type="checkbox" bind:checked={report.findings.hipofuncion_right} oninput={scheduleSave} disabled={report.submitted} /> Hipofunción derecha</label>
            <label><input type="checkbox" bind:checked={report.findings.bilateral} oninput={scheduleSave} disabled={report.submitted} /> Hipofunción bilateral</label>
            <label><input type="checkbox" bind:checked={report.findings.saccades_covert} oninput={scheduleSave} disabled={report.submitted} /> Sacadas cubiertas (covert)</label>
            <label><input type="checkbox" bind:checked={report.findings.saccades_overt} oninput={scheduleSave} disabled={report.submitted} /> Sacadas manifiestas (overt)</label>
            <label><input type="checkbox" bind:checked={report.findings.artifacts} oninput={scheduleSave} disabled={report.submitted} /> Artefactos durante el registro</label>
          </div>
        </section>

        <section class="interpretation">
          <h2>Interpretación clínica</h2>
          <textarea
            rows="5"
            placeholder="Describí los hallazgos del registro: simetría, ganancia VOR, presencia y tipo de sacadas correctivas, calidad del registro, etc."
            bind:value={report.interpretation}
            oninput={scheduleSave}
            disabled={report.submitted}
          ></textarea>
        </section>

        <section class="diagnosis">
          <h2>Diagnóstico / impresión</h2>
          <select bind:value={report.diagnosis} oninput={scheduleSave} disabled={report.submitted}>
            <option value="">— seleccionar —</option>
            {#each Object.entries(DIAGNOSIS_LABELS) as [k, label]}
              <option value={k}>{label}</option>
            {/each}
          </select>
          <textarea
            rows="3"
            placeholder="Comentarios adicionales, recomendaciones, sugerencias de seguimiento..."
            bind:value={report.comments}
            oninput={scheduleSave}
            disabled={report.submitted}
          ></textarea>
        </section>

        <footer class="rep-foot">
          <div class="meta-foot">
            <div><strong>Equipo:</strong> SimHIT</div>
            {#if report.institution}
              <div><strong>Institución:</strong> {report.institution}</div>
            {/if}
          </div>
          <div class="signature">
            <div class="line"></div>
            <div>{report.examiner || '__________________'}</div>
            <div class="role">{report.examinerTitle || 'Profesional responsable'}</div>
          </div>
        </footer>

        {#if report.submitted && trueScenario}
          {@const summary = trueSummary()}
          <section class="reveal no-print">
            <h2>📋 Solución del caso</h2>
            <div class="reveal-card">
              <div class="reveal-name">{summary?.name}</div>
              {#if summary?.description}
                <p class="reveal-desc">{summary.description}</p>
              {/if}
              <table class="reveal-table">
                <tbody>
                  <tr><th>Lados configurados</th><td>{summary?.sides.join(', ')}</td></tr>
                  <tr><th>Ganancias esperadas</th><td>{summary?.gains.map((g: number) => g.toFixed(2)).join(', ')}</td></tr>
                  <tr><th>Sacadas configuradas</th><td>{summary?.saccades.join(', ')}</td></tr>
                  {#if summary?.artifacts.length}
                    <tr><th>Artefactos</th><td>{summary.artifacts.join(', ')}</td></tr>
                  {/if}
                </tbody>
              </table>
            </div>
          </section>
        {/if}
      </article>

      <aside class="actions no-print">
        {#if !report.submitted}
          <button class="primary big" onclick={submit}>Enviar informe</button>
          <p class="hint">Borrador autoguardado.<br>Una vez enviado el informe queda inmodificable.</p>
        {:else}
          <button class="primary big" onclick={downloadPdf}>⬇ Descargar PDF</button>
          <p class="hint">En el diálogo seleccioná "Guardar como PDF".</p>
        {/if}
        <button onclick={() => goto('/informe')}>← Volver a informes</button>
      </aside>
    </main>
  </div>
{:else}
  <p>Cargando...</p>
{/if}

<style>
  .app { min-height: 100vh; background: var(--bg); display: flex; flex-direction: column; }
  .page {
    display: grid;
    grid-template-columns: 1fr 240px;
    gap: 16px;
    padding: 16px;
    max-width: 1200px;
    width: 100%;
    margin: 0 auto;
    box-sizing: border-box;
  }
  .report {
    display: flex; flex-direction: column; gap: 14px;
  }
  .rep-head {
    display: flex; justify-content: space-between; align-items: center;
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 14px 18px; box-shadow: var(--shadow-sm);
  }
  .brand { display: flex; align-items: center; gap: 12px; }
  .brand img { width: 40px; height: 40px; }
  .title { font-size: 18px; font-weight: 800; letter-spacing: .08em; }
  .sub { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: .05em; }
  .meta { font-size: 12px; text-align: right; line-height: 1.6; }
  .meta code { font-family: ui-monospace, monospace; background: var(--primary-soft); color: var(--primary); padding: 2px 6px; border-radius: 4px; }
  .tag { padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; }
  .tag.ok { background: var(--success); color: white; }
  .tag.draft { background: var(--warn); color: white; }

  section {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 14px 18px; box-shadow: var(--shadow-sm);
  }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--primary); margin: 0 0 12px; padding-bottom: 6px; border-bottom: 1px solid var(--border); }

  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
  h3 { font-size: 12px; text-transform: uppercase; color: var(--text-muted); letter-spacing: .04em; margin: 14px 0 6px; }
  label.full { display: block; margin-top: 8px; }
  .meta-foot { font-size: 11px; color: var(--text-muted); }
  label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
  label span { color: var(--text-muted); font-weight: 600; font-size: 11px; }
  input[type="text"], select, textarea {
    font: inherit; font-size: 13px;
    padding: 6px 10px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    width: 100%;
    box-sizing: border-box;
  }
  textarea { resize: vertical; font-family: inherit; line-height: 1.5; }
  input:disabled, select:disabled, textarea:disabled { background: var(--surface-2); color: var(--text); cursor: default; }

  .result-table, .reveal-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .result-table th, .result-table td, .reveal-table th, .reveal-table td { padding: 8px 12px; text-align: left; border-bottom: 1px solid var(--border); }
  .result-table th { background: var(--surface-2); font-size: 11px; text-transform: uppercase; color: var(--text-muted); }
  .reveal-table th { width: 40%; color: var(--text-muted); font-weight: 600; }

  .side-chip { display: inline-block; padding: 1px 6px; border-radius: 3px; color: white; font-size: 10px; font-weight: 700; margin-right: 4px; letter-spacing: .04em; }
  .side-chip.ll { background: var(--side-ll); }
  .side-chip.rl { background: var(--side-rl); }

  .plot-card { background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 8px; }
  .plot-title { font-size: 12px; font-weight: 600; margin-bottom: 4px; }

  .check-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; font-size: 13px; }
  .check-grid label { flex-direction: row; align-items: center; gap: 6px; }
  .check-grid input { accent-color: var(--primary); }

  .diagnosis select { margin-bottom: 8px; }

  .rep-foot {
    display: flex; justify-content: space-between; align-items: flex-end; gap: 20px;
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 14px 18px; box-shadow: var(--shadow-sm);
  }
  .signature { text-align: center; min-width: 240px; font-size: 12px; }
  .signature .line { border-top: 1px solid var(--text); margin-bottom: 6px; }
  .signature .role { color: var(--text-muted); font-size: 10px; text-transform: uppercase; letter-spacing: .04em; }

  .reveal { margin-top: 24px; }
  .reveal h2 { color: var(--accent); }
  .reveal-card {
    background: var(--accent-soft);
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    padding: 12px 16px;
  }
  .reveal-name { font-size: 16px; font-weight: 700; color: var(--accent); margin-bottom: 4px; }
  .reveal-desc { color: var(--text-muted); font-style: italic; margin: 0 0 10px; font-size: 12px; }

  .actions { display: flex; flex-direction: column; gap: 10px; padding: 16px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); height: fit-content; position: sticky; top: 16px; }
  .actions button { width: 100%; }
  .actions button.big { padding: 10px 14px; font-size: 14px; }
  .hint { font-size: 11px; color: var(--text-muted); margin: 0; line-height: 1.4; }

  @media print {
    .no-print { display: none !important; }
    @page { size: A4; margin: 14mm 16mm; }
    .app, .page { background: white; padding: 0; max-width: none; display: block; }
    .report { gap: 8px; }
    section, .rep-head, .rep-foot {
      box-shadow: none; border: none; border-radius: 0; padding: 6px 0;
      background: white;
    }
    section { border-top: 1px solid #ddd; }
    .rep-head { border-bottom: 2px solid #333; padding-bottom: 8px; }
    .rep-foot { border-top: 1px solid #ddd; padding-top: 14px; }
    h2 { color: #333; border-color: #ddd; }
    .reveal { display: none; }
  }
</style>
