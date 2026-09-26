<script lang="ts">
	/** A labelled bar for something the reader is waiting on. No fraction: a moving, indefinite bar. */
	let { label, fraction }: { label: string; fraction?: number } = $props();
</script>

<div class="progress-bar">
	<span>{label}</span>
	{#if fraction === undefined}
		<progress aria-label={label}></progress>
	{:else}
		<progress aria-label={label} value={Math.max(0, Math.min(1, fraction))}></progress>
	{/if}
</div>

<style>
	.progress-bar {
		font-size: 0.85rem;
		color: var(--muted);
		margin: 0.3rem 0;
	}
	.progress-bar span {
		display: block;
	}
	progress {
		width: 100%;
		height: 0.4rem;
	}
</style>
