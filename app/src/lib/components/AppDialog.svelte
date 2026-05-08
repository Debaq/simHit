<script lang="ts">
  import { ui } from '$lib/dialog.svelte';

  let req = $derived(ui.current);
  let inputValue = $state('');
  let inputEl: HTMLInputElement | null = $state(null);
  let lastReq: typeof req = null;

  $effect(() => {
    if (req && req !== lastReq) {
      lastReq = req;
      inputValue = req.kind === 'prompt' ? req.defaultValue : '';
      // foco diferido al siguiente tick
      setTimeout(() => {
        inputEl?.focus();
        inputEl?.select();
      }, 0);
    }
    if (!req) lastReq = null;
  });

  function ok() {
    if (!req) return;
    if (req.kind === 'prompt') ui.resolve(inputValue.trim() || null);
    else ui.resolve(true);
  }

  function cancel() {
    if (!req) return;
    if (req.kind === 'alert') ui.resolve(true);
    else if (req.kind === 'prompt') ui.resolve(null);
    else ui.resolve(false);
  }

  function onKey(e: KeyboardEvent) {
    if (!req) return;
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    else if (e.key === 'Enter') { e.preventDefault(); ok(); }
  }
</script>

<svelte:window onkeydown={onKey} />

{#if req}
  <div class="backdrop" role="presentation" onmousedown={(e) => { if (e.target === e.currentTarget) cancel(); }}>
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
      <h2 id="dlg-title">{req.title}</h2>

      {#if req.kind === 'prompt'}
        <input
          bind:this={inputEl}
          bind:value={inputValue}
          type="text"
          spellcheck="false"
          autocomplete="off"
        />
      {:else if req.message}
        <p class="msg">{req.message}</p>
      {/if}

      <div class="actions">
        {#if req.kind !== 'alert'}
          <button type="button" class="ghost" onclick={cancel}>Cancelar</button>
        {/if}
        <button
          type="button"
          class:primary={!(req.kind === 'confirm' && req.danger)}
          class:danger={req.kind === 'confirm' && req.danger}
          onclick={ok}
        >
          {req.kind === 'prompt' ? 'Aceptar' : (req.kind === 'confirm' && req.danger ? 'Eliminar' : 'Aceptar')}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed; inset: 0; z-index: 9999;
    background: rgba(0, 0, 0, 0.45);
    display: flex; align-items: center; justify-content: center;
    backdrop-filter: blur(2px);
  }
  .modal {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
    padding: 18px 20px;
    min-width: 360px;
    max-width: 480px;
    display: flex; flex-direction: column; gap: 12px;
  }
  h2 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--text);
  }
  .msg { margin: 0; color: var(--text); font-size: 13px; line-height: 1.5; }
  input[type="text"] {
    font: inherit; font-size: 14px;
    padding: 8px 10px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    color: var(--text);
    width: 100%;
    box-sizing: border-box;
  }
  input[type="text"]:focus {
    outline: none;
    border-color: var(--primary);
    box-shadow: 0 0 0 3px var(--primary-soft);
  }
  .actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px; }
  .actions button {
    padding: 6px 14px;
    font-size: 13px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font: inherit;
    border: 1px solid var(--border);
    background: var(--surface-2);
    color: var(--text);
  }
  .actions button:hover { border-color: var(--primary); }
  .actions .primary {
    background: var(--primary); color: white; border-color: var(--primary);
  }
  .actions .primary:hover { filter: brightness(1.05); border-color: var(--primary); }
  .actions .danger {
    background: var(--danger); color: white; border-color: var(--danger);
  }
  .actions .danger:hover { filter: brightness(1.05); border-color: var(--danger); }
  .actions .ghost { background: transparent; }
</style>
