<script lang="ts">
  import { Handle, Position, type NodeProps } from '@xyflow/svelte';
  let props: NodeProps = $props();
</script>

<div class="node end">
  <Handle type="target" position={Position.Left} />
  <div class="title">■ {props.data?.label ?? 'Fin'}</div>
</div>

<style>
  .node {
    background: linear-gradient(135deg, #475569, #64748b);
    color: white;
    border-radius: 999px;
    padding: 8px 18px;
    font-weight: 600;
    font-size: 13px;
    box-shadow: 0 4px 12px rgba(71, 85, 105, 0.25);
    min-width: 90px;
    text-align: center;
  }
</style>
