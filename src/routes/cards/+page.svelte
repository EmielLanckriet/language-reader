<script lang="ts">
	import { resolve } from '$app/paths';
	import { session } from '$lib/storage/session';
	import ErrorNotice from '$lib/ui/ErrorNotice.svelte';
	import CardFace from '$lib/ui/CardFace.svelte';
	import type { CardSentence, CardsToday } from '$lib/storage/repository';
	import { RETRACTED } from '$lib/domain/state';
	import { readNewCards } from '$lib/ui/new-cards';
	import type { CardHelp } from '$lib/domain/card-help';

	/**
	 * Reviewing in the Reader (spec 007, US3): today's due cards, then new ones from what the reader
	 * looked up, each shown in a sentence from their own library. The grades are encounters; the
	 * queue is recomputed from them, so nothing about it is stored.
	 */

	const cap = readNewCards();
	let today = $state<CardsToday | null>(null);
	let order: number[] = [];
	let current = $state<{ lexemeId: number; word: string; sentence?: CardSentence } | null>(null);
	/** Counts showings, so a card shown again is mounted afresh, on its front. */
	let showing = $state(0);
	let request = 0;
	let reviewed = $state(0);
	let grading = $state(false);
	let problem = $state<unknown>(null);

	$effect(() => {
		void start();
		return () => request++;
	});

	async function start() {
		problem = null;
		try {
			const { repository } = await session();
			today = await repository.cardsToday(cap);
			order = [...today.queue.due, ...today.queue.fresh];
			await next();
		} catch (error) {
			problem = error;
		}
	}

	/** The next card: the queue, then a card answered Again once it is nearly due again. */
	async function next() {
		const own = ++request;
		current = null;
		const { repository } = await session();
		let lexemeId = order.shift();
		if (lexemeId === undefined) {
			const again = await repository.cardsToday(cap);
			if (today) today.words = { ...today.words, ...again.words };
			lexemeId = again.queue.due[0] ?? again.queue.soon[0];
		}
		if (lexemeId === undefined || !today) return;
		const sentence = await repository.cardSentence(lexemeId);
		if (own !== request || !sentence) return;
		current = { lexemeId, word: today.words[lexemeId], sentence };
		showing++;
	}

	async function grade(value: 1 | 2 | 3 | 4, sentence: CardSentence | undefined, help: CardHelp) {
		if (!current || grading) return;
		grading = true;
		try {
			const { repository } = await session();
			const shown =
				sentence?.documentId !== undefined
					? {
							documentId: sentence.documentId,
							fromOffset: sentence.from + sentence.wordFrom,
							toOffset: sentence.from + sentence.wordTo
						}
					: undefined;
			await repository.recordReview(current.lexemeId, value, shown, sentence?.sourceKey, help);
			reviewed++;
			retiredLast = null;
			await next();
		} catch (error) {
			problem = error;
		} finally {
			grading = false;
		}
	}

	/** The last card retired, with the mark it had, so Undo can put that mark back (ADR-0040). */
	let retiredLast = $state<{ lexemeId: number; word: string; previous?: string } | null>(null);

	async function retire() {
		if (!current || grading) return;
		grading = true;
		try {
			const { repository } = await session();
			const { lexemeId, word } = current;
			const previous = (await repository.getStates([lexemeId])).get(lexemeId)?.state;
			await repository.assertState(lexemeId, 'retired');
			retiredLast = { lexemeId, word, previous };
			await next();
		} catch (error) {
			problem = error;
		} finally {
			grading = false;
		}
	}

	async function unretire() {
		if (!retiredLast || grading) return;
		grading = true;
		try {
			const { repository } = await session();
			await repository.assertState(retiredLast.lexemeId, retiredLast.previous ?? RETRACTED);
			if (current) order.unshift(current.lexemeId);
			order.unshift(retiredLast.lexemeId);
			retiredLast = null;
			await next();
		} catch (error) {
			problem = error;
		} finally {
			grading = false;
		}
	}
</script>

{#if problem}
	<ErrorNotice error={problem} onretry={start} />
{:else if !today}
	<p class="loading">Finding today’s cards…</p>
{:else}
	<p class="subtitle counts">
		{today.counts.due} due · {today.counts.fresh} new{#if reviewed > 0}
			· {reviewed} reviewed{/if}
	</p>
	{#if current}
		{#key showing}
			<CardFace
				lexemeId={current.lexemeId}
				word={current.word}
				sentence={current.sentence}
				busy={grading}
				ongrade={grade}
				onretire={retire}
			>
				{#snippet notice()}
					{#if retiredLast}<p class="audio-note" role="status">
							<span lang="zh-Hans">{retiredLast.word}</span> retired: it stays remembered but is no
							longer a card.
							<button class="link" onclick={unretire} disabled={grading}>Undo</button>
						</p>{/if}
				{/snippet}
			</CardFace>
		{/key}
	{:else}
		{#if retiredLast}<p class="audio-note" role="status">
				<span lang="zh-Hans">{retiredLast.word}</span> retired.
				<button class="link" onclick={unretire} disabled={grading}>Undo</button>
			</p>{/if}
		<div class="empty card-face">
			<h2>{reviewed > 0 ? 'Done for now.' : 'Nothing to review.'}</h2>
			<p>Words you look up while reading or watching become cards.</p>
			<a href={resolve('/')}>Back to your library →</a>
		</div>
	{/if}
{/if}

<style>
	.audio-note {
		font-size: 0.78rem;
		color: var(--muted);
		line-height: 1.5;
	}
	.counts {
		margin: 0 0 0.25rem;
	}
	.card-face {
		overflow-wrap: anywhere;
	}
	.empty {
		padding: 1.5rem 0;
	}
	.link {
		background: none;
		border: none;
		padding: 0 0.25rem;
		min-height: 0;
		color: var(--accent);
		text-decoration: underline;
		font-size: inherit;
	}
</style>
