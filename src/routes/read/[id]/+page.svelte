<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { session } from '$lib/storage/session';
	import { codePointsOf } from '$lib/domain/offsets';
	import StateMenu from '$lib/ui/StateMenu.svelte';
	import StartTermux from '$lib/ui/StartTermux.svelte';
	import ErrorNotice from '$lib/ui/ErrorNotice.svelte';
	import { describeError } from '$lib/diagnostics/describe';
	import type { StoredDocument } from '$lib/storage/repository';
	import type { LexemeId, Token, WordState } from '$lib/domain/types';
	import { activeAnalyzer, fallbackAnalyzer } from '$lib/analyzer/active';
	import { joinWithNext, splitAt } from '$lib/domain/corrections';
	import { needsImmediateRederivation, rederiveDocument, tokensFor } from '$lib/storage/rederive';
	import { upgradeOf } from '$lib/storage/upgrades';
	import { loadMedia, type StoredMedia } from '$lib/media/store';
	import MediaReader, { type LineWord } from '$lib/ui/MediaReader.svelte';
	import Progress from '$lib/ui/Progress.svelte';
	import { findVideo } from '$lib/backup/destination';
	import { followTranslation, jobOf } from '$lib/media/translation';
	import { saveMedia, removeMedia, dismissJob, QUICK_ENGLISH, SOUND_ONLY } from '$lib/media/store';
	import { audioOnly } from '$lib/media/audio-track';
	import { goto } from '$app/navigation';
	import { Recorder, type EncounterSink, type WordAt } from '$lib/ui/recorder';
	import { attention } from '$lib/ui/attention.svelte';
	import { colourBand } from '$lib/domain/memory';
	import { readingsOf } from '$lib/analyzer/pronounce';
	import type { WordMemory } from '$lib/storage/client';
	import { englishFor, llmByLine } from '$lib/translation/lines';
	import type { Cue } from '$lib/media/subtitles';
	import {
		quickTranslation,
		type QuickStatus,
		type QuickTranslation
	} from '$lib/translation/quick';

	let document = $state<StoredDocument | null>(null);
	let states = $state<Map<LexemeId, WordState>>(new Map());
	/** Each word's memory (spec 007): what it is coloured by, when it has one. */
	let memory = $state<WordMemory>({ memory: new Map() });
	/** Pinyin per character, shown above it; empty until the library has read the text. */
	let readings = $state<string[]>([]);
	$effect(() => {
		const text = document?.rawContent;
		if (text === undefined) return;
		let current = true;
		void readingsOf(text).then((found) => current && (readings = found));
		return () => (current = false);
	});

	/** The characters of [from, to) with their pinyin, line breaks left out. */
	function charsOf(from: number, to: number): { c: string; py: string }[] {
		const out: { c: string; py: string }[] = [];
		for (let i = from; i < to; i++)
			if (characters[i] !== '\n') out.push({ c: characters[i], py: readings[i] ?? '' });
		return out;
	}

	/** The moment recall is shown for: when the page last read its words. */
	let now = $state(new Date());
	let loading = $state(true);
	let problem = $state<unknown>(null);
	let chosen = $state<Token | null>(null);

	let media = $state<StoredMedia | null>(null);
	/** Derived, so marking a word (which replaces `document`) does not restart the translators. */
	const documentId = $derived(document?.id);

	/** The local LLM's English cues: kept once complete, followed from Termux until then. */
	let llmCues = $state<Cue[]>([]);
	const llmLines = $derived(media ? llmByLine(media.cues, llmCues) : []);
	/** The quick model's English, there within seconds and replaced by the LLM's (ADR-0023). */
	let quickLines = $state<(string | null)[]>([]);
	let quick = $state<QuickTranslation | undefined>();
	let quickStatus = $state<QuickStatus | undefined>();
	const english = $derived(media ? englishFor(media.cues.length, llmLines, quickLines) : []);

	$effect(() => {
		const current = media;
		const id = documentId;
		if (!current || id === undefined) return;
		llmCues = current.translation;
		const job = jobOf(current.meta);
		if (current.translation.length > 0 || !job) return;
		return followTranslation(job, (cues, done, vtt) => {
			llmCues = cues;
			if (done) void saveMedia(id, [{ name: 'media.en.vtt', blob: new Blob([vtt]) }]);
		});
	});

	$effect(() => {
		const current = media;
		const id = documentId;
		if (!current || id === undefined) return;
		quickLines = [...current.quick];
		// The LLM has every line already: nothing for the quick model to add. Its finished file can
		// still have gaps, lines it could not place, and those are the quick model's.
		if (llmByLine(current.cues, current.translation).every(Boolean)) return;

		let unsaved = 0;
		const save = () => {
			unsaved = 0;
			const blob = new Blob([JSON.stringify(quickLines)]);
			return saveMedia(id, [{ name: QUICK_ENGLISH, blob }]);
		};
		const chinese = current.cues.map((cue) => cue.text);
		// Untracked: starting it reads the lines, and this effect must not re-run (and restart the
		// translator) each time a line arrives. It did, and never translated anything.
		const translator = untrack(() =>
			quickTranslation(
				() => chinese,
				(i) => Boolean(llmLines[i]?.trim() || quickLines[i]),
				(i, text) => {
					const next = [...quickLines];
					next[i] = text;
					quickLines = next;
					if (++unsaved >= 10) void save();
				},
				(status) => (quickStatus = status)
			)
		);
		quick = translator;
		return () => {
			translator.stop();
			quick = undefined;
			if (unsaved > 0) void save();
		};
	});

	/**
	 * The video's sound alone, for listening with the screen locked: made from the video the first
	 * time it is opened, in the background, and kept beside it. Its own state, not part of `media`,
	 * so that making it restarts neither the recorder nor the translators.
	 */
	let soundFile = $state<File | undefined>();
	$effect(() => {
		const video = media?.media;
		const id = documentId;
		// Read without tracking: this effect sets soundFile, and must not re-run (and cancel
		// itself) because it did.
		const kept = untrack(() => media?.sound);
		soundFile = kept;
		if (!video || id === undefined || kept || /\.(m4a|mp3|ogg|opus|wav)$/i.test(video.name)) return;
		let current = true;
		void audioOnly(video)
			.then(async (blob) => {
				if (!blob || !current) return;
				await saveMedia(id, [{ name: SOUND_ONLY, blob }]);
				if (current) soundFile = new File([blob], SOUND_ONLY, { type: 'audio/mp4' });
			})
			.catch(() => {
				// No sound track mp4box can read: the video pauses when the screen locks, as before.
			});
		return () => (current = false);
	});

	let deleteProblem = $state<string | null>(null);

	/**
	 * The video file goes; the text stays, hidden, when marks or reading history point into it
	 * (Repository.removeDocument), so that history keeps its context.
	 */
	async function deleteDocument() {
		if (!document || !confirm(`Delete “${document.title}”? Your marks and history in it are kept.`))
			return;
		deleteProblem = null;
		deleting = true;
		try {
			const { repository } = await session();
			await recorder?.close();
			await repository.removeDocument(document.id);
			// Its Termux download stays in Termux; without this it would be offered as new again.
			const job = media && jobOf(media.meta);
			if (job) await dismissJob(job);
			await removeMedia(document.id);
			await goto(resolve('/'));
		} catch (error) {
			deleteProblem = error instanceof Error ? error.message : String(error);
		}
	}

	/** Where to start playing, when arriving from a transcript that just finished. */
	const startAt = Number(page.url.searchParams.get('t') ?? 0);

	/** Line i of a media document is cue i, so tokens are grouped by the line they start on. */
	const lines = $derived.by(() => {
		if (!media || !document) return [];
		const grouped: LineWord[][] = [[]];
		let line = 0;
		let offset = 0;
		for (const token of document.tokens) {
			while (offset < token.start) if (characters[offset++] === '\n') grouped[++line] = [];
			grouped[line].push({
				key: token.start,
				text: textOf(token).replace(/\n/g, ''),
				chars: charsOf(token.start, token.end),
				isWord: token.isWord,
				mark: markOf(token)
			});
		}
		return grouped;
	});

	function chooseWord(_line: number, word: LineWord) {
		open(document?.tokens.find((token) => token.start === word.key) ?? null);
	}

	/** A word's sheet opens and shows its meaning: recorded when it closes (recorder.ts). */
	function open(token: Token | null) {
		chosen = token;
		if (!token || token.lexemeId === undefined) return;
		const word: WordAt = { lexemeId: token.lexemeId, fromOffset: token.start, toOffset: token.end };
		const moment = player
			? {
					mediaMs: Math.round(player.currentTime * 1000),
					speed: player.playbackRate,
					textVisible: true
				}
			: undefined;
		recorder?.opened(word, moment);
	}

	// --- Encounters (spec 007) ---

	let recorder = $state<Recorder | undefined>();
	let player = $state<HTMLMediaElement | null>(null);
	/** Set when the document is deleted: then there is nothing to ask about. */
	let deleting = false;

	const sink: EncounterSink = {
		startSession: async (id, modality) => (await session()).repository.startSession(id, modality),
		recordEncounters: async (id, encounters) =>
			(await session()).repository.recordEncounters(id, encounters)
	};

	/** One recorder per opened document; replacing `document` after a mark does not restart it. */
	$effect(() => {
		const id = documentId;
		const playable = Boolean(media?.media);
		if (id === undefined || loading) return;
		const made = untrack(
			() => new Recorder(sink, id, playable ? 'media' : 'reading', lineRanges())
		);
		recorder = made;
		deleting = false;
		return () => {
			if (!deleting) attention.ended(made);
			void made.close();
		};
	});

	/** Line i's code-point range: media lines are the raw content's lines, one per cue. */
	function lineRanges(): [number, number][] {
		const ranges: [number, number][] = [];
		let start = 0;
		for (let i = 0; i <= characters.length; i++) {
			if (i === characters.length || characters[i] === '\n') {
				ranges.push([start, i]);
				start = i + 1;
			}
		}
		return ranges;
	}

	/** In a text, what stays on screen for two seconds counts as read (research R3). */
	let settling: ReturnType<typeof setTimeout> | undefined;
	function noteScroll() {
		clearTimeout(settling);
		settling = setTimeout(noteOnScreen, 2000);
	}

	function noteOnScreen() {
		if (media?.media || !recorder || globalThis.document.visibilityState !== 'visible') return;
		const tokens = [...globalThis.document.querySelectorAll<HTMLElement>('.reading [data-start]')];
		const shown = tokens.filter((element) => {
			const box = element.getBoundingClientRect();
			return box.bottom > 0 && box.top < window.innerHeight;
		});
		if (shown.length === 0) return;
		recorder.read(Number(shown[0].dataset.start), Number(shown.at(-1)!.dataset.end));
	}

	$effect(() => {
		if (recorder && !media?.media) untrack(() => noteScroll());
	});

	/** True while a stale document is being brought up to date, which the reader waits for. */
	let resegmenting = $state(false);

	/**
	 * A batch landed while the reader had the word menu open, and the words have not been re-read.
	 *
	 * Held rather than applied, because replacing the tokens under an open menu would move or
	 * remove the word it is about. It is applied the moment the menu closes.
	 */
	let refreshWhenFree = $state(false);

	/**
	 * The document's characters, converted once.
	 *
	 * Every token slices this array rather than the string. Slicing a string by code point walks
	 * it from the start each time, so doing it per token would be quadratic — invisible at three
	 * characters and very visible at five thousand, which is the size this slice accepts.
	 */
	const characters = $derived(document ? codePointsOf(document.rawContent) : []);

	$effect(() => {
		void load(Number(page.params.id));
	});

	/**
	 * Show the improvement as it arrives (ADR-0016).
	 *
	 * The sweep upgrades a document a batch at a time, and a document being read is exactly the one
	 * worth improving first. Without this the reader would have to close and reopen it to see any of
	 * it, which is what made the upgrade invisible in practice (research.md R20).
	 */
	let shownThrough = -1;

	$effect(() => {
		const advanced = upgradeOf(Number(page.params.id));
		if (!advanced) return;

		// `untrack`, and not decoration: everything below reads state that `showLatestWords` then
		// writes — `document` above all — so without it this effect would retrigger itself for as
		// long as the reader stayed on the page. The only dependency it is meant to have is the
		// progress reported by the sweep.
		untrack(() => {
			if (advanced.through === shownThrough || !document || loading) return;
			shownThrough = advanced.through;
			void showLatestWords();
		});
	});

	async function load(id: number) {
		loading = true;
		problem = null;
		try {
			const { repository } = await session();
			const loaded = await repository.getDocument(id);
			document = await bringUpToDate(repository, loaded);
			states = await repository.getStates(lexemesIn(document));
			await readMemory(lexemesIn(document));
			media = await loadMedia(id);
			if (media && !media.media && (await findVideo(id))) media = await loadMedia(id);
		} catch (error) {
			problem = error;
			await record(error);
		} finally {
			loading = false;
		}
	}

	/**
	 * Re-derive a document whose stored tokens are too poor to show, before it is shown (FR-015).
	 *
	 * The reader never sees placeholder tokens in something they opened — that guarantee is
	 * unchanged. What changed in slice 2 is that being *out of date* no longer implies being too
	 * poor to show: documents are imported with the fast fallback and upgraded by the background
	 * sweep, so a document showing real dictionary words is shown at once and improved later. See
	 * `needsImmediateRederivation`, and research.md R18 for why paying on open is not an option.
	 *
	 * Note the fallback below: a copy that does not hold storage still segments the text and
	 * displays real words, it just cannot write them down. Refusing to show the document, or
	 * showing it with character-per-token segmentation, would both be worse than showing correct
	 * words and leaving the stamp stale for a copy that can write to fix (FR-019).
	 */
	async function bringUpToDate(
		repository: Awaited<ReturnType<typeof session>>['repository'],
		loaded: StoredDocument
	): Promise<StoredDocument> {
		const analyzer = await activeAnalyzer();
		// Out of date is now the ordinary condition of a document, not a fault: import stamps with
		// the fast fallback and the sweep upgrades afterwards. So the question here is no longer
		// "is this stale" but "are these tokens too poor to show" — paying four seconds per
		// thousand characters to improve words that are already real is not a trade the reader
		// would choose, and paying it on open is what failed SC-004 (research.md R18).
		if (!needsImmediateRederivation(loaded, analyzer)) return loaded;

		// **Repaired with the fallback, not with the analyzer in force.**
		//
		// The obligation is to show real words rather than placeholder ones (FR-015), and the
		// dictionary discharges it in 26 ms where the model takes 27 s. Using the active analyzer
		// here would leave one path that still blocks for half a minute — the one reached by a
		// document written by slice 0's per-character dummy — and there is no reason for the
		// reader to wait for the best possible words when what they need is any real ones.
		//
		// The document is therefore restamped with the fallback and is still out of date under the
		// model, which is exactly the state a freshly imported document is in. The sweep upgrades
		// both by the same path. After this line, **no path on opening a document runs the model.**
		const repairWith = fallbackAnalyzer;

		resegmenting = true;
		try {
			const stored = await rederiveDocument(repository, loaded, repairWith);
			if (stored) {
				return await repository.getDocument(loaded.id);
			}
			return loaded;
		} catch {
			// Could not persist — almost always because another copy holds storage. Show the right
			// words anyway; the document stays stale and the sweep will catch it later.
			//
			// These tokens carry no `lexemeId`, because a lexeme is assigned when tokens are stored
			// and nothing was stored. The words are therefore readable and not markable, which is
			// the honest outcome: a copy that cannot write a token cannot write a judgment either,
			// and slice 1 already tells the reader why through the read-only notice.
			const tokens = await tokensFor(loaded, repairWith);
			return {
				...loaded,
				tokens: tokens.map(({ start, end, isWord }) => ({ start, end, isWord }))
			};
		} finally {
			resegmenting = false;
		}
	}

	/**
	 * Re-read the tokens of the document already on screen.
	 *
	 * Not `load`: nothing here is allowed to blank the page the reader is reading. The document is
	 * replaced in place, marks are re-read for the words that now exist, and the reader's scroll
	 * position is left alone.
	 */
	async function showLatestWords() {
		if (!document) return;
		if (chosen) {
			refreshWhenFree = true;
			return;
		}

		try {
			const { repository } = await session();
			const fresh = await repository.getDocument(document.id);
			// Read everything first and show it at once: set one by one, each redrew every word, three
			// times per correction, which was most of a join's second on a long transcript (laptop).
			const words = [...new Set(lexemesIn(fresh))];
			const [freshStates, freshMemory] = await Promise.all([
				repository.getStates(words),
				repository.getMemory(words)
			]);
			document = fresh;
			states = freshStates;
			memory = freshMemory;
			now = new Date();
			refreshWhenFree = false;
		} catch {
			// The words on screen are still correct words, just not the newest ones, and the next
			// batch will bring another chance. Nothing here is worth interrupting reading for.
		}
	}

	/** The reader has finished with the menu, so a refresh that was waiting for them can happen. */
	function menuClosed() {
		recorder?.closed();
		void afterSheet();
		chosen = null;
		if (refreshWhenFree) void showLatestWords();
	}

	function lexemesIn(loaded: StoredDocument): LexemeId[] {
		return loaded.tokens
			.map((token) => token.lexemeId)
			.filter((id): id is LexemeId => id !== undefined);
	}

	async function choose(state: string) {
		const token = chosen;
		if (token?.lexemeId === undefined || !document) return;
		recorder?.closed({ chose: state, knew: state === 'known' ? 'known' : undefined });
		chosen = null;
		try {
			const { repository } = await session();
			// The occurrence is recorded alongside the judgment: which document, and where in it.
			// Unused in this slice, and irrecoverable if not written at the time — same-reading
			// homographs are told apart by context and by nothing else.
			await repository.assertState(token.lexemeId, state, {
				documentId: document.id,
				fromOffset: token.start,
				toOffset: token.end
			});
			await recorder?.flush();
			states = await repository.getStates(lexemesIn(document));
			await readMemory(lexemesIn(document));
		} catch (error) {
			problem = error;
			await record(error);
		}
	}

	/** The chosen word joined with the next, or why it cannot be (spec 004, FR-003). */
	const joining = $derived.by(() => {
		if (!chosen || !document) return undefined;
		const start = chosen.start;
		const index = document.tokens.findIndex((token) => token.start === start);
		return joinWithNext(characters, document.tokens, index);
	});

	/**
	 * Record how the reader says a form divides, and show it (spec 004). Applied to every document
	 * at once by the repository; this one is re-read in place, like a batch of the upgrade.
	 */
	async function correct(
		change: ReturnType<typeof joinWithNext>,
		occurrence: { fromOffset: number; toOffset: number }
	) {
		if (!document || 'refused' in change) return;
		recorder?.closed();
		chosen = null;
		try {
			const { repository } = await session();
			await repository.correct(
				document.language,
				change.form,
				change.parts.map((surface) => ({ surface, key: fallbackAnalyzer.lexemeKey(surface) })),
				{ documentId: document.id, ...occurrence }
			);
			await showLatestWords();
		} catch (error) {
			problem = error;
			await record(error);
		}
	}

	/** Failures go to the on-device record as well as to the screen (FR-021). */
	async function record(error: unknown) {
		try {
			const { repository } = await session();
			await repository.recordDiagnostic('storage', describeError(error));
		} catch {
			// The database is the thing that failed. Nothing further to try.
		}
	}

	/** How much of the document the upgrade has reached, for the subtitle. */
	function percentUpgraded(loaded: StoredDocument): number {
		if (!loaded.upgrade) return 100;
		return Math.round((loaded.upgrade.through / characters.length) * 100);
	}

	/** The subtitle line, or the sentence, the token sits in: what gets sent to be translated. */
	function sentenceAround(token: Token): string {
		const ends = media ? /\n/ : /[\n。！？!?]/;
		let from = token.start;
		while (from > 0 && !ends.test(characters[from - 1])) from--;
		let to = token.end;
		while (to < characters.length && !ends.test(characters[to - 1] ?? '')) to++;
		return characters.slice(from, to).join('').trim();
	}

	function textOf(token: Token): string {
		return characters.slice(token.start, token.end).join('');
	}

	async function readMemory(lexemes: LexemeId[]) {
		const { repository } = await session();
		memory = await repository.getMemory(lexemes);
		now = new Date();
	}

	/**
	 * A word's colour: its recall band where it has a memory (FR-016), its hand mark otherwise.
	 * Computed as the page is drawn, since recall changes with the clock rather than with events.
	 */
	function markOf(token: Token): string {
		const reading =
			token.lexemeId === undefined ? undefined : memory.memory.get(token.lexemeId)?.reading;
		if (reading) return `recall-${colourBand(reading, now, memory.parameters)}`;
		return `state-${stateOf(token) ?? 'none'}`;
	}

	/** The sheet closed on a lookup or a check: write it now, so the word's colour follows at once. */
	async function afterSheet() {
		if (!recorder || !document) return;
		await recorder.flush();
		await readMemory(lexemesIn(document));
	}

	/** The state name, or null where the reader has never judged this word (FR-006b). */
	function stateOf(token: Token): string | null {
		if (token.lexemeId === undefined) return null;
		return states.get(token.lexemeId)?.state ?? null;
	}
