<script lang="ts">
  import { Position } from '@xyflow/system';
  import type { NodeProps } from '../../types';

  import { Handle } from '../Handle';

  let { data = { label: 'Node' }, targetPosition = Position.Top }: NodeProps = $props();
</script>

{data?.label}
<Handle type="target" position={targetPosition} />
