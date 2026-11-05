<script lang="ts">
  import { X } from '@lucide/svelte';
  import { app } from '../../app/state.svelte';
</script>

<div class="toast-host" aria-live="polite" aria-atomic="false">
  {#each app.toasts as toast (toast.id)}
    <div class="toast toast-{toast.tone}" role="status">
      <span class="toast-text">{toast.message}</span>
      <button
        type="button"
        class="icon-btn"
        aria-label="Dismiss"
        onclick={() => app.dismissToast(toast.id)}
      >
        <X size={14} />
      </button>
    </div>
  {/each}
</div>
