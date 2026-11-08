<script lang="ts">
  import { CalendarDays } from '@lucide/svelte';
  import type { HTMLInputAttributes } from 'svelte/elements';
  import { formatDate } from '../../domain/common/dates';

  interface Props {
    label: string;
    value?: string;
    type?: 'text' | 'email' | 'tel' | 'date' | 'time' | 'password' | 'search' | 'textarea';
    hint?: string;
    error?: string;
    placeholder?: string;
    required?: boolean;
    disabled?: boolean;
    min?: string;
    max?: string;
    step?: string;
    rows?: number;
    id?: string;
    oninput?: HTMLInputAttributes['oninput'];
    onchange?: HTMLInputAttributes['onchange'];
  }

  let {
    label,
    value = $bindable(''),
    type = 'text',
    hint = '',
    error = '',
    placeholder = '',
    required = false,
    disabled = false,
    min,
    max,
    step,
    rows = 3,
    id,
    oninput,
    onchange
  }: Props = $props();
</script>

<label class="field" for={id}>
  <span class="field-label">{label}{#if required}<span class="req"> *</span>{/if}</span>
  {#if type === 'textarea'}
    <textarea
      class="input-base"
      {id}
      {placeholder}
      {disabled}
      {required}
      {rows}
      bind:value
    ></textarea>
  {:else if type === 'date'}
    <span class="date-input-shell">
      <input
        class="input-base date-input-native"
        {id}
        {type}
        {placeholder}
        {disabled}
        {required}
        {min}
        {max}
        {step}
        {oninput}
        {onchange}
        autocomplete="off"
        bind:value
      />
      <span class="date-input-value" class:is-empty={!value} aria-hidden="true">
        {value ? formatDate(value) : placeholder || 'Select date'}
      </span>
      <CalendarDays class="date-input-icon" size={14} aria-hidden="true" />
    </span>
  {:else}
    <input
      class="input-base"
      {id}
      {type}
      {placeholder}
      {disabled}
      {required}
      {min}
      {max}
      {step}
      {oninput}
      {onchange}
      autocomplete="off"
      bind:value
    />
  {/if}
  {#if hint}<span class="field-hint">{hint}</span>{/if}
  {#if error}<span class="field-error">{error}</span>{/if}
</label>
