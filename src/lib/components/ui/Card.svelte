<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    children,
    className = '',
    pad = true
  }: { children: Snippet; className?: string; pad?: boolean } = $props();
</script>

<section class="card {pad ? 'card-pad' : ''} {className}">
  {@render children()}
</section>
