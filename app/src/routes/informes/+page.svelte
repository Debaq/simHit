<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import TopBar from '$lib/components/TopBar.svelte';
  import { reports, DIAGNOSIS_LABELS } from '$lib/report.svelte';
  import { practiceReports } from '$lib/practiceReport.svelte';
  import { ui } from '$lib/dialog.svelte';

  type Tab = 'practica' | 'simulacion';
  let tab = $state<Tab>('practica');

  // Filtros compartidos
  let q = $state('');
  let dateFrom = $state('');
  let dateTo = $state('');
  let bundleFilter = $state('');

  onMount(async () => {
    await Promise.all([practiceReports.load(), reports.load()]);
  });

  function fmt(ts: number) {
    return new Date(ts).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' });
  }
  function pct(n: number, d: number) { return d === 0 ? 0 : Math.round((n / d) * 100); }
  function gainColor(g: number) {
    if (g >= 0.8) return 'var(--success)';
    if (g >= 0.6) return 'var(--warn)';
    return 'var(--danger)';
  }

  function withinDate(ts: number): boolean {
    if (dateFrom) {
      const from = new Date(dateFrom + 'T00:00:00').getTime();
      if (ts < from) return false;
    }
    if (dateTo) {
      const to = new Date(dateTo + 'T23:59:59').getTime();
      if (ts > to) return false;
    }
    return true;
  }

  // Práctica
  let practiceBundles = $derived(
    Array.from(new Set(practiceReports.list.map((r) => r.bundleName))).sort()
  );
  let practiceFiltered = $derived.by(() => {
    const ql = q.trim().toLowerCase();
    return practiceReports.list.filter((r) => {
      if (!withinDate(r.date)) return false;
      if (bundleFilter && r.bundleName !== bundleFilter) return false;
      if (ql) {
        const hay = [r.practitioner, r.bundleName, r.id].join(' ').toLowerCase();
        if (!hay.includes(ql)) return false;
      }
      return true;
    });
  });

  // Simulación
  let simScenarios = $derived(
    Array.from(new Set(reports.list.map((r) => r.scenarioId).filter(Boolean))).sort()
  );
  let simFiltered = $derived.by(() => {
    const ql = q.trim().toLowerCase();
    return reports.list.filter((r) => {
      if (!withinDate(r.date)) return false;
      if (bundleFilter && r.scenarioId !== bundleFilter) return false;
      if (ql) {
        const hay = [r.patientName, r.patientId, r.examiner, r.examenCode, r.scenarioId].join(' ').toLowerCase();
        if (!hay.includes(ql)) return false;
      }
      return true;
    });
  });

  function changeTab(t: Tab) { tab = t; bundleFilter = ''; }
  function clearFilters() { q = ''; dateFrom = ''; dateTo = ''; bundleFilter = ''; }

  async function downloadPracticePdf(id: string) {
    const bytes = await practiceReports.readPdfBytes(id);
    if (!bytes) {
      await ui.alert('Sin PDF', 'Este informe no tiene PDF persistido. Abre el detalle para regenerarlo.');
      return;
    }
    triggerDownload(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), `${id}.pdf`);
  }
  async function downloadSimPdf(id: string) {
    const bytes = await reports.readPdfBytes(id);
    if (!bytes) {
      await ui.alert('Sin PDF', 'Este informe aún no tiene PDF persistido. Abre el detalle y genera el PDF.');
      return;
    }
    triggerDownload(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), `${id}.pdf`);
  }
  function triggerDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }
  async function exportPracticeJson(id: string) {
    const r = practiceReports.get(id);
    if (!r) return;
    const blob = new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' });
    triggerDownload(blob, `${id}.json`);
  }
  async function exportSimJson(id: string) {
    const r = reports.get(id);
    if (!r) return;
    const blob = new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' });
    triggerDownload(blob, `${id}.json`);
  }

  // Eliminación deshabilitada temporalmente mientras se hace investigación
  // de uso de los informes (no perder datos por borrado accidental).
</script>

