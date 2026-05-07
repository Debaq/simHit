<script lang="ts">
  import { Handle, Position, type NodeProps } from '@xyflow/svelte';
  let props: NodeProps = $props();
</script>

<div class="node start">
  <div class="title">▶ {props.data?.label ?? 'Inicio'}</div>
  <Handle type="source" position={Position.Right} />
</div>

<style>
  .node {
    background: linear-gradient(135deg, #16a34a, #22c55e);
    color: white;
    border-radius: 999px;
    padding: 8px 18px;
    font-weight: 600;
    font-size: 13px;
    box-shadow: 0 4px 12px rgba(22, 163, 74, 0.25);
    min-width: 90px;
    text-align: center;
  }
</style>
