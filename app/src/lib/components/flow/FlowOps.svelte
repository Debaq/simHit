<script lang="ts">
  import { useSvelteFlow } from '@xyflow/svelte';
  let { onReady }: { onReady: (sf: ReturnType<typeof useSvelteFlow>) => void } = $props();
  const sf = useSvelteFlow();
  $effect(() => onReady(sf));
</script>
