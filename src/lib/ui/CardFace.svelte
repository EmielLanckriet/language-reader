<script lang="ts">
	import type { Snippet } from 'svelte';
	import { CardAudio, timedExample } from '$lib/media/card-audio';
	import { exampleAudio } from '$lib/media/example-bundle';
	import { lookUp } from '$lib/analyzer/lookup';
	import { loadMedia } from '$lib/media/store';
	import { englishFor, llmByLine } from '$lib/translation/lines';
	import { humanLines } from '$lib/media/translation';
	import { quickTranslation, type QuickTranslation } from '$lib/translation/quick';
	import ErrorNotice from '$lib/ui/ErrorNotice.svelte';
	import { readingsOf } from '$lib/analyzer/pronounce';
	import type { CardSentence } from '$lib/storage/repository';
	import { heardOn, type CardHelp } from '$lib/domain/card-help';

	/**
	 * One reading card, both faces (spec 007; shared by Cards and hardcore drills, spec 014). Mounted
	 * once per showing: a card shown again starts on its front. The grade is the caller's to record,
	 * with the sentence as shown, which the audio's timing may have widened to the whole line, and
	 * what else the card gave before it (#37).
	 */
	let {
		lexemeId,
		word,
		sentence,
		busy = false,
		ongrade,
		onstatus,
		notice
	}: {
		lexemeId: number;
		word: string;
		sentence?: CardSentence;
		busy?: boolean;
		ongrade: (value: 1 | 2 | 3 | 4, shown: CardSentence | undefined, help: CardHelp) => void;
		/** Retire or Ignore (spec 019): out of Cards, or out of Cards and drills. */
		onstatus: (status: 'retired' | 'ignored') => void;
		notice?: Snippet;
	} = $props();

	// The sentence and its English as shown: the audio's timing may replace the sentence.
	// svelte-ignore state_referenced_locally
	let shown = $state<CardSentence | undefined>(sentence);
	// svelte-ignore state_referenced_locally
	let english = $state<string | undefined>(sentence?.translation);
	let revealed = $state(false);
	let heard: CardHelp['heard'] = {};
	let audio: CardAudio | undefined;
	let playing = $state(false);
	let audioProblem = $state('');
	let sentenceClip = $state<{ file: Blob; start: number; end?: number } | null>(null);
	let wordClip: Blob | undefined;
	let alive = true;
	let quick: QuickTranslation | undefined;

	$effect(() => {
		audio = new CardAudio((active, error) => {
			playing = active;
			if (error) audioProblem = error;
		});
		// Voice discovery may complete asynchronously before the first pronunciation tap.
		globalThis.speechSynthesis?.getVoices();
		if (shown)
			void prepareExample(shown).catch((error) => {
				if (alive) audioProblem = String(error);
			});
		return () => {
			alive = false;
			audio?.dispose();
			quick?.stop();
		};
	});
	function playSentence() {
		audioProblem = '';
		if (!sentenceClip) return;
		heard = heardOn(heard, 'sentence', revealed);
		audio?.play(sentenceClip.file, sentenceClip.start, sentenceClip.end);
	}
	function playWord() {
		audioProblem = '';
		heard = heardOn(heard, 'word', revealed);
		if (wordClip) audio?.play(wordClip);
		else audio?.speak(word);
	}

	/**
	 * Pinyin per character of the card's sentence, shown from the start: the card tests understanding
	 * what is read and heard, not recalling the pronunciation (issue #7).
	 */
	let readings = $state<string[]>([]);
	$effect(() => {
		const text = shown?.text ?? word;
		readings = [];
		let still = true;
		void readingsOf(text).then((found) => still && (readings = found));
		return () => (still = false);
	});
	/** The sentence's characters, each with its pinyin where it may be shown. */
	const characters = $derived.by(() => {
		const text = shown?.text ?? word;
		const from = shown?.wordFrom ?? 0;
		const to = shown?.wordTo ?? [...word].length;
		return [...text].map((c, i) => ({
			c,
			part: i < from ? 'before' : i < to ? 'word' : 'after',
			py: readings[i] ?? ''
		}));
	});
	const wordReadings = $derived(
		readings.slice(shown?.wordFrom ?? 0, shown?.wordTo ?? [...word].length)
	);

	// --- The sentence's English: a video's own line, else the quick translator (ADR-0023). ---

	async function prepareExample(sentence: CardSentence) {
		const [wordFile, sentenceFile, media] = await Promise.all([
			sentence.wordAudio ? exampleAudio(sentence.wordAudio) : undefined,
			sentence.sentenceAudio ? exampleAudio(sentence.sentenceAudio) : undefined,
			sentence.documentId !== undefined ? loadMedia(sentence.documentId).catch(() => null) : null
		]);
		if (!alive) return;
		wordClip = wordFile;
		if (sentenceFile) sentenceClip = { file: sentenceFile, start: 0 };
		if (sentence.source === 'anki') return;
		const timed = media && timedExample(sentence, media.cues);
		if (timed) {
			sentence = timed.sentence;
			shown = sentence;
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
			if (line) {
				english = line;
				return;
			}
		}
		const text = sentence.text;
		quick = quickTranslation(
			() => [text],
			() => english !== undefined,
			(_i, found) => {
				if (alive) english = found;
			},
			() => {}
		);
		quick.more();
		quick.focus(0, true);
	}

	function grade(value: 1 | 2 | 3 | 4) {
		audio?.stop();
		ongrade(value, shown, { sentenceShown: shown !== undefined, heard });
	}

	function setStatus(status: 'retired' | 'ignored') {
		audio?.stop();
		onstatus(status);
	}

	const GRADES = [
		{ value: 1, label: 'Again' },
		{ value: 2, label: 'Hard' },
		{ value: 3, label: 'Good' },
		{ value: 4, label: 'Easy' }
	] as const;
