<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    title,
    subtitle = '',
    showHeading = false,
    children
  }: { title: string; subtitle?: string; showHeading?: boolean; children?: Snippet } = $props();
</script>

{#if showHeading || children}
  <header class="page-head" class:page-head-actions-only={!showHeading}>
    {#if showHeading}
      <div class="page-head-text">
        <h1>{title}</h1>
        {#if subtitle}<p class="muted small">{subtitle}</p>{/if}
      </div>
    {/if}
    {#if children}<div class="page-actions">{@render children()}</div>{/if}
  </header>
{/if}
