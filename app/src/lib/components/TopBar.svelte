<script lang="ts">
  import { page } from '$app/state';
  let connected = $state(false);
  let port = $state('—');
  let path = $derived(page.url?.pathname ?? '/');
</script>

<header class="topbar">
  <div class="brand">
    <div class="logo-dot"></div>
    <div>
      <div class="title">SimHIT</div>
      <div class="subtitle">Simulador vHIT</div>
    </div>
  </div>

  <nav class="nav">
    <a href="/" class:active={path === '/'}>Simulador</a>
    <a href="/docente" class:active={path === '/docente'}>Modo docente</a>
  </nav>

  <div class="status">
    <div class="port">
      <span class="label">Puerto</span>
      <span class="value">{port}</span>
    </div>
    <div class="conn" class:on={connected}>
      <span class="led"></span>
      {connected ? 'Conectado' : 'Desconectado'}
    </div>
    <button class="primary">{connected ? 'Desconectar' : 'Conectar'}</button>
  </div>
</header>

<style>
  .topbar {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 24px;
    padding: 10px 16px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    box-shadow: var(--shadow-sm);
  }
  .brand { display: flex; align-items: center; gap: 10px; }
  .logo-dot {
    width: 28px; height: 28px;
    border-radius: 8px;
    background: linear-gradient(135deg, var(--primary), var(--accent));
    box-shadow: var(--shadow);
  }
  .title { font-weight: 700; font-size: 16px; line-height: 1; }
  .subtitle { font-size: 11px; color: var(--text-muted); }

  .nav { display: flex; gap: 4px; justify-content: center; }
  .nav a {
    text-decoration: none;
    padding: 6px 14px;
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    font-size: 13px;
    font-weight: 500;
    transition: background .15s, color .15s;
  }
  .nav a:hover { background: var(--primary-soft); color: var(--primary); }
  .nav a.active { background: var(--primary); color: white; }

  .status { display: flex; align-items: center; gap: 14px; }
  .port { display: flex; flex-direction: column; align-items: flex-end; line-height: 1.1; }
  .port .label { font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: .05em; }
  .port .value { font-family: ui-monospace, monospace; font-size: 12px; }
  .conn { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-muted); }
  .conn .led { width: 8px; height: 8px; border-radius: 50%; background: #cbd5e1; }
  .conn.on { color: var(--success); }
  .conn.on .led { background: var(--success); box-shadow: 0 0 0 3px rgba(22,163,74,.15); }
</style>
