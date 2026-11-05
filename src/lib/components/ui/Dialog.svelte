<script lang="ts">
  import type { Snippet } from 'svelte';
  import { X } from '@lucide/svelte';

  let {
    open = false,
    title = '',
    subtitle = '',
    onclose,
    children,
    footer
  }: {
    open?: boolean;
    title?: string;
    subtitle?: string;
    onclose?: () => void;
    children: Snippet;
    footer?: Snippet;
  } = $props();

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && open) onclose?.();
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
  <div
    class="modal-backdrop"
    role="presentation"
    onclick={(event) => {
      if (event.target === event.currentTarget) onclose?.();
    }}
  >
    <div class="modal" role="dialog" aria-modal="true" aria-label={title}>
      <header class="modal-head">
        <div>
          <h2>{title}</h2>
          {#if subtitle}<p class="muted small">{subtitle}</p>{/if}
        </div>
        <button type="button" class="icon-btn" aria-label="Close" onclick={() => onclose?.()}>
          <X size={16} />
        </button>
      </header>
      <div class="modal-body scroll-y">
        {@render children()}
      </div>
      {#if footer}
        <footer class="modal-foot">{@render footer()}</footer>
      {/if}
    </div>
  </div>
{/if}
