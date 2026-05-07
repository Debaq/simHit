<script lang="ts">
  import { Handle, Position, type NodeProps } from '@xyflow/svelte';
  let props: NodeProps = $props();
  let d = $derived(props.data as any);
  let sideLabel = $derived(d.side === 'L' ? 'Izq' : d.side === 'R' ? 'Der' : 'Aleat');
</script>

<div class="node impulse" class:selected={props.selected}>
  <Handle type="target" position={Position.Left} />
  <div class="title">⚡ {d.label ?? 'Impulsos'}</div>
  <div class="body">
    <div class="row"><span>Lado</span><b>{sideLabel}</b></div>
    <div class="row"><span>N°</span><b>{d.count}</b></div>
    <div class="row"><span>Gain</span><b>{d.gain?.toFixed(2)}</b></div>
    <div class="row"><span>Pico</span><b>{d.peakVel}°/s</b></div>
    {#if d.saccade && d.saccade !== 'none'}
      <div class="tag">{d.saccade === 'covert' ? 'Sacada cubierta' : 'Sacada manifiesta'}</div>
    {/if}
  </div>
  <Handle type="source" position={Position.Right} />
</div>

<style>
  .node {
    background: white;
    border: 2px solid var(--primary);
    border-radius: 10px;
    min-width: 170px;
    box-shadow: 0 4px 14px rgba(124, 58, 237, 0.15);
    overflow: hidden;
  }
  .node.selected { box-shadow: 0 0 0 3px var(--primary), 0 4px 14px rgba(124, 58, 237, 0.25); }
  .title {
    background: var(--primary);
    color: white;
    padding: 6px 10px;
    font-weight: 600;
    font-size: 12px;
  }
  .body { padding: 8px 10px; font-size: 11px; }
  .row { display: flex; justify-content: space-between; padding: 1px 0; color: var(--text-muted); }
  .row b { color: var(--text); font-weight: 600; }
  .tag {
    margin-top: 6px;
    background: var(--primary-soft);
    color: var(--primary);
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 10px;
    text-align: center;
  }
</style>
