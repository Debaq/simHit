<script lang="ts">
  import { Handle, Position, type NodeProps } from '@xyflow/svelte';
  let props: NodeProps = $props();
  let d = $derived(props.data as any);
</script>

<div class="node pause" class:selected={props.selected}>
  <Handle type="target" position={Position.Left} />
  <div class="title">⏸ {d.label ?? 'Pausa'}</div>
  <div class="body">{(d.durationMs / 1000).toFixed(1)}s</div>
  <Handle type="source" position={Position.Right} />
</div>

<style>
  .node {
    background: white;
    border: 2px solid #f59e0b;
    border-radius: 10px;
    min-width: 130px;
    box-shadow: 0 4px 14px rgba(245, 158, 11, 0.15);
    overflow: hidden;
  }
  .node.selected { box-shadow: 0 0 0 3px #f59e0b, 0 4px 14px rgba(245, 158, 11, 0.25); }
  .title { background: #f59e0b; color: white; padding: 6px 10px; font-weight: 600; font-size: 12px; }
  .body { padding: 8px 10px; font-size: 14px; font-weight: 700; text-align: center; font-family: ui-monospace, monospace; }
</style>
