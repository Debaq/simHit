<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  // Ruta legacy: redirige a /informes (sección con tabs práctica/simulación).
  onMount(() => { goto('/informes', { replaceState: true }); });
</script>

<p style="padding: 24px; color: var(--text-muted);">Redirigiendo a /informes…</p>
