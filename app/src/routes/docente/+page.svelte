<script lang="ts">
  import { onMount } from 'svelte';
  import {
    SvelteFlow,
    Controls,
    Background,
    BackgroundVariant,
    MiniMap,
    type Node,
    type Edge,
    type Connection,
    useSvelteFlow,
  } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';

  import TopBar from '$lib/components/TopBar.svelte';
  import Palette from '$lib/components/flow/Palette.svelte';
  import Inspector from '$lib/components/flow/Inspector.svelte';
  import FlowOps from '$lib/components/flow/FlowOps.svelte';
  import StartNode from '$lib/components/flow/StartNode.svelte';
  import EndNode from '$lib/components/flow/EndNode.svelte';
  import ImpulseNode from '$lib/components/flow/ImpulseNode.svelte';
  import PauseNode from '$lib/components/flow/PauseNode.svelte';
  import ArtifactNode from '$lib/components/flow/ArtifactNode.svelte';
  import RandomNode from '$lib/components/flow/RandomNode.svelte';
  import { scenarios, defaultsFor, type NodeKind } from '$lib/scenario.svelte';

  const nodeTypes = {
    start: StartNode,
    end: EndNode,
    impulse: ImpulseNode,
    pause: PauseNode,
    artifact: ArtifactNode,
    random: RandomNode,
  };

  let nodes = $state<Node[]>([]);
  let edges = $state<Edge[]>([]);
  let selectedId = $state<string | null>(null);
  let selectedNode = $derived(nodes.find((n) => n.id === selectedId) ?? null);

  let flowWrap: HTMLDivElement;
  let sf: ReturnType<typeof useSvelteFlow> | null = null;

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => scenarios.updateActive(nodes, edges), 300);
  }

  onMount(() => {
    scenarios.load();
    syncFromActive();
  });

  function syncFromActive() {
    const s = scenarios.active;
    if (!s) { nodes = []; edges = []; return; }
    nodes = s.nodes.map((n) => ({ ...n }));
    edges = s.edges.map((e) => ({ ...e }));
  }

  $effect(() => {
    // when active scenario changes, re-sync (track id only)
    void scenarios.activeId;
    syncFromActive();
  });

  $effect(() => {
    // persist on change
    void nodes; void edges;
    if (scenarios.active) scheduleSave();
  });

  function onConnect(c: Connection) {
    edges = [...edges, { id: crypto.randomUUID(), source: c.source!, target: c.target!, sourceHandle: c.sourceHandle, targetHandle: c.targetHandle }];
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    const kind = e.dataTransfer?.getData('application/simhit-node') as NodeKind | undefined;
    if (!kind || !sf) return;
    const pos = sf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const id = crypto.randomUUID();
    nodes = [...nodes, {
      id,
      type: kind,
      position: pos,
      data: defaultsFor(kind) as any,
    }];
  }
  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  }

  function onNodeClick({ node }: { node: Node }) {
    selectedId = node.id;
  }

  function updateSelectedData(data: any) {
    if (!selectedId) return;
    nodes = nodes.map((n) => (n.id === selectedId ? { ...n, data } : n));
  }
  function deleteSelected() {
    if (!selectedId) return;
    if (selectedId === 'start' || selectedId === 'end') return;
    nodes = nodes.filter((n) => n.id !== selectedId);
    edges = edges.filter((e) => e.source !== selectedId && e.target !== selectedId);
    selectedId = null;
  }

  function newScenario() {
    const name = prompt('Nombre del escenario', 'Nuevo escenario');
    if (!name) return;
    scenarios.create(name);
    syncFromActive();
  }
  function deleteScenario(id: string) {
    if (!confirm('¿Eliminar escenario?')) return;
    scenarios.remove(id);
    syncFromActive();
  }

</script>

