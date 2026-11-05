<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    title,
    text = '',
    children
  }: { title: string; text?: string; children?: Snippet } = $props();
</script>

<div class="empty">
  <strong>{title}</strong>
  {#if text}<p class="muted small">{text}</p>{/if}
  {#if children}<div class="empty-actions">{@render children()}</div>{/if}
</div>
