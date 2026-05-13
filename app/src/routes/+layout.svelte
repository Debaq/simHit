<script lang="ts">
  import '../app.css';
  import AppDialog from '$lib/components/AppDialog.svelte';
  import { onMount } from 'svelte';
  import { serial } from '$lib/serial.svelte';
  import { settings } from '$lib/settings.svelte';
  import { sim } from '$lib/simulator.svelte';
  let { children } = $props();

  onMount(() => { settings.load(); });

  // Aplica modo láser al conectar. 'armed' deja láser apagado hasta que arranque
  // un escenario; 'on' lo prende ya; 'off' garantiza apagado.
  $effect(() => {
    if (!serial.connected) return;
    const m = settings.laserMode;
    if (m === 'on') void serial.sendCommand('LASER ON');
    else if (m === 'off') void serial.sendCommand('LASER OFF');
    else if (sim.mode !== 'scenario') void serial.sendCommand('LASER OFF');
  });
</script>

{@render children()}
<AppDialog />
