<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle' | 'success';
    size?: 'sm' | 'md';
    type?: 'button' | 'submit' | 'reset';
    disabled?: boolean;
    title?: string;
    full?: boolean;
    onclick?: (event: MouseEvent) => void;
    children: Snippet;
  }

  let {
    variant = 'primary',
    size = 'md',
    type = 'button',
    disabled = false,
    title,
    full = false,
    onclick,
    children
  }: Props = $props();
</script>

<button
  {type}
  {disabled}
  {title}
  class="btn btn-{variant} btn-{size}"
  class:btn-full={full}
  {onclick}
>
  {@render children()}
</button>
