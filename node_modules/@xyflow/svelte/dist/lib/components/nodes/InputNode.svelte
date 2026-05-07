<script lang="ts">
  import { Position } from '@xyflow/system';
  import type { NodeProps } from '../../types';

  import { Handle } from '../Handle';

  let { data = { label: 'Node' }, sourcePosition = Position.Bottom }: NodeProps = $props();
</script>

{data?.label}
<Handle type="source" position={sourcePosition} />
