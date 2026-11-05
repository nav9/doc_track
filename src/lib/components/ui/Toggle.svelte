<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';

  let {
    checked = $bindable(false),
    label,
    hint = '',
    disabled = false,
    onchange
  }: {
    checked?: boolean;
    label: string;
    hint?: string;
    disabled?: boolean;
    onchange?: HTMLInputAttributes['onchange'];
  } = $props();
</script>

<label class="toggle-row" class:disabled>
  <input type="checkbox" bind:checked {disabled} {onchange} />
  <span class="toggle-text">
    <span class="toggle-label">{label}</span>
    {#if hint}<span class="field-hint">{hint}</span>{/if}
  </span>
</label>
