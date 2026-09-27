<script lang="ts">
	import type { AttentionAnswer } from '$lib/domain/encounter';

	/**
	 * Asked once, on leaving a document read or watched for a while (spec 007, FR-006). The answer
	 * says whether a word left untapped means "understood": only "all" does.
	 */
	let { onanswer }: { onanswer: (answer: AttentionAnswer) => void } = $props();

	const ANSWERS: { answer: AttentionAnswer; label: string }[] = [
		{ answer: 'all', label: 'I tapped every word I didn’t know' },
		{ answer: 'some', label: 'Some of them' },
		{ answer: 'none', label: 'I just listened or read' }
	];
</script>

<div class="backdrop">
	<button class="dismiss" onclick={() => onanswer(null)} aria-label="Skip the question"></button>
	<div class="sheet" role="dialog" aria-modal="true" aria-label="How closely did you follow?">
		<p class="question">How closely did you follow?</p>
		{#each ANSWERS as { answer, label } (answer)}
			<button class="choice" onclick={() => onanswer(answer)}>{label}</button>
		{/each}
		<button class="secondary" onclick={() => onanswer(null)}>Skip</button>
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 20;
		display: flex;
		align-items: flex-end;
		justify-content: center;
	}
	.dismiss {
		position: absolute;
		inset: 0;
		background: none;
		border: none;
	}
	.sheet {
		position: relative;
		width: 100%;
		max-width: 32rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 1rem 1rem calc(1rem + env(safe-area-inset-bottom));
		background: var(--paper);
		border-top-left-radius: 16px;
		border-top-right-radius: 16px;
		box-shadow: 0 -8px 30px rgba(0, 0, 0, 0.25);
	}
	.question {
		margin: 0 0 0.25rem;
		font-weight: 600;
	}
	.choice {
		text-align: left;
		padding: 0.75rem;
	}
</style>
