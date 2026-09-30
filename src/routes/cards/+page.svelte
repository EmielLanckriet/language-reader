<script lang="ts">
	import { resolve } from '$app/paths';
	import { session } from '$lib/storage/session';
	import { lookUp } from '$lib/analyzer/lookup';
	import { loadMedia } from '$lib/media/store';
	import { englishFor, llmByLine } from '$lib/translation/lines';
	import { quickTranslation, type QuickTranslation } from '$lib/translation/quick';
	import ErrorNotice from '$lib/ui/ErrorNotice.svelte';
	import { readingsOf } from '$lib/analyzer/pronounce';
	import type { CardSentence, CardsToday } from '$lib/storage/repository';

	/**
	 * Reviewing in the Reader (spec 007, US3): today's due cards, then new ones from what the reader
	 * looked up, each shown in a sentence from their own library. The grades are encounters; the
	 * queue is recomputed from them, so nothing about it is stored.
	 */

	const CAP_KEY = 'reader.newCards';
	let cap = $state(readCap());
	let today = $state<CardsToday | null>(null);
	let order: number[] = [];
	let current = $state<{
		lexemeId: number;
		word: string;
		sentence?: CardSentence;
		english?: string;
	} | null>(null);
	let revealed = $state(false);
	/** Pinyin per character of the card's sentence; the card's own word shows it only when revealed. */
	let readings = $state<string[]>([]);
	$effect(() => {
		const text = current?.sentence?.text ?? current?.word;
		readings = [];
		if (text === undefined) return;
		let still = true;
		void readingsOf(text).then((found) => still && (readings = found));
		return () => (still = false);
	});
	/** The sentence's characters, each with its pinyin where it may be shown. */
	const characters = $derived.by(() => {
		if (!current) return [];
		const text = current.sentence?.text ?? current.word;
		const from = current.sentence?.wordFrom ?? 0;
		const to = current.sentence?.wordTo ?? [...current.word].length;
		return [...text].map((c, i) => ({
			c,
			part: i < from ? 'before' : i < to ? 'word' : 'after',
			py: i >= from && i < to && !revealed ? '' : (readings[i] ?? '')
		}));
	});
	let reviewed = $state(0);
	let grading = $state(false);
	let problem = $state<unknown>(null);

	function readCap(): number {
		try {
			const kept = Number(localStorage.getItem(CAP_KEY));
			return Number.isInteger(kept) && kept >= 0 && localStorage.getItem(CAP_KEY) !== null
				? kept
				: 10;
		} catch {
			return 10;
		}
	}

	function keepCap() {
		try {
			localStorage.setItem(CAP_KEY, String(cap));
		} catch {
			// The choice lasts for this visit.
		}
		void start();
	}

	$effect(() => {
		void start();
		return () => quick?.stop();
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
		revealed = false;
		const { repository } = await session();
		let lexemeId = order.shift();
		if (lexemeId === undefined) {
			const again = await repository.cardsToday(cap);
			if (today) today.words = { ...today.words, ...again.words };
			lexemeId = again.queue.due[0] ?? again.queue.soon[0];
		}
		if (lexemeId === undefined || !today) {
			current = null;
			return;
		}
		const sentence = await repository.cardSentence(lexemeId);
		current = { lexemeId, word: today.words[lexemeId], sentence };
		void englishOf(lexemeId, sentence);
	}

	// --- The sentence's English: a video's own line, else the quick translator (ADR-0023). ---

	let quick: QuickTranslation | undefined;
	const asked: string[] = [];
	const quickEnglish: (string | undefined)[] = [];

	async function englishOf(lexemeId: number, sentence: CardSentence | undefined) {
		if (!sentence) return;
		const media = await loadMedia(sentence.documentId).catch(() => null);
		if (media) {
			const lines = englishFor(
				media.cues.length,
				llmByLine(media.cues, media.translation),
				media.quick
			);
			const line = lines[sentence.line]?.text;
			if (line) return show(lexemeId, line);
		}
		const index = asked.push(sentence.text) - 1;
		quick ??= quickTranslation(
			() => asked,
			(i) => quickEnglish[i] !== undefined,
			(i, english) => {
				quickEnglish[i] = english;
				if (i === index || asked[i] === current?.sentence?.text) show(current!.lexemeId, english);
			},
			() => {}
		);
		quick.more();
		quick.focus(index, true);
	}

	function show(lexemeId: number, english: string) {
		if (current?.lexemeId === lexemeId) current = { ...current, english };
	}

	async function grade(value: 1 | 2 | 3 | 4) {
		if (!current || grading) return;
		grading = true;
		try {
			const { repository } = await session();
			const shown = current.sentence && {
				documentId: current.sentence.documentId,
				fromOffset: current.sentence.from + current.sentence.wordFrom,
				toOffset: current.sentence.from + current.sentence.wordTo
			};
			await repository.recordReview(current.lexemeId, value, shown);
			reviewed++;
			await next();
		} catch (error) {
			problem = error;
		} finally {
			grading = false;
		}
	}

	const GRADES = [
		{ value: 1, label: 'Again' },
		{ value: 2, label: 'Hard' },
		{ value: 3, label: 'Good' },
		{ value: 4, label: 'Easy' }
	] as const;
</script>

{#snippet rubied(chars: { c: string; py: string }[])}{#each chars as ch, i (i)}{#if ch.py}<ruby
				>{ch.c}<rt>{ch.py}</rt></ruby
			>{:else}{ch.c}{/if}{/each}{/snippet}

<h1>Cards</h1>
<p><a href={resolve('/cards/tuning')}>Learning data</a></p>

{#if problem}
	<ErrorNotice error={problem} onretry={start} />
{:else if !today}
	<p class="loading">Finding today’s cards…</p>
{:else}
	<p class="subtitle">
		{today.counts.due} due · {today.counts.fresh} new{#if reviewed > 0}
			· {reviewed} reviewed{/if}
	</p>

	{#if current}
		<section class="card" aria-live="polite">
			<!-- No whitespace inside: this is Chinese, and any gap in the markup would show. -->
			<p class="sentence" lang="zh">
				{@render rubied(characters.filter((ch) => ch.part === 'before'))}<mark
					>{@render rubied(characters.filter((ch) => ch.part === 'word'))}</mark
				>{@render rubied(characters.filter((ch) => ch.part === 'after'))}
			</p>

			{#if revealed}
				<div class="answer">
					{#await lookUp(current.word)}
						<p class="muted">Looking up…</p>
					{:then parts}
						{#each parts as part (part.text)}
							{#each part.entries.slice(0, 3) as entry, i (i)}
								<p><span class="pinyin">{entry.pinyin}</span> {entry.meaning}</p>
							{/each}
						{:else}
							<p class="muted">Not in the dictionary.</p>
						{/each}
					{/await}
					{#if current.english}<p class="english" lang="en">{current.english}</p>{/if}
				</div>
				<div class="grades">
					{#each GRADES as { value, label } (value)}
						<button class="grade g{value}" disabled={grading} onclick={() => grade(value)}
							>{label}</button
						>
					{/each}
				</div>
				<p class="muted">
					Rate what you recalled before Show. Hard means you remembered with difficulty; choose
					Again if you needed the answer.
				</p>
			{:else}
				<button class="reveal" onclick={() => (revealed = true)}>Show</button>
			{/if}
		</section>
	{:else}
		<p class="empty">
			{reviewed > 0 ? 'Done for now.' : 'Nothing to review.'} Words you look up while reading or watching
			become cards.
		</p>
	{/if}

	<label class="cap">
		New cards a day
		<input type="number" min="0" max="100" bind:value={cap} onchange={keepCap} />
	</label>
{/if}

<style>
	.card {
		margin: 1.5rem 0;
		padding: 1.25rem 1rem;
		border: 1px solid var(--rule);
		border-radius: 12px;
	}
	.sentence {
		font-size: 1.6rem;
		line-height: 1.6;
		margin: 0 0 1rem;
	}
	mark {
		background: color-mix(in srgb, var(--new) 55%, transparent);
		color: inherit;
		border-radius: 0.2em;
	}
	.answer {
		margin-bottom: 1rem;
	}
	.pinyin {
		font-weight: 600;
		margin-right: 0.25rem;
	}
	.english {
		color: var(--muted);
		font-style: italic;
	}
	.reveal {
		width: 100%;
		padding: 0.9rem;
	}
	.grades {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 0.5rem;
	}
	.grade {
		padding: 0.9rem 0;
	}
	.cap {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.9rem;
		color: var(--muted);
	}
	.cap input {
		width: 4.5rem;
	}
</style>
