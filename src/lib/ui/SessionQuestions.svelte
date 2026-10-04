<script lang="ts">
	import type { AttentionAnswer, Engagement } from '$lib/domain/encounter';

	/** A session's optional feedback: on Progress, and in the reader when it is left (2026-10-04). */
	let {
		modality,
		engagement,
		answered,
		answer,
		disabled = false,
		onengage,
		onanswer
	}: {
		modality: string;
		engagement: Engagement | null;
		answered: boolean;
		answer: AttentionAnswer;
		disabled?: boolean;
		onengage: (change: Partial<Engagement>) => void;
		onanswer: (value: AttentionAnswer) => void;
	} = $props();

	const answers: { value: AttentionAnswer; label: string }[] = [
		{ value: 'all', label: 'Yes, every unknown word' },
		{ value: 'some', label: 'Only some' },
		{ value: 'none', label: 'I wasn’t tracking unknown words' },
		{ value: null, label: 'Skip / not sure' }
	];
	const modes: { value: Engagement['mode']; label: string }[] = [
		{ value: 'watched', label: 'Watched' },
		{ value: 'listened', label: 'Only listened' }
	];
	const attention: { value: Engagement['attentive']; label: string }[] = [
		{ value: 'yes', label: 'Yes' },
		{ value: 'partly', label: 'Partly' },
		{ value: 'no', label: 'No' }
	];
</script>

{#if modality === 'media'}
	<p class="question">Did you watch, or only listen?</p>
	<div class="answer-options">
		{#each modes as option (option.label)}<button
				class="secondary"
				class:chosen={engagement?.mode === option.value}
				aria-pressed={engagement?.mode === option.value}
				{disabled}
				onclick={() => onengage({ mode: option.value })}>{option.label}</button
			>{/each}
	</div>
	<p class="question">Were you paying attention?</p>
	<div class="answer-options">
		{#each attention as option (option.label)}<button
				class="secondary"
				class:chosen={engagement?.attentive === option.value}
				aria-pressed={engagement?.attentive === option.value}
				{disabled}
				onclick={() => onengage({ attentive: option.value })}>{option.label}</button
			>{/each}
	</div>
	<p class="muted">Kept as a note for now; it does not change your cards.</p>
{/if}
<p class="question">Did you look up every word you didn’t understand?</p>
<p class="muted">This helps interpret untapped words. It does not affect your weekly goal.</p>
<div class="answer-options">
	{#each answers as option (option.label)}<button
			class="secondary"
			class:chosen={answered && answer === option.value}
			aria-pressed={answered && answer === option.value}
			{disabled}
			onclick={() => onanswer(option.value)}>{option.label}</button
		>{/each}
</div>
{#if answered}<p class="muted">
		Current answer: {answers.find((a) => a.value === answer)?.label}. Changes keep the original
		answer in your history.
	</p>{/if}

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
