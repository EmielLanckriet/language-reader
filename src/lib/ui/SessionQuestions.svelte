<script lang="ts">
	import type { AttentionAnswer, Engagement } from '$lib/domain/encounter';

	/**
	 * A session's one optional question: under More → Sessions, and in the reader when it is left
	 * or finished. "Studied it" lets untapped words count as understood and sends the minutes to
	 * Taal as Study; "Shadowed it" as Output; "Just watched/listened to it" as Input (asked for
	 * 2026-10-31). Watched and listened (back by #63) also mark the session's engagement, which
	 * Progress splits video time by; the other answers leave that mark as it is.
	 */
	let {
		modality,
		answered,
		answer,
		engagement,
		disabled = false,
		onanswer
	}: {
		modality: string;
		answered: boolean;
		answer: AttentionAnswer;
		engagement: Engagement | null;
		disabled?: boolean;
		onanswer: (value: AttentionAnswer, mode?: Engagement['mode']) => void;
	} = $props();

	type Option = { value: AttentionAnswer; mode?: Engagement['mode']; label: string };
	const media = $derived(modality === 'media');
	const answers = $derived<Option[]>([
		{ value: 'all', label: 'Studied it: looked up every unknown word' },
		...(media
			? [
					{ value: 'none', mode: 'watched', label: 'Just watched it' } as Option,
					{ value: 'none', mode: 'listened', label: 'Just listened to it' } as Option
				]
			: [{ value: 'none', label: 'Just read it' } as Option]),
		{ value: 'shadow', label: 'Shadowed it' },
		{ value: null, label: 'Skip' }
	]);
	// "Just watched it" answers from before #63 have no mark: that is what they were asked.
	const chosen = (option: Option) =>
		answered &&
		answer === option.value &&
		(!option.mode || option.mode === (engagement?.mode ?? 'watched'));
	// Answers given before 2026-10-31 may be "some", which is no longer offered.
	const current = $derived(
		answer === 'some' ? 'Looked some up' : answers.find((a) => chosen(a))?.label
	);
</script>

<p class="question">{media ? 'How did you watch this?' : 'How did you read this?'}</p>
<div class="answer-options">
	{#each answers as option (option.label)}<button
			class="secondary"
			class:chosen={chosen(option)}
			aria-pressed={chosen(option)}
			{disabled}
			onclick={() => onanswer(option.value, option.mode)}>{option.label}</button
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
