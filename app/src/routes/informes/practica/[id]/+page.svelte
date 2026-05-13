<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import TopBar from '$lib/components/TopBar.svelte';
  import { practiceReports, slugName as prSlugName, humanStamp as prHumanStamp, type PracticeReport } from '$lib/practiceReport.svelte';
  import { ui } from '$lib/dialog.svelte';

  let report = $state<PracticeReport | null>(null);
  let loading = $state(true);

  onMount(async () => {
    if (!practiceReports.loaded) await practiceReports.load();
    const id = page.params.id ?? '';
    report = practiceReports.get(id);
    loading = false;
    if (!report) goto('/informes');
  });

  function fmt(ts: number) { return new Date(ts).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' }); }
  function fmtDur(ms: number) {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
  }
  function pct(n: number, d: number) { return d === 0 ? 0 : Math.round((n / d) * 100); }

  async function downloadPdf() {
    if (!report) return;
    const bytes = await practiceReports.readPdfBytes(report.id);
    if (!bytes) { await ui.alert('Sin PDF', 'Aún no se generó PDF para esta sesión. Usa "Regenerar PDF".'); return; }
    const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${report.id}.pdf`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  let regenerating = $state(false);
  async function regeneratePdf() {
    if (!report || regenerating) return;
    regenerating = true;
    try {
      const node = document.getElementById('report-render-root');
      if (!node) return;
      const mod = await import('html2pdf.js');
      const html2pdf = (mod.default ?? mod);
      const filename = `${prSlugName(report.practitioner || 'sin_nombre')}_${prHumanStamp(new Date(report.date))}.pdf`;
      const worker = html2pdf().set({
        margin: 10,
        filename,
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: { scale: 2, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      }).from(node);
      const blob: Blob = await worker.outputPdf('blob');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      await practiceReports.writePdf(report.id, bytes);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 500);
      report = practiceReports.get(report.id);
    } catch (e) {
      console.warn('regeneratePdf', e);
    } finally {
      regenerating = false;
    }
  }

  async function deleteReport() {
    if (!report) return;
    if (await ui.confirm('Eliminar informe', `"${report.practitioner || report.id}" — esta acción no se puede deshacer.`, { danger: true })) {
      await practiceReports.remove(report.id);
      goto('/informes');
    }
  }

  let hits = $derived(report ? report.attempts.filter((a) => a.ok).length : 0);
  let totalImpulses = $derived(report?.attempts.length ?? 0);
  let durationMs = $derived(report ? Math.max(0, report.endedMs - report.startedMs) : 0);
  let topReasons = $derived.by(() => {
    if (!report) return [] as { reason: string; count: number }[];
    const reasons = report.achievements?.failReasons ?? {};
    return Object.entries(reasons)
      .map(([reason, count]) => ({ reason, count: Number(count) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  });
</script>

<div class="app">
  <TopBar />
  <main class="page">
    <header class="page-head">
      <button class="link" onclick={() => goto('/informes')}>← Volver a Informes</button>
      <div class="title-row">
        <h1>Informe de práctica</h1>
        <div class="head-actions">
          {#if report?.hasPdf}<button class="primary" onclick={downloadPdf}>Descargar PDF</button>{/if}
          <button class="secondary" onclick={regeneratePdf} disabled={regenerating || !report}>
            {regenerating ? 'Generando…' : (report?.hasPdf ? 'Regenerar PDF' : 'Generar PDF')}
          </button>
          <button class="danger" onclick={deleteReport}>Eliminar</button>
        </div>
      </div>
    </header>

    {#if loading}
      <div class="muted">Cargando…</div>
    {:else if report}
      <div id="report-render-root" class="render-root">
        <section class="card meta">
          <div><b>Practicante:</b> {report.practitioner || '—'}</div>
          <div><b>Bundle:</b> {report.bundleName}</div>
          <div><b>Modo:</b> {report.mode} · {report.variant}</div>
          <div><b>Inicio:</b> {fmt(report.startedMs)}</div>
          <div><b>Fin:</b> {fmt(report.endedMs)}</div>
          <div><b>Duración:</b> {fmtDur(durationMs)}</div>
          <div><b>Estado:</b> {report.partial ? 'Parcial' : 'Completa'}</div>
        </section>

        <section class="card">
          <h2>Resumen</h2>
          <div class="kpis">
            <div class="kpi"><span class="lab">Intentos</span><b>{totalImpulses}</b></div>
            <div class="kpi"><span class="lab">Aciertos</span><b>{hits}</b></div>
            <div class="kpi"><span class="lab">% éxito</span><b>{pct(hits, totalImpulses)}%</b></div>
            <div class="kpi"><span class="lab">Pico máx</span><b>{report.achievements?.bestPeak?.toFixed(0) ?? '—'}</b></div>
          </div>
        </section>

        {#if report.achievements?.byPreset?.length}
          <section class="card">
            <h2>Por preset</h2>
            <table>
              <thead><tr><th>Preset</th><th>Intentos</th><th>Aciertos</th><th>Req.</th><th>%</th><th>Peak avg</th><th>Gain avg</th></tr></thead>
              <tbody>
                {#each report.achievements.byPreset as p}
                  <tr>
                    <td><code>{p.acceptanceId}</code></td>
                    <td>{p.attempts}</td>
                    <td>{p.hits}</td>
                    <td>{p.required}</td>
                    <td>{pct(p.hits, p.attempts)}%</td>
                    <td>{p.peakAvg.toFixed(0)}</td>
                    <td>{p.gainAvg.toFixed(2)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </section>
        {/if}

        {#if topReasons.length}
          <section class="card">
            <h2>Motivos de rechazo más frecuentes</h2>
            <ul>
              {#each topReasons as r}<li><code>{r.reason}</code> — {r.count}</li>{/each}
            </ul>
          </section>
        {/if}

        <section class="card">
          <h2>Intentos ({report.attempts.length})</h2>
          <table>
            <thead>
              <tr>
                <th>#</th><th>Hora</th><th>Lado</th><th>Preset</th>
                <th>Pico</th><th>Gain</th><th>Dur (ms)</th><th>Amp</th><th>Resultado</th>
              </tr>
            </thead>
            <tbody>
              {#each report.attempts as a, i}
                <tr class:ok={a.ok} class:bad={!a.ok}>
                  <td>{i + 1}</td>
                  <td>{fmt(a.ts)}</td>
                  <td>{a.side}</td>
                  <td>{a.acceptanceId}</td>
                  <td>{a.peak.toFixed(0)}</td>
                  <td>{a.gain.toFixed(2)}</td>
                  <td>{a.durMs.toFixed(0)}</td>
                  <td>{a.amp.toFixed(1)}</td>
                  <td>{a.ok ? '✓' : '✗ ' + a.reasons.join(', ')}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </section>
      </div>
    {/if}
  </main>
</div>

<style>
  .app { min-height: 100vh; background: var(--bg); }
  .page { padding: 16px 24px; }
  .page-head { margin-bottom: 16px; }
  .title-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 8px; flex-wrap: wrap; }
  .title-row h1 { margin: 0; font-size: 22px; }
  .head-actions { display: flex; gap: 8px; }
  .muted { color: var(--text-muted); }

  .render-root { display: grid; gap: 12px; max-width: 1100px; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; }
  .card h2 { margin: 0 0 8px; font-size: 16px; }
  .meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 6px 16px; font-size: 13px; }

  .kpis { display: flex; gap: 16px; flex-wrap: wrap; }
  .kpi { display: flex; flex-direction: column; min-width: 90px; }
  .kpi .lab { font-size: 11px; color: var(--text-muted); text-transform: uppercase; }
  .kpi b { font-size: 22px; }

  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { padding: 4px 8px; border-bottom: 1px solid var(--border); text-align: left; }
  th { background: var(--surface-alt, rgba(255,255,255,0.03)); }
  tr.ok td { color: var(--text); }
  tr.bad td { color: var(--text-muted); }
  code { font-family: ui-monospace, monospace; font-size: 11px; }

  button.primary { background: var(--accent, #4a9eff); color: white; border: 0; padding: 6px 12px; border-radius: 6px; cursor: pointer; }
  button.secondary { background: transparent; color: var(--text); border: 1px solid var(--border); padding: 6px 12px; border-radius: 6px; cursor: pointer; }
  button.secondary:disabled { opacity: 0.5; cursor: default; }
  button.danger { background: transparent; color: var(--danger, #e35d6a); border: 1px solid var(--danger, #e35d6a); padding: 6px 12px; border-radius: 6px; cursor: pointer; }
  button.link { background: transparent; border: 0; color: var(--accent, #4a9eff); cursor: pointer; padding: 0; font-size: 13px; }
</style>
