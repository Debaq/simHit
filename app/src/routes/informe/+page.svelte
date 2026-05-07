<script lang="ts">
  import { onMount } from 'svelte';
  import TopBar from '$lib/components/TopBar.svelte';
  import { reports, DIAGNOSIS_LABELS } from '$lib/report.svelte';
  import { goto } from '$app/navigation';

  onMount(() => reports.load());

  function fmt(ts: number) {
    return new Date(ts).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' });
  }
  function gainColor(g: number) {
    if (g >= 0.8) return 'var(--success)';
    if (g >= 0.6) return 'var(--warn)';
    return 'var(--danger)';
  }
  function deleteReport(id: string, name: string) {
    if (confirm(`Eliminar informe "${name}"?`)) reports.remove(id);
  }
</script>

<div class="app">
  <TopBar />
  <main class="page">
    <header class="page-head">
      <h1>Informes</h1>
      <p class="muted">Historial de informes vHIT generados</p>
    </header>

    {#if reports.list.length === 0}
      <div class="empty">
        <p>Aún no hay informes guardados.</p>
        <p class="muted">Realizá un examen y generá un informe desde el simulador.</p>
        <button class="primary" onclick={() => goto('/')}>Ir al simulador</button>
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
          {#each reports.list as r (r.id)}
            <tr>
              <td>{fmt(r.date)}</td>
              <td><code>{r.examenCode}</code></td>
              <td>{r.examiner || '—'}</td>
              <td>{r.patientName || '—'}</td>
              <td style:color={gainColor(r.gainLL)}>{r.gainLL.toFixed(2)}</td>
              <td style:color={gainColor(r.gainRL)}>{r.gainRL.toFixed(2)}</td>
              <td>{r.diagnosis ? DIAGNOSIS_LABELS[r.diagnosis] : '—'}</td>
              <td>
                {#if r.submitted}
                  <span class="tag submitted">Enviado</span>
                {:else}
                  <span class="tag draft">Borrador</span>
                {/if}
              </td>
              <td class="actions">
                <a href={`/informe/${r.id}`}>Ver</a>
                <button class="link" onclick={() => deleteReport(r.id, r.examenCode)}>Eliminar</button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </main>
</div>

<style>
  .app { min-height: 100vh; display: flex; flex-direction: column; background: var(--bg); }
  .page { padding: 24px; max-width: 1200px; width: 100%; margin: 0 auto; }
  .page-head { margin-bottom: 16px; }
  .page-head h1 { margin: 0; font-size: 24px; }
  .muted { color: var(--text-muted); font-size: 13px; }
  .empty { text-align: center; padding: 60px 20px; color: var(--text-muted); }
  .empty button { margin-top: 16px; }
  table.reports {
    width: 100%;
    border-collapse: collapse;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
    font-size: 13px;
  }
  th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--border); }
  th { background: var(--surface-2); font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--text-muted); }
  tr:last-child td { border-bottom: none; }
  tr:hover { background: var(--primary-soft); }
  td code { font-family: ui-monospace, monospace; background: var(--primary-soft); color: var(--primary); padding: 2px 6px; border-radius: 4px; }
  .tag { padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; }
  .tag.submitted { background: var(--success); color: white; }
  .tag.draft { background: var(--warn); color: white; }
  .actions { display: flex; gap: 8px; }
  .actions a { color: var(--primary); text-decoration: none; font-weight: 500; }
  .actions a:hover { text-decoration: underline; }
  .link { background: transparent; border: none; color: var(--danger); padding: 0; cursor: pointer; font-size: inherit; }
  .link:hover { text-decoration: underline; }
</style>
