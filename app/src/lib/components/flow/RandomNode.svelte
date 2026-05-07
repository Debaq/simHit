<script lang="ts">
  import { Handle, Position, type NodeProps } from '@xyflow/svelte';
  let props: NodeProps = $props();
  let d = $derived(props.data as any);
</script>

<div class="node random" class:selected={props.selected}>
  <Handle type="target" position={Position.Left} />
  <div class="title">⤧ {d.label ?? 'Bifurcación'}</div>
  <div class="body">elige una salida al azar</div>
  <Handle type="source" position={Position.Right} id="a" style="top: 35%" />
  <Handle type="source" position={Position.Right} id="b" style="top: 65%" />
</div>

<style>
  .node {
    background: white;
    border: 2px solid #2563eb;
    border-radius: 10px;
    min-width: 150px;
    box-shadow: 0 4px 14px rgba(37, 99, 235, 0.15);
    overflow: hidden;
    position: relative;
  }
  .node.selected { box-shadow: 0 0 0 3px #2563eb, 0 4px 14px rgba(37, 99, 235, 0.25); }
  .title { background: #2563eb; color: white; padding: 6px 10px; font-weight: 600; font-size: 12px; }
  .body { padding: 10px; font-size: 10px; text-align: center; color: var(--text-muted); }
</style>
