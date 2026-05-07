<script lang="ts">
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { sim } from '$lib/simulator.svelte';
  import { serial } from '$lib/serial.svelte';

  let path = $derived(page.url?.pathname ?? '/');
  let selectedPort = $state<string>('');

  onMount(() => {
    serial.listPorts();
  });

  async function refreshPorts() {
    await serial.listPorts();
    if (!selectedPort && serial.ports.length) selectedPort = serial.ports[0];
  }

  async function toggleSerial() {
    if (serial.connected) {
      await serial.disconnect();
    } else if (selectedPort) {
      await serial.connect(selectedPort);
      if (serial.connected) sim.cameraOn = true; // hardware real -> cámara on
    }
  }

  function toggleCamera() {
    sim.cameraOn = !sim.cameraOn;
  }
</script>

<header class="topbar">
  <a class="brand" href="/" aria-label="SimHIT inicio">
    <img src="/brand/logo-sm.png" alt="" class="logo" />
    <div>
      <div class="title">SimHIT</div>
      <div class="subtitle">Simulador vHIT</div>
    </div>
  </a>

  <nav class="nav">
    <a href="/" class:active={path === '/'}>Simulador</a>
    <a href="/informe" class:active={path?.startsWith('/informe')}>Informes</a>
    <a href="/docente" class:active={path === '/docente'}>Modo docente</a>
  </nav>

  <div class="status">
    <button
      class="cam"
      class:on={sim.cameraOn}
      onclick={toggleCamera}
      title="Encender/apagar cámara del paciente"
    >
      <span class="ic">📷</span>
      Cámara <b>{sim.cameraOn ? 'ON' : 'OFF'}</b>
    </button>

    <div class="serial">
      <select bind:value={selectedPort} disabled={serial.connected || serial.ports.length === 0} title="Puerto serie">
        {#if serial.ports.length === 0}
          <option value="">— sin puertos —</option>
        {:else}
          {#each serial.ports as p}
            <option value={p}>{p}</option>
          {/each}
        {/if}
      </select>
      <button class="icon-btn" onclick={refreshPorts} title="Actualizar puertos" disabled={serial.connected}>↻</button>
      <button
        class="primary"
        onclick={toggleSerial}
        disabled={serial.connecting || (!serial.connected && !selectedPort)}
      >
        {#if serial.connecting}
          conectando…
        {:else if serial.connected}
          ■ SimHIT
        {:else}
          ▶ SimHIT
        {/if}
      </button>
      <span class="led" class:on={serial.connected} title={serial.lastError ?? ''}></span>
    </div>
  </div>
</header>

<style>
  .topbar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 50;
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 24px;
    padding: 10px 16px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    box-shadow: var(--shadow-sm);
    /* altura referencia ~58px usada por padding-top de las páginas */
  }
  .brand {
    display: flex; align-items: center; gap: 10px;
    text-decoration: none; color: inherit;
    padding: 4px 8px; border-radius: var(--radius-sm);
    transition: background .15s;
  }
  .brand:hover { background: var(--primary-soft); }
  .logo { width: 36px; height: 36px; object-fit: contain; }
  .title { font-weight: 700; font-size: 16px; line-height: 1; letter-spacing: .04em; }
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

  .status { display: flex; align-items: center; gap: 12px; }
  .cam {
    display: inline-flex; align-items: center; gap: 8px;
    border: 1px solid var(--border-strong);
    background: var(--surface);
    color: var(--text-muted);
    padding: 6px 12px;
    border-radius: var(--radius-sm);
    font-size: 12px;
    transition: all .15s;
  }
  .cam .ic { filter: grayscale(1) opacity(.5); }
  .cam.on {
    background: var(--success);
    color: white; border-color: var(--success);
    box-shadow: 0 0 0 3px rgba(22,163,74,.15);
  }
  .cam.on .ic { filter: none; }
  .cam:hover { background: var(--primary-soft); }
  .cam.on:hover { background: var(--success); opacity: .9; }
  .cam b { font-weight: 700; letter-spacing: .04em; }

  .serial {
    display: inline-flex; align-items: center; gap: 6px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 4px 6px;
  }
  .serial select {
    font: inherit; font-size: 12px;
    padding: 4px 8px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font-family: ui-monospace, monospace;
    min-width: 130px;
  }
  .serial select:disabled { opacity: .6; }
  .icon-btn {
    padding: 4px 8px; font-size: 13px;
    border: 1px solid var(--border-strong); background: var(--surface);
    border-radius: var(--radius-sm); cursor: pointer;
  }
  .icon-btn:hover { background: var(--primary-soft); }
  .led {
    width: 10px; height: 10px; border-radius: 50%;
    background: #cbd5e1; flex-shrink: 0;
  }
  .led.on {
    background: var(--success);
    box-shadow: 0 0 0 3px rgba(22,163,74,.15);
    animation: pulse 1.6s ease-in-out infinite;
  }
  @keyframes pulse { 50% { opacity: .55; } }
</style>
