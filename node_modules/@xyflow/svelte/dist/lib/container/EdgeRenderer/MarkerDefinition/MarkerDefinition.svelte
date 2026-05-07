<script lang="ts">
  import { useStore } from '../../../store';
  import { Marker } from './';

  const store = useStore();
</script>

<defs>
  {#each store.markers as marker (marker.id)}
    <Marker {...marker} />
  {/each}
</defs>