<div class="app">
  <TopBar />
  <main class="page">
    <header class="page-head">
      <h1>Informes</h1>
      <p class="muted">Historial de sesiones — práctica y simulación clínica.</p>
    </header>

    <div class="tabs" role="tablist">
      <button role="tab" aria-selected={tab === 'practica'} class:active={tab === 'practica'} onclick={() => changeTab('practica')}>
        Práctica <span class="count">{practiceReports.list.length}</span>
      </button>
      <button role="tab" aria-selected={tab === 'simulacion'} class:active={tab === 'simulacion'} onclick={() => changeTab('simulacion')}>
        Simulación clínica <span class="count">{reports.list.length}</span>
      </button>
    </div>

    <div class="filters">
      <input type="search" placeholder={tab === 'practica' ? 'Buscar practicante, bundle…' : 'Buscar paciente, examinador, código…'} bind:value={q} />
      <label>Desde <input type="date" bind:value={dateFrom} /></label>
      <label>Hasta <input type="date" bind:value={dateTo} /></label>
      <label>
        {tab === 'practica' ? 'Bundle' : 'Escenario'}
        <select bind:value={bundleFilter}>
          <option value="">Todos</option>
          {#each (tab === 'practica' ? practiceBundles : simScenarios) as b}
            <option value={b}>{b}</option>
          {/each}
        </select>
      </label>
      <button class="link" onclick={clearFilters}>Limpiar</button>
    </div>

    {#if tab === 'practica'}
      {#if practiceFiltered.length === 0}
        <div class="empty">
          <p>{practiceReports.list.length === 0 ? 'Aún no hay informes de práctica.' : 'Sin resultados con los filtros actuales.'}</p>
          {#if practiceReports.list.length === 0}
            <button class="primary" onclick={() => goto('/practica')}>Ir a Práctica</button>
          {/if}
        </div>
      {:else}
        <table class="reports">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Practicante</th>
              <th>Bundle</th>
              <th>Modo</th>
              <th>Intentos</th>
              <th>Aciertos</th>
              <th>Estado</th>
              <th>PDF</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each practiceFiltered as r (r.id)}
              {@const hits = r.attempts.filter((a) => a.ok).length}
              <tr>
                <td>{fmt(r.date)}</td>
                <td>{r.practitioner || '—'}</td>
                <td>{r.bundleName}</td>
                <td>{r.mode} · {r.variant}</td>
                <td>{r.attempts.length}</td>
                <td>{hits} ({pct(hits, r.attempts.length)}%)</td>
                <td>
                  {#if r.partial}<span class="tag draft">Parcial</span>{:else}<span class="tag submitted">Completa</span>{/if}
                </td>
                <td>
                  {#if r.hasPdf}<span class="tag submitted">Sí</span>{:else}<span class="tag draft">—</span>{/if}
                </td>
                <td class="actions">
                  <a class="btn btn-primary" href={`/informes/practica/${r.id}`}>Ver</a>
                  <button class="btn btn-ghost" onclick={() => downloadPracticePdf(r.id)} disabled={!r.hasPdf} title={r.hasPdf ? 'Descargar PDF' : 'Sin PDF guardado'}>PDF</button>
                  <button class="btn btn-ghost" onclick={() => exportPracticeJson(r.id)} title="Exportar JSON">JSON</button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    {:else}
      {#if simFiltered.length === 0}
        <div class="empty">
          <p>{reports.list.length === 0 ? 'Aún no hay informes de simulación.' : 'Sin resultados con los filtros actuales.'}</p>
          {#if reports.list.length === 0}
            <button class="primary" onclick={() => goto('/')}>Ir al simulador</button>
          {/if}
        </div>
      {:else}
        <table class="reports">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Examen</th>
              <th>Examinador</th>
              <th>Paciente</th>
              <th>Gain LL</th>
              <th>Gain RL</th>
              <th>Diagnóstico</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each simFiltered as r (r.id)}
              <tr>
                <td>{fmt(r.date)}</td>
                <td><code>{r.examenCode}</code></td>
                <td>{r.examiner || '—'}</td>
                <td>{r.patientName || '—'}</td>
                <td style:color={gainColor(r.gainLL)}>{r.gainLL.toFixed(2)}</td>
                <td style:color={gainColor(r.gainRL)}>{r.gainRL.toFixed(2)}</td>
                <td>{r.diagnosis ? DIAGNOSIS_LABELS[r.diagnosis] : '—'}</td>
                <td>
                  {#if r.submitted}<span class="tag submitted">Enviado</span>{:else}<span class="tag draft">Borrador</span>{/if}
                </td>
                <td class="actions">
                  <a class="btn btn-primary" href={`/informe/${r.id}`}>Ver</a>
                  <button class="btn btn-ghost" onclick={() => downloadSimPdf(r.id)} title="Descargar PDF">PDF</button>
                  <button class="btn btn-ghost" onclick={() => exportSimJson(r.id)} title="Exportar JSON">JSON</button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    {/if}
  </main>
</div>

<style>
  .app { min-height: 100vh; background: var(--bg); }
  .page { padding: 16px 24px; width: 100%; box-sizing: border-box; }
  .page-head { margin-bottom: 12px; }
  .page-head h1 { margin: 0; font-size: 24px; }
  .muted { color: var(--text-muted); font-size: 13px; }

  .tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--border); margin-bottom: 12px; }
  .tabs button {
    appearance: none; border: 0; background: transparent;
    padding: 10px 16px; cursor: pointer; color: var(--text-muted);
    border-bottom: 2px solid transparent; font-size: 14px;
  }
  .tabs button.active { color: var(--text); border-bottom-color: var(--accent, #4a9eff); }
  .tabs .count {
    display: inline-block; min-width: 20px; padding: 1px 6px; margin-left: 6px;
    border-radius: 10px; background: var(--surface-alt, rgba(255,255,255,0.06));
    font-size: 11px;
  }

  .filters {
    display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
    padding: 8px 0 14px; font-size: 13px;
  }
  .filters input[type="search"] { flex: 1; min-width: 220px; padding: 6px 8px; }
  .filters input[type="date"], .filters select { padding: 4px 6px; }
  .filters label { display: inline-flex; gap: 6px; align-items: center; color: var(--text-muted); }

  .empty { text-align: center; padding: 60px 20px; color: var(--text-muted); }
  .empty button { margin-top: 16px; }

  table.reports {
    width: 100%; border-collapse: collapse;
    background: var(--surface); border: 1px solid var(--border);
  }
  table.reports th, table.reports td {
    padding: 8px 10px; text-align: left; border-bottom: 1px solid var(--border);
    font-size: 13px;
  }
  table.reports th { background: var(--surface-alt, rgba(255,255,255,0.03)); font-weight: 600; }
  table.reports code { font-family: ui-monospace, monospace; font-size: 12px; }

  .tag { padding: 2px 8px; border-radius: 10px; font-size: 11px; }
  .tag.submitted { background: var(--success-bg, rgba(80,200,120,0.15)); color: var(--success, #50c878); }
  .tag.draft { background: var(--warn-bg, rgba(255,180,80,0.12)); color: var(--text-muted); }

  .actions { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .btn {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 4px 10px; border-radius: 999px; font-size: 12px; line-height: 1;
    border: 1px solid var(--border); cursor: pointer; text-decoration: none;
    transition: background-color .12s, border-color .12s, color .12s;
  }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn-primary {
    background: var(--accent, #4a9eff); color: white; border-color: var(--accent, #4a9eff);
  }
  .btn-primary:hover { filter: brightness(1.08); }
  .btn-ghost {
    background: transparent; color: var(--text);
  }
  .btn-ghost:not(:disabled):hover {
    background: var(--surface-alt, rgba(255,255,255,0.06));
    border-color: var(--accent, #4a9eff);
    color: var(--accent, #4a9eff);
  }

  button.primary {
    background: var(--accent, #4a9eff); color: white; border: 0;
    padding: 8px 14px; border-radius: 6px; cursor: pointer;
  }
</style>
