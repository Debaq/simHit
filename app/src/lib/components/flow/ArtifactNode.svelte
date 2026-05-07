<script lang="ts">
  import { Handle, Position, type NodeProps } from '@xyflow/svelte';
  let props: NodeProps = $props();
  let d = $derived(props.data as any);
  const labels: Record<string, string> = {
    blink: 'Parpadeo',
    slip: 'Deslizamiento gafas',
    wrong_dir: 'Dirección errada',
    overshoot: 'Overshoot',
    fixation_loss: 'Pérdida fijación',
  };
</script>

<div class="node artifact" class:selected={props.selected}>
  <Handle type="target" position={Position.Left} />
  <div class="title">⚠ {d.label ?? 'Artefacto'}</div>
  <div class="body">
    <div class="kind">{labels[d.artifact] ?? d.artifact}</div>
    <div class="prob">prob {(d.probability * 100).toFixed(0)}%</div>
  </div>
  <Handle type="source" position={Position.Right} />
</div>

<style>
  .node {
    background: white;
    border: 2px dashed #e11d48;
    border-radius: 10px;
    min-width: 160px;
    box-shadow: 0 4px 14px rgba(225, 29, 72, 0.15);
    overflow: hidden;
  }
  .node.selected { box-shadow: 0 0 0 3px #e11d48, 0 4px 14px rgba(225, 29, 72, 0.25); }
  .title { background: #e11d48; color: white; padding: 6px 10px; font-weight: 600; font-size: 12px; }
  .body { padding: 8px 10px; font-size: 11px; text-align: center; }
  .kind { font-weight: 600; color: var(--text); }
  .prob { color: var(--text-muted); font-size: 10px; margin-top: 2px; }
</style>
