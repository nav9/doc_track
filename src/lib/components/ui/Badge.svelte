<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    tone = 'neutral',
    children
  }: {
    tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
    children: Snippet;
  } = $props();
</script>

<span class="badge badge-{tone}">{@render children()}</span>
