<script lang="ts">
	import { CardAudio, timedExample } from '$lib/media/card-audio';
	import { exampleAudio } from '$lib/media/example-bundle';
	import { resolve } from '$app/paths';
	import { session } from '$lib/storage/session';
	import { lookUp } from '$lib/analyzer/lookup';
	import { loadMedia } from '$lib/media/store';
	import { englishFor, llmByLine } from '$lib/translation/lines';
	import { humanLines } from '$lib/media/translation';
	import { quickTranslation, type QuickTranslation } from '$lib/translation/quick';
	import ErrorNotice from '$lib/ui/ErrorNotice.svelte';
	import { readingsOf } from '$lib/analyzer/pronounce';
	import type { CardSentence, CardsToday } from '$lib/storage/repository';
	import { RETRACTED } from '$lib/domain/state';
	import { readNewCards } from '$lib/ui/new-cards';

	/**
	 * Reviewing in the Reader (spec 007, US3): today's due cards, then new ones from what the reader
	 * looked up, each shown in a sentence from their own library. The grades are encounters; the
	 * queue is recomputed from them, so nothing about it is stored.
	 */

	const cap = readNewCards();
	let today = $state<CardsToday | null>(null);
	let order: number[] = [];
	let current = $state<{
		lexemeId: number;
		word: string;
		sentence?: CardSentence;
		english?: string;
	} | null>(null);
	let revealed = $state(false);
	let audio: CardAudio | undefined;
	let playing = $state(false);
	let audioProblem = $state('');
	let sentenceClip = $state<{ file: Blob; start: number; end?: number } | null>(null);
	let wordClip: Blob | undefined;
	let request = 0;
	$effect(() => {
		audio = new CardAudio((active, error) => {
			playing = active;
			if (error) audioProblem = error;
		});
		// Voice discovery may complete asynchronously before the first pronunciation tap.
		globalThis.speechSynthesis?.getVoices();
		return () => {
			request++;
			audio?.dispose();
		};
	});
	function playSentence() {
		audioProblem = '';
		if (sentenceClip) audio?.play(sentenceClip.file, sentenceClip.start, sentenceClip.end);
	}
	function playWord() {
		audioProblem = '';
		if (wordClip) audio?.play(wordClip);
		else if (current) audio?.speak(current.word);
	}

	/**
	 * Pinyin per character of the card's sentence, shown from the start: the card tests understanding
	 * what is read and heard, not recalling the pronunciation (issue #7).
	 */
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
			py: readings[i] ?? ''
		}));
	});
	const wordReadings = $derived(
		readings.slice(
			current?.sentence?.wordFrom ?? 0,
			current?.sentence?.wordTo ?? [...(current?.word ?? '')].length
		)
	);
	let reviewed = $state(0);
	let grading = $state(false);
	let problem = $state<unknown>(null);

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
		audio?.stop();
		audioProblem = '';
		sentenceClip = null;
		wordClip = undefined;
		const own = ++request;
		revealed = false;
		current = null;
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
		if (own !== request) return;
		if (!sentence) {
			current = null;
			return;
		}
		current = { lexemeId, word: today.words[lexemeId], sentence, english: sentence.translation };
		void prepareExample(own, lexemeId, sentence).catch((error) => {
			if (own === request) audioProblem = String(error);
		});
	}

	// --- The sentence's English: a video's own line, else the quick translator (ADR-0023). ---

	let quick: QuickTranslation | undefined;
	const asked: string[] = [];
	const quickEnglish: (string | undefined)[] = [];

	async function prepareExample(own: number, lexemeId: number, sentence: CardSentence) {
		const [wordFile, sentenceFile, media] = await Promise.all([
			sentence.wordAudio ? exampleAudio(sentence.wordAudio) : undefined,
			sentence.sentenceAudio ? exampleAudio(sentence.sentenceAudio) : undefined,
			sentence.documentId !== undefined ? loadMedia(sentence.documentId).catch(() => null) : null
		]);
		if (own !== request) return;
		wordClip = wordFile;
		if (sentenceFile) sentenceClip = { file: sentenceFile, start: 0 };
		if (sentence.source === 'anki') return;
		const timed = media && timedExample(sentence, media.cues);
		if (timed && current) {
			sentence = timed.sentence;
			current = { ...current, sentence };
			const file = media.sound ?? media.media;
			if (file) sentenceClip = { file, start: timed.start, end: timed.end };
		}

		if (media && timed) {
			// A person's English first (spec 012); a card shows English even where reading hides it.
			const lines = englishFor(
				media.cues.length,
				llmByLine(media.cues, media.translation),
				media.quick,
				humanLines(media)
			);
			const line = lines[sentence.line]?.text;
			if (line) return show(lexemeId, sentence.text, line);
		}
		if (current?.lexemeId !== lexemeId || current.sentence?.text !== sentence.text) return;
		const index = asked.push(sentence.text) - 1;
		quick ??= quickTranslation(
			() => asked,
			(i) => quickEnglish[i] !== undefined,
			(i, english) => {
				quickEnglish[i] = english;
				if (current && asked[i] === current.sentence?.text)
					show(current.lexemeId, asked[i], english);
			},
			() => {}
		);
		quick.more();
		quick.focus(index, true);
	}

	function show(lexemeId: number, sentenceText: string, english: string) {
		if (current?.lexemeId === lexemeId && current.sentence?.text === sentenceText)
			current = { ...current, english };
	}

	async function grade(value: 1 | 2 | 3 | 4) {
		if (!current || grading) return;
		grading = true;
		try {
			const { repository } = await session();
			audio?.stop();
			const shown =
				current.sentence?.documentId !== undefined
					? {
							documentId: current.sentence.documentId,
							fromOffset: current.sentence.from + current.sentence.wordFrom,
							toOffset: current.sentence.from + current.sentence.wordTo
						}
					: undefined;
			await repository.recordReview(current.lexemeId, value, shown, current.sentence?.sourceKey);
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
			audio?.stop();
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

	const GRADES = [
		{ value: 1, label: 'Again' },
		{ value: 2, label: 'Hard' },
		{ value: 3, label: 'Good' },
		{ value: 4, label: 'Easy' }
	] as const;
</script>

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
		<section class="card" aria-label="Reading flashcard">
			<div class="card-face">
				<p class="hanzi" lang="zh-Hans">{current.word}</p>
				<p class="word-pinyin pinyin" aria-label="Word pronunciation">
					{wordReadings.filter(Boolean).join(' ')}
				</p>
				{#if revealed}
					<div class="answer" aria-live="polite">
						{#await lookUp(current.word, wordReadings)}
							<p class="muted">Looking up…</p>
						{:then parts}
							{#each parts as part (part.text)}
								{#if parts.length > 1}<p class="part-word" lang="zh-Hans">{part.text}</p>{/if}
								{#each part.entries.slice(0, 3) as entry, i (i)}
									<div class="definition">
										{#if entry.pinyin.toLowerCase() !== wordReadings.join(' ').toLowerCase()}<span
												class="pinyin alternate-reading">{entry.pinyin}</span
											>{/if}
										<p class="meaning">{entry.meaning}</p>
									</div>
								{/each}
							{:else}<p class="muted">Not in the dictionary.</p>{/each}
						{:catch error}<ErrorNotice {error} />{/await}
					</div>
				{/if}
				{#if current.sentence}
					<div class="example">
						<p class="sentence" lang="zh-Hans">
							{#each characters as ch, i (i)}{#if ch.part === 'word'}<mark>{ch.c}</mark
									>{:else}{ch.c}{/if}{/each}
						</p>
						<p class="sentence-pinyin pinyin" aria-label="Sentence pronunciation">
							{characters.map((ch) => ch.py || ch.c).join(' ')}
						</p>
						{#if revealed && current.english}<p class="english" lang="en">{current.english}</p>{/if}
					</div>
				{/if}
			</div>
			<div class="review-actions">
				<!-- On both faces (issue #7): tapped, never played by itself. -->
				<div class="audio-actions">
					<button onclick={playWord}>Hear word</button>
					<button onclick={playSentence} disabled={!sentenceClip}>Hear sentence</button>
					{#if playing}<button onclick={() => audio?.stop()}>Stop</button>{/if}
				</div>
				{#if retiredLast}<p class="audio-note" role="status">
						<span lang="zh-Hans">{retiredLast.word}</span> retired: it stays remembered but is no
						longer a card.
						<button class="link" onclick={unretire} disabled={grading}>Undo</button>
					</p>{/if}
				{#if audioProblem}<p class="audio-note" role="status">{audioProblem}</p>{/if}
				{#if revealed}
					<div class="grades">
						{#each GRADES as { value, label } (value)}<button
								class="grade g{value}"
								disabled={grading}
								onclick={() => grade(value)}>{label}</button
							>{/each}
					</div>
				{:else}
					<button class="reveal" onclick={() => (revealed = true)}>Show answer</button>
				{/if}
				<button class="retire" onclick={retire} disabled={grading}>Retire this card</button>
			</div>
		</section>
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
	.audio-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-bottom: 0.6rem;
	}
	.audio-actions button {
		font-size: 0.85rem;
		padding: 0.6rem 0.8rem;
		min-height: 44px;
	}

	.card {
		margin: 1.25rem 0;
	}
	.card-face {
		padding: 1.5rem;
		border: 1px solid #e5dcc7;
		border-radius: 20px;
		background: #fdf6e3;
		color: #292b28;
		overflow-wrap: anywhere;
	}
	.hanzi {
		font-family: Kaiti, 'KaiTi', 'STKaiti', 'Noto Serif CJK SC', serif;
		font-size: clamp(3rem, 15vw, 4.875rem);
		line-height: 1.3;
		margin: 0;
		letter-spacing: 0.03em;
	}
	.pinyin {
		font-family: 'Gentium Plus', Georgia, serif;
		color: #005500;
		line-height: 1.6;
	}
	.word-pinyin {
		font-size: 1.375rem;
		margin: 0.35rem 0 1rem;
		min-height: 2.2rem;
	}
	.answer {
		margin: 1rem 0 1.5rem;
	}
	.definition + .definition {
		margin-top: 0.65rem;
	}
	.meaning,
	.english {
		font-family: Georgia, serif;
		font-size: 1rem;
		line-height: 1.7;
		margin: 0.25rem 0;
	}
	.alternate-reading {
		font-size: 1rem;
	}
	.part-word {
		font-size: 1.3rem;
		margin: 0.6rem 0 0.2rem;
	}
	.example {
		border-top: 1px solid #ded6c4;
		padding-top: 1.25rem;
		margin-top: 1.25rem;
	}
	.sentence {
		font-family: SimSun, 'Songti SC', 'Noto Serif CJK SC', serif;
		font-size: 1.5rem;
		line-height: 1.8;
		margin: 0.5rem 0;
	}
	mark {
		color: inherit;
		background: transparent;
		text-decoration: underline;
		text-decoration-color: #7c9962;
		text-decoration-thickness: 2px;
		text-underline-offset: 0.22em;
		font-weight: 600;
	}
	.sentence-pinyin {
		font-size: 1.2rem;
		margin: 0.3rem 0 0.8rem;
	}
	.english {
		margin-top: 1rem;
	}
	.review-actions {
		position: sticky;
		bottom: calc(4.7rem + env(safe-area-inset-bottom));
		background: var(--paper);
		padding: 0.8rem 0 0.35rem;
		z-index: 2;
	}
	.reveal {
		width: 100%;
		min-height: 54px;
		font-weight: 650;
	}
	.grades {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 0.45rem;
	}
	.grade {
		padding: 0.8rem 0.15rem;
		min-height: 52px;
		font-size: 0.95rem;
		font-weight: 650;
		border: 1px solid var(--rule);
	}
	.g1 {
		background: #f6e6e3;
		color: #8b3530;
	}
	.g2 {
		background: #f4eddb;
		color: #785915;
	}
	.g3 {
		background: var(--accent);
		color: var(--on-accent);
	}
	.g4 {
		background: #e1edf4;
		color: #285570;
	}
	.retire {
		display: block;
		margin: 0.4rem 0 0 auto;
		min-height: 44px;
		padding: 0.4rem 0.6rem;
		font-size: 0.8rem;
		background: transparent;
		color: var(--muted);
		border: none;
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
	@media (prefers-color-scheme: dark) {
		.card-face {
			background: #242923;
			color: #e6e8dc;
			border-color: #424838;
		}
		.pinyin {
			color: #a7d69e;
		}
		.example {
			border-color: #424838;
		}
		.g1 {
			background: #462c2a;
			color: #f0aea6;
		}
		.g2 {
			background: #403721;
			color: #e5cc8e;
		}
		.g4 {
			background: #263b48;
			color: #afd3e8;
		}
	}
</style>
