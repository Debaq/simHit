<script lang="ts">
  import type { NodeKind } from '$lib/scenario.svelte';
  const items: { kind: NodeKind; label: string; icon: string; color: string }[] = [
    { kind: 'impulse', label: 'Impulsos', icon: '⚡', color: 'var(--primary)' },
    { kind: 'pause', label: 'Pausa', icon: '⏸', color: '#f59e0b' },
    { kind: 'artifact', label: 'Artefacto', icon: '⚠', color: '#e11d48' },
    { kind: 'random', label: 'Bifurcación', icon: '⤧', color: '#2563eb' },
  ];

  function onDragStart(e: DragEvent, kind: NodeKind) {
    if (!e.dataTransfer) return;
    e.dataTransfer.setData('application/simhit-node', kind);
    e.dataTransfer.effectAllowed = 'move';
  }
</script>

<div class="palette">
  <div class="title">Paleta</div>
  {#each items as it}
    <div
      class="item"
      draggable="true"
      ondragstart={(e) => onDragStart(e, it.kind)}
      style:--c={it.color}
    >
      <span class="ic">{it.icon}</span>
      <span>{it.label}</span>
    </div>
  {/each}
  <div class="hint">Arrastra al lienzo</div>
</div>

<style>
  .palette { padding: 12px; display: flex; flex-direction: column; gap: 8px; }
  .title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--text-muted); margin-bottom: 4px; }
  .item {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 10px;
    border: 2px solid var(--c);
    border-radius: 8px;
    background: white;
    cursor: grab;
    font-size: 12px;
    font-weight: 500;
    user-select: none;
    transition: transform .1s, box-shadow .1s;
  }
  .item:hover { transform: translateY(-1px); box-shadow: 0 4px 10px rgba(0,0,0,0.06); }
  .item:active { cursor: grabbing; }
  .ic { color: var(--c); font-size: 16px; }
  .hint { color: var(--text-muted); font-size: 10px; text-align: center; margin-top: 4px; }
</style>
