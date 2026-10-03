<script lang="ts">
	import { CardAudio, timedExample } from '$lib/media/card-audio';
	import { exampleAudio } from '$lib/media/example-bundle';
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
	const wordReadings = $derived(
		readings.slice(
			current?.sentence?.wordFrom ?? 0,
			current?.sentence?.wordTo ?? [...(current?.word ?? '')].length
		)
	);
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
			const lines = englishFor(
				media.cues.length,
				llmByLine(media.cues, media.translation),
				media.quick
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

<div class="cards-heading">
	<div>
		<span class="eyebrow">A word at a time</span>
		<h1>Cards</h1>
	</div>
	<a href={resolve('/cards/tuning')}>Learning data</a>
</div>

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
					{#if revealed}{wordReadings.filter(Boolean).join(' ')}{:else}<span class="recall-hint"
							>Recall the pronunciation and meaning</span
						>{/if}
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
						<span class="eyebrow">In context</span>
						<p class="source">
							{#if current.sentence.documentId !== undefined && current.sentence.available}<a
									href={resolve('/read/[id]', { id: String(current.sentence.documentId) })}
									>{current.sentence.sourceTitle}</a
								>{:else}{current.sentence.sourceTitle}{#if !current.sentence.available}
									· removed from library{/if}{/if}
						</p>
						<p class="sentence" lang="zh-Hans">
							{#each characters as ch, i (i)}{#if ch.part === 'word'}<mark>{ch.c}</mark
									>{:else}{ch.c}{/if}{/each}
						</p>
						<p class="sentence-pinyin pinyin" aria-label="Sentence pronunciation">
							{characters
								.map((ch) => ch.py || (ch.part === 'word' && !revealed ? '…' : ch.c))
								.join(' ')}
						</p>
						{#if revealed && current.english}<p class="english" lang="en">{current.english}</p>{/if}
					</div>
				{/if}
			</div>
			<div class="review-actions">
				{#if revealed}
					<div class="audio-actions">
						<button onclick={playWord}>Hear word</button>
						<button onclick={playSentence} disabled={!sentenceClip}>Hear sentence</button>
						{#if playing}<button onclick={() => audio?.stop()}>Stop</button>{/if}
					</div>
					{#if !sentenceClip}<p class="audio-note">No recording available for this example.</p>{/if}
					{#if audioProblem}<p class="audio-note" role="status">{audioProblem}</p>{/if}
					<div class="grades">
						{#each GRADES as { value, label } (value)}<button
								class="grade g{value}"
								disabled={grading}
								onclick={() => grade(value)}>{label}</button
							>{/each}
					</div>
					<p class="grading-hint">
						Again if you needed the answer. Hard if you recalled it with difficulty.
					</p>
				{:else}
					<button class="reveal" onclick={() => (revealed = true)}>Show answer</button>
				{/if}
			</div>
		</section>
	{:else}
		<div class="empty card-face">
			<h2>{reviewed > 0 ? 'Done for now.' : 'Nothing to review.'}</h2>
			<p>Words you look up while reading or watching become cards.</p>
			<a href={resolve('/')}>Back to your library →</a>
		</div>
	{/if}
	{#if today.counts.awaitingContext > 0}<p class="audio-note">
			{today.counts.awaitingContext} words are waiting for an example. Encounter them in Reader or
			<a href={resolve('/diagnostics')}>import your Anki examples</a>.
		</p>{/if}
	<details class="review-settings">
		<summary>Review settings</summary><label class="cap"
			>New cards a day <input
				type="number"
				min="0"
				max="100"
				bind:value={cap}
				onchange={keepCap}
			/></label
		>
	</details>
{/if}

<style>
	.source,
	.audio-note {
		font-size: 0.78rem;
		color: var(--muted);
		line-height: 1.5;
	}
	.source a {
		color: inherit;
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

	.cards-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}
	.cards-heading > a {
		font-size: 0.8rem;
		color: var(--muted);
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
	.recall-hint {
		font-family: system-ui, sans-serif;
		font-size: 0.82rem;
		color: #687368;
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
	.grading-hint {
		font-size: 0.75rem;
		line-height: 1.4;
		color: var(--muted);
		margin: 0.6rem 0 0.2rem;
	}
	.review-settings {
		margin: 1.5rem 0;
		color: var(--muted);
		font-size: 0.85rem;
	}
	.review-settings summary {
		cursor: pointer;
		min-height: 44px;
		padding: 0.5rem 0;
	}
	.cap {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}
	.cap input {
		width: 4.5rem;
		min-height: 44px;
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
		.recall-hint {
			color: #a6b3a2;
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