<div class="app">
  <TopBar />

  <div class="docente">
    <aside class="left">
      <div class="section-title">Casos predefinidos</div>
      <ul>
        {#each scenarios.examples as s (s.id)}
          <li class:active={s.id === scenarios.activeId}>
            <button class="name" onclick={() => scenarios.setActive(s.id)}>
              <span class="badge">📚</span>{s.name}
            </button>
            <button class="dup" title="Duplicar para editar" onclick={() => { scenarios.duplicate(s.id); syncFromActive(); }}>⎘</button>
          </li>
        {/each}
      </ul>

      <div class="section-title">Mis escenarios</div>
      <button class="primary" onclick={newScenario}>+ Nuevo</button>
      <ul>
        {#each scenarios.list as s (s.id)}
          <li class:active={s.id === scenarios.activeId}>
            <button class="name" onclick={() => scenarios.setActive(s.id)}>{s.name}</button>
            <button class="del" onclick={() => deleteScenario(s.id)} title="Eliminar">×</button>
          </li>
        {:else}
          <li class="empty-li">— vacío —</li>
        {/each}
      </ul>
    </aside>

    <div class="canvas" bind:this={flowWrap} ondrop={handleDrop} ondragover={handleDragOver}>
      {#if scenarios.isExampleActive}
        <div class="readonly-banner">
          <span>📚 Caso predefinido — solo lectura</span>
          <button class="primary" onclick={() => { scenarios.duplicate(scenarios.activeId!); syncFromActive(); }}>
            ⎘ Duplicar para editar
          </button>
        </div>
      {/if}
      {#if scenarios.active}
        <SvelteFlow
          bind:nodes
          bind:edges
          {nodeTypes}
          onconnect={onConnect}
          onnodeclick={onNodeClick}
          fitView
          deleteKey={['Backspace', 'Delete']}
        >
          <FlowOps onReady={(s) => (sf = s)} />
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
          <Controls />
          <MiniMap zoomable pannable />
        </SvelteFlow>
      {:else}
        <div class="empty">No hay escenarios</div>
      {/if}
    </div>

    <aside class="right">
      <Palette />
      <div class="divider"></div>
      <Inspector node={selectedNode} onChange={updateSelectedData} onDelete={deleteSelected} />
    </aside>
  </div>
</div>

<style>
  .app { height: 100vh; display: flex; flex-direction: column; }
  .docente {
    flex: 1;
    display: grid;
    grid-template-columns: 220px 1fr 280px;
    min-height: 0;
  }
  aside {
    background: var(--surface);
    border-right: 1px solid var(--border);
    overflow-y: auto;
  }
  aside.right { border-right: none; border-left: 1px solid var(--border); display: flex; flex-direction: column; }
  .left { padding: 12px; display: flex; flex-direction: column; gap: 8px; }
  .section-title { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--text-muted); font-weight: 600; }
  .left ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .left li {
    display: flex; align-items: center; gap: 4px;
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .left li.active { background: var(--primary-soft); }
  .left li .name {
    flex: 1; text-align: left; padding: 6px 8px;
    background: transparent; border: none; color: var(--text);
    font-size: 12px;
  }
  .left li.active .name { color: var(--primary); font-weight: 600; }
  .left li .del { padding: 4px 8px; background: transparent; border: none; color: var(--text-muted); font-size: 14px; }
  .left li .del:hover { color: var(--danger); background: transparent; }
  .canvas { position: relative; min-width: 0; background: var(--bg); }
  .readonly-banner {
    position: absolute; top: 8px; left: 50%; transform: translateX(-50%);
    z-index: 10;
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: 999px;
    padding: 4px 6px 4px 14px;
    display: flex; align-items: center; gap: 10px;
    font-size: 12px;
    box-shadow: var(--shadow);
  }
  .readonly-banner button { font-size: 11px; padding: 4px 10px; border-radius: 999px; }
  .left .badge { font-size: 10px; margin-right: 4px; }
  .left .dup { padding: 4px 8px; background: transparent; border: none; color: var(--text-muted); font-size: 14px; }
  .left .dup:hover { color: var(--primary); background: transparent; }
  .left .empty-li { padding: 6px 8px; font-size: 11px; color: var(--text-muted); font-style: italic; text-align: center; }
  .empty { padding: 40px; text-align: center; color: var(--text-muted); }
  .divider { border-top: 1px solid var(--border); margin: 4px 0; }

  :global(.svelte-flow) { background: var(--bg); }
  :global(.svelte-flow__node) { font-family: inherit; }
  :global(.svelte-flow__handle) { background: var(--primary); width: 9px; height: 9px; border: 2px solid white; }
  :global(.svelte-flow__edge-path) { stroke: var(--primary); stroke-width: 2; }
  :global(.svelte-flow__minimap) { background: var(--surface); }
  :global(.svelte-flow__controls button) { background: var(--surface); border-color: var(--border); color: var(--text); }
</style>