</script>

<section class="card" aria-label="Reading flashcard" data-lexeme={lexemeId}>
	<div class="card-face" class:revealed>
		<p class="hanzi" lang="zh-Hans">{word}</p>
		<p class="word-pinyin pinyin" aria-label="Word pronunciation">
			{wordReadings.filter(Boolean).join(' ')}
		</p>
		{#if revealed}
			<div class="answer" aria-live="polite">
				{#await lookUp(word, wordReadings)}
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
		{#if shown}
			<div class="example">
				<p class="sentence" lang="zh-Hans">
					{#each characters as ch, i (i)}{#if ch.part === 'word'}<mark>{ch.c}</mark
							>{:else}{ch.c}{/if}{/each}
				</p>
				<p class="sentence-pinyin pinyin" aria-label="Sentence pronunciation">
					{characters.map((ch) => ch.py || ch.c).join(' ')}
				</p>
				{#if revealed && english}<p class="english" lang="en">{english}</p>{/if}
			</div>
		{/if}
	</div>
	<div class="review-actions">
		<!-- On both faces (issue #7): tapped, never played by itself. -->
		<div class="audio-actions">
			<button onclick={playWord}>Hear word</button>
			<button onclick={playSentence} disabled={!sentenceClip}>Hear sentence</button>
			{#if playing}<button onclick={() => audio?.stop()}>Stop</button>{/if}
			<button class="retire" onclick={() => setStatus('retired')} disabled={busy}>Retire</button>
			<button class="ignore" onclick={() => setStatus('ignored')} disabled={busy}>Ignore</button>
		</div>
		{@render notice?.()}
		{#if audioProblem}<p class="audio-note" role="status">{audioProblem}</p>{/if}
		{#if revealed}
			<div class="grades">
				{#each GRADES as { value, label } (value)}<button
						class="grade g{value}"
						disabled={busy}
						onclick={() => grade(value)}>{label}</button
					>{/each}
			</div>
		{:else}
			<button class="reveal" onclick={() => (revealed = true)}>Show answer</button>
		{/if}
	</div>
</section>

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
	.card-face {
		overflow-wrap: anywhere;
	}
	.hanzi {
		font-family: Kaiti, 'KaiTi', 'STKaiti', 'Noto Serif CJK SC', serif;
		font-size: clamp(3rem, 15vw, 4.875rem);
		line-height: 1.3;
		margin: 0;
		letter-spacing: 0.03em;
	}
	/* The answer needs the room: the word shrinks once it is shown, so the back fits one screen. */
	.revealed .hanzi {
		font-size: 2.75rem;
	}
	.pinyin {
		font-family: 'Gentium Plus', Georgia, serif;
		color: #005500;
		line-height: 1.6;
	}
	.word-pinyin {
		font-size: 1.375rem;
		margin: 0 0 0.5rem;
		min-height: 2.2rem;
	}
	.answer {
		margin: 0 0 0.75rem;
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
		padding-top: 0.75rem;
		margin-top: 0.75rem;
	}
	.sentence {
		font-family: SimSun, 'Songti SC', 'Noto Serif CJK SC', serif;
		font-size: 1.5rem;
		line-height: 1.6;
		margin: 0 0 0.25rem;
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
		margin: 0 0 0.5rem;
	}
	.english {
		margin-top: 0.5rem;
	}
	/*
	 * Always just above the tab bar, wherever the card ends; a long card scrolls beneath it. A page
	 * without the tab bar sets --card-actions-bottom to 0rem.
	 */
	.review-actions {
		position: fixed;
		left: 0;
		right: 0;
		bottom: calc(var(--card-actions-bottom, 4.7rem) + env(safe-area-inset-bottom));
		max-width: 46rem;
		margin: 0 auto;
		background: var(--paper);
		padding: 0.8rem 1rem 0.35rem;
		z-index: 2;
	}
	.card {
		padding-bottom: 8.5rem;
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
	.audio-actions .retire {
		margin-left: auto;
	}
	.audio-actions .retire,
	.audio-actions .ignore {
		min-height: 44px;
		padding: 0.4rem 0.6rem;
		font-size: 0.8rem;
		background: transparent;
		color: var(--muted);
		border: none;
	}
	@media (prefers-color-scheme: dark) {
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