</script>

<svelte:window onscroll={noteScroll} />

<!-- No whitespace inside: this is Chinese, and any gap in the markup would show between characters. -->
{#snippet rubied(token: Token)}{#each charsOf(token.start, token.end) as ch, i (i)}{#if ch.py}<ruby
				>{ch.c}<rt>{ch.py}</rt></ruby
			>{:else}{ch.c}{/if}{/each}{/snippet}

{#if media}
	<a class="back" href={resolve('/')}>← Videos</a>
{:else}
	<a class="back" href={resolve('/texts')}>← Texts</a>
{/if}

{#if loading}
	<p class="loading">{resegmenting ? 'Finding the words…' : 'Opening…'}</p>
{:else if problem}
	<ErrorNotice error={problem} onretry={() => load(Number(page.params.id))} />
{:else if document}
	<h1 class:compact={media}>{document.title}</h1>
	<!-- The version is a fingerprint of the analyzer's own behaviour, not a number anyone chose
	     (ADR-0011), so it reads as opaque and is meant to. It is shown because it is the only way
	     to tell whether this device's ICU segments like the one the comparison was run on. -->
	<p class="subtitle" hidden={!!media}>
		Segmented by {document.analyzer} · {document.analyzerVersion}{#if document.upgrade}<br />
			<!-- Two stamps, because a document mid-upgrade genuinely has two: the words before the
			     boundary came from one analyzer and the words after it from another (ADR-0016). A
			     single stamp here would be describing part of the page and claiming all of it. -->
			Upgrading to {document.upgrade.analyzer} — {percentUpgraded(document)}% done{/if}
	</p>

	<!-- No whitespace between tokens: this is Chinese, and the browser would render any gap the
	     markup contains. The awkward tag placement is load-bearing, not a formatting accident. -->
	{#if media && !media.media}
		<!-- Restored from a copy, which keeps a video's place but not the video (ADR-0020). -->
		<div class="notice">
			<p>
				This video isn't on this device yet, and Termux did not have it just now. Start Termux, then
				reopen this page to try again; the text and your marks work without it.
			</p>
			<StartTermux />
		</div>
	{/if}
	{#if media?.media}
		<MediaReader
			file={media.media}
			cues={media.cues}
			{lines}
			language={document.language}
			{startAt}
			translations={english}
			askable={quick !== undefined}
			onask={(line) => quick?.focus(line, true)}
			online={(line) => quick?.focus(line)}
			onword={chooseWord}
			{recorder}
			title={document.title}
			artist={typeof media.meta.uploader === 'string' ? media.meta.uploader : undefined}
			{soundFile}
			bind:player
		>
			{#snippet status()}
				{#if quickStatus}<Progress {...quickStatus} />{/if}
			{/snippet}
		</MediaReader>
	{:else}
		<div class="reading" lang={document.language}>
			{#each document.tokens as token (token.start)}{#if token.isWord}<button
						class="token {markOf(token)}"
						data-start={token.start}
						data-end={token.end}
						onclick={() => open(token)}>{@render rubied(token)}</button
					>{:else}<span class="token">{textOf(token)}</span>{/if}{/each}
		</div>
	{/if}

	{#if chosen}
		<StateMenu
			word={textOf(chosen)}
			sentence={sentenceAround(chosen)}
			current={stateOf(chosen)}
			provenance={chosen.lexemeId === undefined
				? undefined
				: states.get(chosen.lexemeId)?.provenance}
			memory={chosen.lexemeId === undefined ? undefined : memory.memory.get(chosen.lexemeId)}
			parameters={memory.parameters}
			onchoose={choose}
			readings={readings.slice(chosen.start, chosen.end)}
			joinRefused={joining && 'refused' in joining ? joining.refused : undefined}
			onjoin={chosen.lexemeId === undefined || !joining
				? undefined
				: () => {
						const token = chosen!;
						const next = document!.tokens.find((t) => t.start === token.end);
						void correct(joining, { fromOffset: token.start, toOffset: next?.end ?? token.end });
					}}
			onsplit={chosen.lexemeId === undefined || chosen.end - chosen.start < 2
				? undefined
				: (at) => {
						const token = chosen!;
						void correct(splitAt(textOf(token), at), {
							fromOffset: token.start,
							toOffset: token.end
						});
					}}
			onknew={() => {
				recorder?.closed({ knew: 'knew' });
				menuClosed();
			}}
			onclose={menuClosed}
		/>
	{/if}

	<p class="delete">
		<button onclick={deleteDocument}>Delete this document</button>
		{#if deleteProblem}<span role="alert">{deleteProblem}</span>{/if}
	</p>
{/if}

<style>
	.delete {
		margin-top: 3rem;
		font-size: 0.85rem;
	}
	.delete button {
		color: var(--muted);
	}
	h1.compact {
		font-size: 1rem;
		margin: 0.25rem 0;
	}
</style>
