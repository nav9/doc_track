<script lang="ts">
  import type { HTMLSelectAttributes } from 'svelte/elements';

  interface Option {
    value: string;
    label: string;
  }

  let {
    label,
    value = $bindable(''),
    options,
    hint = '',
    disabled = false,
    required = false,
    onchange
  }: {
    label: string;
    value?: string;
    options: Option[];
    hint?: string;
    disabled?: boolean;
    required?: boolean;
    onchange?: HTMLSelectAttributes['onchange'];
  } = $props();
</script>

<label class="field">
  <span class="field-label">{label}{#if required}<span class="req"> *</span>{/if}</span>
  <select class="input-base" bind:value {disabled} {required} {onchange}>
    {#each options as option (option.value)}
      <option value={option.value}>{option.label}</option>
    {/each}
  </select>
  {#if hint}<span class="field-hint">{hint}</span>{/if}
</label>
