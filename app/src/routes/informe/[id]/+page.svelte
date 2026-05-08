<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import TopBar from '$lib/components/TopBar.svelte';
  import ImpulsePlotStatic from '$lib/components/ImpulsePlotStatic.svelte';
  import ImpulseModal from '$lib/components/ImpulseModal.svelte';
  import { reports, DIAGNOSIS_LABELS, emptyFindings, type Report, type Diagnosis, type Side } from '$lib/report.svelte';
  import { scenarios } from '$lib/scenario.svelte';
  import { ui } from '$lib/dialog.svelte';

  let modalOpen = $state(false);
  let modalSide = $state<Side>('LL');
  function openModal(s: Side) { modalSide = s; modalOpen = true; }

  // Canales disponibles. Hoy LL/RL; futuro multicanal: añadir LA/RA/LP/RP aquí.
  const CHANNELS: { id: Side; label: string; color?: string }[] = [
    { id: 'LL', label: 'Lateral izquierdo' },
    { id: 'RL', label: 'Lateral derecho' },
  ];

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

  async function submit() {
    if (!report) return;
    if (!report.diagnosis) {
      await ui.alert('Falta el diagnóstico', 'Selecciona un diagnóstico antes de enviar el informe.');
      return;
    }
    if (!(await ui.confirm('Enviar informe', 'Una vez enviado, el informe queda definitivo y no se podrá editar.'))) return;
    report.submitted = true;
    report.submittedAt = Date.now();
    reports.upsert($state.snapshot(report) as Report);
  }

  async function downloadPdf() {
    if (!report) return;
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { invoke } = await import('@tauri-apps/api/core');
    // @ts-expect-error: html2pdf.js no incluye tipos
    const html2pdfMod = await import('html2pdf.js');
    const html2pdf = html2pdfMod.default ?? html2pdfMod;

    const safeCode = (report.examenCode || 'examen').replace(/[^\w-]+/g, '_');
    const dateStr = new Date(report.date).toISOString().slice(0, 10);
    const defaultName = `informe-${safeCode}-${dateStr}.pdf`;

    const target = await save({
      defaultPath: defaultName,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (!target) return;

    const article = document.querySelector('article.report') as HTMLElement | null;
    if (!article) return;

    document.body.classList.add('is-exporting');
    try {
      const blob: Blob = await html2pdf()
        .from(article)
        .set({
          margin: [14, 16, 14, 16],
          filename: defaultName,
          image: { type: 'jpeg', quality: 0.96 },
          html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
          pagebreak: { mode: ['css', 'legacy'] },
        })
        .outputPdf('blob');
      const buf = new Uint8Array(await blob.arrayBuffer());
      await invoke('save_pdf', { path: target, bytes: Array.from(buf) });
    } catch (e) {
      console.error(e);
      await ui.alert('Error al generar el PDF', (e as Error).message);
    } finally {
      document.body.classList.remove('is-exporting');
    }
  }

  let allScenarios = $derived([...scenarios.examples, ...scenarios.list]);
  let trueScenario = $derived(report ? allScenarios.find((s) => s.id === report!.scenarioId) ?? null : null);

  // resumen del escenario verdadero (para reveal)
  let trueSummary = $derived(() => {
    if (!trueScenario) return null;
    const ll = trueScenario.channels.LL;
    const rl = trueScenario.channels.RL;
    const allArtifacts = [...ll.artifacts, ...rl.artifacts].map((a) => a.artifact);
    return {
      name: trueScenario.name,
      description: trueScenario.description,
      ll, rl,
      artifacts: Array.from(new Set(allArtifacts)),
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
        <!-- Cabecera formal: solo en PDF -->
        <header class="rep-head print-only">
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
          </div>
        </header>

        <!-- Barra de estado + acciones: solo en pantalla -->
        <div class="status-bar screen-only">
          <div class="status-left">
            <button class="ghost" onclick={() => goto('/informe')} title="Volver a informes">←</button>
            <span class="status-item"><strong>Examen</strong> <code>{report.examenCode}</code></span>
            <span class="status-item"><strong>Fecha</strong> {fmtDate(report.date)}</span>
            {#if report.submitted}
              <span class="tag ok">✓ Enviado</span>
            {:else}
              <span class="tag draft">Borrador</span>
            {/if}
          </div>
          <div class="status-right">
            {#if !report.submitted}
              <button onclick={submit}>Enviar informe</button>
            {/if}
            <button class="primary" onclick={downloadPdf}>⬇ Descargar PDF</button>
          </div>
        </div>

        <section class="datos">
          <h2>Identificación y paciente</h2>
          <div class="datos-grid">
            <label>
              <span>Profesional</span>
              <input type="text" bind:value={report.examiner} oninput={scheduleSave} disabled={report.submitted} placeholder="Nombre" />
            </label>
            <label>
              <span>Profesión / cargo</span>
              <input type="text" bind:value={report.examinerTitle} oninput={scheduleSave} disabled={report.submitted} placeholder="Evaluador…" />
            </label>
            <label>
              <span>Institución</span>
              <input type="text" bind:value={report.institution} oninput={scheduleSave} disabled={report.submitted} placeholder="Centro / clínica" />
            </label>
            <label>
              <span>Paciente</span>
              <input type="text" bind:value={report.patientName} oninput={scheduleSave} disabled={report.submitted} placeholder="Nombre y apellido" />
            </label>
            <label>
              <span>RUT / Ficha</span>
              <input type="text" bind:value={report.patientId} oninput={scheduleSave} disabled={report.submitted} />
            </label>
            <label>
              <span>Edad</span>
              <input type="text" bind:value={report.patientAge} oninput={scheduleSave} disabled={report.submitted} placeholder="años" />
            </label>
            <label class="full-row">
              <span>Motivo de consulta / antecedentes relevantes</span>
              <textarea
                rows="2"
                bind:value={report.patientReason}
                oninput={scheduleSave}
                disabled={report.submitted}
                placeholder="Vértigo agudo, mareos, hipoacusia, antecedentes de ototoxicidad, etc."
              ></textarea>
            </label>
          </div>
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
            <button class="plot-card" onclick={() => openModal('LL')} title="Click: análisis detallado">
              <div class="plot-title"><span class="side-chip ll">LL</span> Lateral izquierdo <span class="muted">· click ↗</span></div>
              <ImpulsePlotStatic side="LL" impulses={impulsesOf('LL')} />
            </button>
            <button class="plot-card" onclick={() => openModal('RL')} title="Click: análisis detallado">
              <div class="plot-title"><span class="side-chip rl">RL</span> Lateral derecho <span class="muted">· click ↗</span></div>
              <ImpulsePlotStatic side="RL" impulses={impulsesOf('RL')} />
            </button>
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
            rows="4"
            placeholder="Describe los hallazgos del registro: simetría, ganancia VOR, presencia y tipo de sacadas correctivas, calidad del registro, etc."
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
            rows="2"
            placeholder="Comentarios adicionales, recomendaciones, sugerencias de seguimiento..."
            bind:value={report.comments}
            oninput={scheduleSave}
            disabled={report.submitted}
          ></textarea>
        </section>

        <!-- Pie con firma: solo en PDF -->
        <footer class="rep-foot print-only">
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
                  <tr><th>Lateral izq. (LL)</th><td>gain {summary?.ll.gain.toFixed(2)} · {summary?.ll.peakVel}°/s · sacada {summary?.ll.saccade}</td></tr>
                  <tr><th>Lateral der. (RL)</th><td>gain {summary?.rl.gain.toFixed(2)} · {summary?.rl.peakVel}°/s · sacada {summary?.rl.saccade}</td></tr>
                  {#if summary?.artifacts.length}
                    <tr><th>Artefactos</th><td>{summary.artifacts.join(', ')}</td></tr>
                  {/if}
                </tbody>
              </table>
            </div>
          </section>
        {/if}
      </article>

    </main>
  </div>

  <ImpulseModal
    open={modalOpen}
    side={modalSide}
    channels={CHANNELS}
    impulsesBy={(s) => report?.impulses.filter((i) => i.side === s) ?? []}
    onClose={() => (modalOpen = false)}
    onChangeSide={(s) => (modalSide = s)}
  />
{:else}
  <p>Cargando...</p>
{/if}

<style>
  .app { min-height: 100vh; background: var(--bg); }
  .page {
    padding: 12px 16px;
    width: 100%;
    box-sizing: border-box;
  }
  .report {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    align-content: start;
  }
  .status-bar, .datos, .reveal, .rep-head, .rep-foot { grid-column: 1 / -1; }
  .resultados, .findings { grid-column: 1; }
  .plots, .interpretation, .diagnosis { grid-column: 2; }
  @media (max-width: 900px) {
    .report { grid-template-columns: 1fr; }
    .resultados, .findings, .plots, .interpretation, .diagnosis { grid-column: 1; }
  }

  /* Visibilidad pantalla vs PDF */
  .print-only { display: none !important; }
  @media print { .screen-only { display: none !important; } .print-only { display: flex !important; } }
  :global(body.is-exporting) .screen-only { display: none !important; }
  :global(body.is-exporting) .print-only { display: flex !important; }
  :global(body.is-exporting) .no-print { display: none !important; }

  /* Barra de estado (pantalla) */
  .status-bar {
    display: flex; justify-content: space-between; align-items: center;
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 8px 12px; box-shadow: var(--shadow-sm);
    font-size: 12px; gap: 12px;
  }
  .status-left { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; }
  .status-right { display: flex; gap: 8px; align-items: center; }
  .status-right button { padding: 6px 12px; font-size: 12px; }
  .status-item strong { color: var(--text-muted); font-weight: 600; text-transform: uppercase; font-size: 10px; letter-spacing: .05em; margin-right: 6px; }
  .status-item code { font-family: ui-monospace, monospace; background: var(--primary-soft); color: var(--primary); padding: 2px 6px; border-radius: 4px; }
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
    border-radius: var(--radius); padding: 10px 12px; box-shadow: var(--shadow-sm);
  }
  h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--primary); margin: 0 0 8px; padding-bottom: 4px; border-bottom: 1px solid var(--border); }

  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .datos-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px 10px; }
  .datos-grid label { min-width: 0; }
  .datos-grid label.full-row { grid-column: 1 / -1; }
  @media (max-width: 1100px) { .datos-grid { grid-template-columns: repeat(3, 1fr); } }
  @media (max-width: 700px) { .datos-grid { grid-template-columns: repeat(2, 1fr); } }
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

  .plot-card {
    background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius-sm);
    padding: 8px; width: 100%; text-align: left; cursor: pointer; transition: border-color .15s, box-shadow .15s;
    font: inherit; color: inherit;
  }
  .plot-card:hover { border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-soft); }
  .plot-title { font-size: 12px; font-weight: 600; margin-bottom: 4px; }
  .plot-title .muted { color: var(--text-muted); font-weight: 400; font-size: 11px; }

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

  @media print {
    .no-print { display: none !important; }
    @page { size: A4; margin: 14mm 16mm; }
    .app, .page { background: white; padding: 0; max-width: none; display: block; }
    .report { display: block; gap: 0; }
    .report > section { margin-bottom: 8px; }
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

  /* Replica de estilos print al exportar a PDF */
  :global(body.is-exporting) .app,
  :global(body.is-exporting) .page { background: white; padding: 0; max-width: none; display: block; }
  :global(body.is-exporting) .report { display: block; gap: 0; }
  :global(body.is-exporting) .report > section { margin-bottom: 8px; }
  :global(body.is-exporting) section,
  :global(body.is-exporting) .rep-head,
  :global(body.is-exporting) .rep-foot {
    box-shadow: none; border: none; border-radius: 0; padding: 6px 0; background: white;
  }
  :global(body.is-exporting) section { border-top: 1px solid #ddd; }
  :global(body.is-exporting) .rep-head { border-bottom: 2px solid #333; padding-bottom: 8px; }
  :global(body.is-exporting) .rep-foot { border-top: 1px solid #ddd; padding-top: 14px; }
  :global(body.is-exporting) h2 { color: #333; border-color: #ddd; }
  :global(body.is-exporting) .reveal { display: none; }
</style>
