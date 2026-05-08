<script lang="ts">
  import '../app.css';
  import AppDialog from '$lib/components/AppDialog.svelte';
  let { children } = $props();
</script>

{@render children()}
<AppDialog />
