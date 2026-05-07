<script lang="ts">
  import type { Node } from '@xyflow/svelte';
  let { node, onChange, onDelete }: {
    node: Node | null;
    onChange: (data: any) => void;
    onDelete: () => void;
  } = $props();

  function update<K extends string>(k: K, v: any) {
    if (!node) return;
    onChange({ ...(node.data as any), [k]: v });
  }
</script>

<div class="inspector">
  {#if !node}
    <div class="empty">Selecciona un nodo</div>
  {:else}
    <div class="head">
      <div class="kind">{node.type}</div>
      <button class="del" onclick={onDelete}>Eliminar</button>
    </div>

    <label>
      <span>Etiqueta</span>
      <input type="text" value={(node.data as any).label ?? ''} oninput={(e) => update('label', e.currentTarget.value)} />
    </label>

    {#if node.type === 'impulse'}
      {@const d = node.data as any}
      <label>
        <span>Lado</span>
        <select value={d.side} onchange={(e) => update('side', e.currentTarget.value)}>
          <option value="L">Izquierdo</option>
          <option value="R">Derecho</option>
          <option value="random">Aleatorio</option>
        </select>
      </label>
      <label>
        <span>N° impulsos</span>
        <input type="number" min="1" max="100" value={d.count} oninput={(e) => update('count', +e.currentTarget.value)} />
      </label>
      <label>
        <span>Ganancia VOR ({d.gain?.toFixed(2)})</span>
        <input type="range" min="0" max="1.5" step="0.05" value={d.gain} oninput={(e) => update('gain', +e.currentTarget.value)} />
      </label>
      <label>
        <span>Pico velocidad ({d.peakVel} °/s)</span>
        <input type="range" min="80" max="300" step="5" value={d.peakVel} oninput={(e) => update('peakVel', +e.currentTarget.value)} />
      </label>
      <label>
        <span>Sacada correctiva</span>
        <select value={d.saccade} onchange={(e) => update('saccade', e.currentTarget.value)}>
          <option value="none">Sin sacada</option>
          <option value="covert">Cubierta — durante el impulso</option>
          <option value="overt">Manifiesta — después del impulso</option>
        </select>
        <em class="hint">
          {#if d.saccade === 'covert'}
            Cubierta: refijación rápida mientras la cabeza aún gira. Sutil, requiere VOG.
          {:else if d.saccade === 'overt'}
            Manifiesta: refijación al detenerse la cabeza. Visible a ojo desnudo.
          {:else}
            Sin sacada compensatoria.
          {/if}
        </em>
      </label>
    {:else if node.type === 'pause'}
      {@const d = node.data as any}
      <label>
        <span>Duración (ms)</span>
        <input type="number" min="100" max="60000" step="100" value={d.durationMs} oninput={(e) => update('durationMs', +e.currentTarget.value)} />
      </label>
    {:else if node.type === 'artifact'}
      {@const d = node.data as any}
      <label>
        <span>Tipo</span>
        <select value={d.artifact} onchange={(e) => update('artifact', e.currentTarget.value)}>
          <option value="blink">Parpadeo</option>
          <option value="slip">Deslizamiento gafas</option>
          <option value="wrong_dir">Dirección errada</option>
          <option value="overshoot">Overshoot ojo</option>
          <option value="fixation_loss">Pérdida fijación</option>
        </select>
      </label>
      <label>
        <span>Probabilidad ({(d.probability * 100).toFixed(0)}%)</span>
        <input type="range" min="0" max="1" step="0.05" value={d.probability} oninput={(e) => update('probability', +e.currentTarget.value)} />
      </label>
    {/if}
  {/if}
</div>

<style>
  .inspector { padding: 12px; display: flex; flex-direction: column; gap: 10px; height: 100%; overflow-y: auto; }
  .empty { color: var(--text-muted); text-align: center; padding: 20px; font-size: 12px; }
  .head { display: flex; justify-content: space-between; align-items: center; }
  .kind { text-transform: uppercase; font-size: 10px; letter-spacing: .05em; color: var(--text-muted); font-weight: 600; }
  .del { background: transparent; color: var(--danger); border-color: var(--danger); padding: 3px 8px; font-size: 11px; }
  .del:hover { background: var(--danger); color: white; }
  label { display: flex; flex-direction: column; gap: 4px; font-size: 11px; }
  label span { color: var(--text-muted); font-weight: 600; }
  input, select {
    font: inherit; font-size: 12px;
    padding: 5px 8px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
  }
  input:focus, select:focus { outline: none; border-color: var(--primary); }
  input[type="range"] { padding: 0; accent-color: var(--primary); }
  .hint { color: var(--text-muted); font-size: 10px; font-style: italic; line-height: 1.3; }
</style>
