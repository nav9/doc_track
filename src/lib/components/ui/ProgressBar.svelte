<script lang="ts">
  import { percent } from '../../app/ui';

  let {
    value,
    max,
    tone = 'primary',
    label = ''
  }: {
    value: number;
    max: number;
    tone?: 'primary' | 'success' | 'warning' | 'danger';
    label?: string;
  } = $props();
</script>

<div class="progress-wrap">
  {#if label}
    <div class="progress-label"><span>{label}</span><span>{Math.round(percent(value, max))}%</span></div>
  {/if}
  <div
    class="progress"
    role="progressbar"
    aria-valuenow={value}
    aria-valuemin={0}
    aria-valuemax={max}
  >
    <div class="progress-bar progress-{tone}" style={`width: ${percent(value, max)}%`}></div>
  </div>
</div>
