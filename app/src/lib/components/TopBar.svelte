<script lang="ts">
  let laser = $state(false);
  let ledRed = $state(false);
  let ledGreen = $state(false);
  let ledBlue = $state(false);
  let connected = $state(false);
  let port = $state('—');
</script>

<header class="topbar">
  <div class="brand">
    <div class="logo-dot"></div>
    <div>
      <div class="title">SimHIT</div>
      <div class="subtitle">Simulador vHIT</div>
    </div>
  </div>

  <div class="controls">
    <button class:active={laser} onclick={() => laser = !laser}>
      <span class="dot" style:background={laser ? 'var(--primary)' : 'var(--border-strong)'}></span>
      LASER
    </button>
    <button class:active={ledRed} onclick={() => ledRed = !ledRed}>
      <span class="dot" style:background={ledRed ? '#dc2626' : 'var(--border-strong)'}></span>
      LED Rojo
    </button>
    <button class:active={ledGreen} onclick={() => ledGreen = !ledGreen}>
      <span class="dot" style:background={ledGreen ? '#16a34a' : 'var(--border-strong)'}></span>
      LED Verde
    </button>
    <button class:active={ledBlue} onclick={() => ledBlue = !ledBlue}>
      <span class="dot" style:background={ledBlue ? '#2563eb' : 'var(--border-strong)'}></span>
      LED Azul
    </button>
  </div>

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

  .controls { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
  .controls button { display: inline-flex; align-items: center; gap: 8px; }
  .controls button.active { background: var(--primary-soft); border-color: var(--primary); color: var(--primary); }
  .dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }

  .status { display: flex; align-items: center; gap: 14px; }
  .port { display: flex; flex-direction: column; align-items: flex-end; line-height: 1.1; }
  .port .label { font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: .05em; }
  .port .value { font-family: ui-monospace, monospace; font-size: 12px; }
  .conn { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-muted); }
  .conn .led { width: 8px; height: 8px; border-radius: 50%; background: #cbd5e1; }
  .conn.on { color: var(--success); }
  .conn.on .led { background: var(--success); box-shadow: 0 0 0 3px rgba(22,163,74,.15); }
</style>
