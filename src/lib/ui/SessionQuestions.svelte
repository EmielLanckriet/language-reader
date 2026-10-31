<script lang="ts">
	import type { AttentionAnswer } from '$lib/domain/encounter';

	/**
	 * A session's one optional question: under More → Sessions, and in the reader when it is left
	 * or finished. "Studied it" lets untapped words count as understood and sends the minutes to
	 * Taal as Study; "Shadowed it" as Output; "Just watched it" as Input (asked for 2026-10-31).
	 */
	let {
		modality,
		answered,
		answer,
		disabled = false,
		onanswer
	}: {
		modality: string;
		answered: boolean;
		answer: AttentionAnswer;
		disabled?: boolean;
		onanswer: (value: AttentionAnswer) => void;
	} = $props();

	const media = $derived(modality === 'media');
	const answers = $derived<{ value: AttentionAnswer; label: string }[]>([
		{ value: 'all', label: 'Studied it: looked up every unknown word' },
		{ value: 'none', label: media ? 'Just watched it' : 'Just read it' },
		{ value: 'shadow', label: 'Shadowed it' },
		{ value: null, label: 'Skip' }
	]);
	// Answers given before 2026-10-31 may be "some", which is no longer offered.
	const current = $derived(
		answer === 'some' ? 'Looked some up' : answers.find((a) => a.value === answer)?.label
	);
</script>

<p class="question">{media ? 'How did you watch this?' : 'How did you read this?'}</p>
<div class="answer-options">
	{#each answers as option (option.label)}<button
			class="secondary"
			class:chosen={answered && answer === option.value}
			aria-pressed={answered && answer === option.value}
			{disabled}
			onclick={() => onanswer(option.value)}>{option.label}</button
		>{/each}
</div>
{#if answered}<p class="muted">Current answer: {current}.</p>{/if}

<style>
	.question {
		font-weight: 650;
	}
	.answer-options {
		display: grid;
		gap: 0.5rem;
	}
	.answer-options button {
		text-align: left;
	}
	.answer-options .chosen {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
</style>
