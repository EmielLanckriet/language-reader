<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { session } from '$lib/storage/session';
	import { codePointsOf } from '$lib/domain/offsets';
	import { lineRangesOf } from '$lib/domain/helped';
	import StateMenu from '$lib/ui/StateMenu.svelte';
	import StartTermux from '$lib/ui/StartTermux.svelte';
	import ErrorNotice from '$lib/ui/ErrorNotice.svelte';
	import ReportDialog from '$lib/ui/ReportDialog.svelte';
	import { describeError } from '$lib/diagnostics/describe';
	import type { StoredDocument } from '$lib/storage/repository';
	import type { LexemeId, Token, WordState } from '$lib/domain/types';
	import { activeAnalyzer, fallbackAnalyzer } from '$lib/analyzer/active';
	import { joinWithNext, splitAt } from '$lib/domain/corrections';
	import { needsImmediateRederivation, rederiveDocument, tokensFor } from '$lib/storage/rederive';
	import { upgradeOf } from '$lib/storage/upgrades';
	import {
		loadMedia,
		ENGLISH_SETTING,
		type EnglishSetting,
		type MediaFile,
		type StoredMedia
	} from '$lib/media/store';
	import { resumeOf } from '$lib/media/cover';
	import MediaReader, { type LineWord } from '$lib/ui/MediaReader.svelte';
	import { lazyLines, lineFirsts, type Lines } from '$lib/ui/lazy-lines';
	import Progress from '$lib/ui/Progress.svelte';
	import DocumentSettings from '$lib/ui/DocumentSettings.svelte';
	import { findVideo } from '$lib/backup/destination';
	import { takeVideo, waitingForVideo } from '$lib/media/redownload';
	import {
		followTranslation,
		humanLines as humanOf,
		jobOf,
		recutCurrent,
		trackLines
	} from '$lib/media/translation';
	import {
		saveMedia,
		writeMediaJson,
		QUICK_ENGLISH,
		RECUT_ENGLISH,
		SOUND_ONLY,
		type RecutEnglish
	} from '$lib/media/store';
	import { recutEnglish } from '$lib/analyzer/lookup';
	import { RECUT_VERSION } from '$lib/translation/recut';
	import { audioOnly } from '$lib/media/audio-track';
	import { beforeNavigate, goto } from '$app/navigation';
	import SessionQuestions from '$lib/ui/SessionQuestions.svelte';
	import {
		HARDCORE_STEPS,
		type AttentionAnswer,
		type Engagement,
		type Encounter,
		type HardcoreStep,
		type TapReason
	} from '$lib/domain/encounter';
	import type { Status } from '$lib/domain/status';
	import { FEEDBACK_AFTER_MS } from '$lib/domain/study';
	import { Recorder, type EncounterSink, type WordAt } from '$lib/ui/recorder';
	import { colourBand } from '$lib/domain/memory';
	import { readingsOf } from '$lib/analyzer/pronounce';
	import type { WordMemory } from '$lib/storage/client';
	import { englishFor, llmByLine } from '$lib/translation/lines';
	import {
		LAYOUT,
		PLAIN,
		cutChinese,
		englishOfSpans,
		englishShown,
		frozen,
		joinChinese,
		joinEnglish,
		placedOf,
		shiftEnglish,
		shiftOf,
		shiftTime,
		shownOf,
		spansOf,
		splitEnglish,
		timedCues,
		type Layout,
		type Pos,
		type Span
	} from '$lib/media/layout';
	import LineEditor from '$lib/ui/LineEditor.svelte';
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
	/** A person's English from a downloaded track the reader chose (spec 012): shown first. */
	const humanLines = $derived(media ? humanOf(media) : []);
	/** Set when the reader switches to machine English after a human track: Termux translates the
	 lines it had left, and the page follows that even though some English is already kept. */
	let refollow = $state(false);
	/** The reader chose no English for this video: nothing shown, nothing translated. */
	const noEnglish = $derived(media?.english.source === 'none');
	/**
	 * The reader chose a person's English track: only its lines are shown. A line its maker left
	 * untranslated stays so (the reader trusts their judgement), so no translator runs.
	 */
	const humanChosen = $derived(
		media?.english.source === 'track' || media?.english.source === 'edited'
	);
	const english = $derived(
		!media || noEnglish
			? []
			: humanChosen
				? englishFor(media.cues.length, [], [], humanLines)
				: englishFor(media.cues.length, llmLines, quickLines)
	);

	// The chosen track's English re-cut over the lines, once per track: shown as matched by time
	// until it is ready (translation/recut.ts).
	$effect(() => {
		const current = media;
		const id = documentId;
		if (!current || id === undefined || current.english.source !== 'track') return;
		if (recutCurrent(current)) return;
		const pieces = trackLines(current);
		if (!pieces) return;
		const track = current.english.file;
		let stale = false;
		recutEnglish(
			pieces,
			current.cues.map((cue) => cue.text)
		)
			.then(async (lines) => {
				const recut: RecutEnglish = {
					track,
					version: RECUT_VERSION,
					lines: lines.map((line) => line ?? null)
				};
				await writeMediaJson(id, RECUT_ENGLISH, recut);
				if (stale || documentId !== id || !media) return;
				if (media.english.source === 'track' && media.english.file === track)
					media = { ...media, recut };
			})
			.catch((error) => console.warn('re-cutting the English failed', error));
		return () => {
			stale = true;
		};
	});

	$effect(() => {
		const current = media;
		const id = documentId;
		if (!current || id === undefined) return;
		llmCues = current.translation;
		const job = jobOf(current.meta);
		const partial = untrack(() => refollow);
		if (
			(current.translation.length > 0 && !partial) ||
			!job ||
			untrack(() => noEnglish || humanChosen)
		)
			return;
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
		if (untrack(() => noEnglish || humanChosen)) return;

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
	let soundFile = $state<MediaFile | undefined>();
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

	/**
	 * Where to start playing, in seconds: `?t=` when given (a transcript that just finished, or the
	 * document page's Start from the beginning), otherwise where playback last stopped.
	 */
	let startAt = $state(0);

	/** Where each line's tokens start: line i of a media document is cue i. */
	const firsts = $derived.by(() =>
		media && document ? lineFirsts(document.tokens, characters) : [0]
	);
	/**
	 * Each line's words, built when shown (#33). Reading the pinyin, the states and the memory here
	 * starts a fresh set when any of them changes, so a shown line is rebuilt with it.
	 */
	const lines = $derived.by((): Lines<LineWord[]> => {
		void readings;
		void states;
		void memory;
		void now;
		const tokens = document?.tokens ?? [];
		const bounds = firsts;
		return lazyLines(bounds.length - 1, (i) =>
			tokens.slice(bounds[i], bounds[i + 1]).map((token) => ({
				key: token.start,
				text: textOf(token).replace(/\n/g, ''),
				chars: charsOf(token.start, token.end),
				isWord: token.isWord,
				mark: markOf(token)
			}))
		);
	});

	/**
	 * The document's characters, converted once.
	 *
	 * Every token slices this array rather than the string. Slicing a string by code point walks
	 * it from the start each time, so doing it per token would be quadratic — invisible at three
	 * characters and very visible at five thousand, which is the size this slice accepts.
	 */
	const characters = $derived(document ? codePointsOf(document.rawContent) : []);

	/**
	 * What the player shows: the document's lines as the reader cut, joined and timed them, and the
	 * English they placed on them by hand when they chose it (media/layout.ts, ADR-0050). The
	 * document's own lines stay as they are underneath: the recorder and the quick model count in them.
	 */
	let layout = $state<Layout>(PLAIN);
	/** Taken from `media` once per document, as it opens (load), not whenever `media` is replaced. */
	function openLayout(kept: Layout) {
		layout = kept;
		editing = null;
		undo = [];
	}
	const shown = $derived(media ? shownOf(media.cues, layout) : []);
	const lineStarts = $derived(lineRangesOf(characters).map(([from]) => from));
	/** Where `pos` is in the document's text. */
	function offsetOf(pos: Pos): number {
		return pos.line >= lineStarts.length ? characters.length : lineStarts[pos.line] + pos.at;
	}
	function posOf(offset: number): Pos {
		let line = 0;
		while (line + 1 < lineStarts.length && lineStarts[line + 1] <= offset) line++;
		return { line, at: offset - lineStarts[line] };
	}
	const shownCues = $derived(
		shown.map((line): Cue => ({
			start: line.start,
			end: line.end,
			text: characters
				.slice(offsetOf(line.from), offsetOf(line.to))
				.filter((c) => c !== '\n')
				.join('')
		}))
	);
	const ownCues = $derived(media ? timedCues(media.cues, layout, shown) : []);
	const shownLines = $derived.by(() => {
		const source = lines;
		const parts = shown;
		return lazyLines(parts.length, (s) => {
			const { from, to } = parts[s];
			const [lo, hi] = [offsetOf(from), offsetOf(to)];
			const words: LineWord[] = [];
			for (let line = from.line; line <= Math.min(to.line, source.length - 1); line++)
				for (const word of source.at(line) ?? [])
					if (word.key >= lo && word.key < hi) words.push(word);
			return words;
		});
	});
	const editedChosen = $derived(media?.english.source === 'edited' && Boolean(layout.english));
	const shownEnglish = $derived(
		editedChosen
			? englishOfSpans(spansOf(layout.english ?? [], shown), shown.length)
			: englishShown(shown, english)
	);
	const firstLineOf = (s: number) => shown[s]?.from.line ?? s;

	// --- Editing the lines by hand: a long press on a line opens it (LineEditor) ---

	let editing = $state<number | null>(null);
	/** This visit's changes, to take back one at a time. */
	let undo = $state<{ layout: Layout; english: EnglishSetting }[]>([]);

	async function keepLayout(next: Layout, english?: EnglishSetting) {
		const id = documentId;
		const current = media;
		if (id === undefined || !current) return;
		undo = [...undo, { layout, english: current.english }];
		layout = next;
		await writeMediaJson(id, LAYOUT, next);
		if (english && english.source !== current.english.source) await chooseEnglish(id, english);
	}

	async function chooseEnglish(id: number, english: EnglishSetting) {
		await saveMedia(id, [{ name: ENGLISH_SETTING, blob: new Blob([JSON.stringify(english)]) }]);
		// The layout too, so the English menu (DocumentSettings) offers what was just placed.
		if (media && documentId === id) media = { ...media, english, layout };
	}

	async function takeBack() {
		const id = documentId;
		const last = undo.at(-1);
		if (id === undefined || !last || !media) return;
		undo = undo.slice(0, -1);
		layout = last.layout;
		await writeMediaJson(id, LAYOUT, last.layout);
		if (JSON.stringify(last.english) !== JSON.stringify(media.english))
			await chooseEnglish(id, last.english);
		if (editing !== null) editing = Math.min(editing, shown.length - 1);
	}

	/** The English as spans to change: the hand-placed English, or what is shown now to start it. */
	function spansToEdit(): Span[] | undefined {
		if (editedChosen) return spansOf(layout.english ?? [], shown);
		if (
			layout.english &&
			!confirm('Start over from the English shown now? The English you placed by hand before goes.')
		)
			return undefined;
		return frozen(shownEnglish);
	}

	function editEnglish(change: (spans: Span[]) => Span[]) {
		const spans = spansToEdit();
		if (!spans) return;
		void keepLayout({ ...layout, english: placedOf(change(spans), shown) }, { source: 'edited' });
	}

	const edits = {
		joinChinese(s: number, way: -1 | 1) {
			void keepLayout(joinChinese(layout, shown, s, way));
			if (way === -1) editing = s - 1;
		},
		cutChinese(offset: number) {
			void keepLayout(cutChinese(layout, posOf(offset)));
		},
		shiftTime(s: number, ms: number, all: boolean) {
			void keepLayout(shiftTime(layout, shown, s, ms, all));
		},
		joinEnglish(s: number, way: -1 | 1) {
			editEnglish((spans) => joinEnglish(spans, s, way, shown.length));
		},
		splitEnglish(s: number, word: number) {
			editEnglish((spans) => splitEnglish(spans, s, word, shown.length));
		},
		shiftEnglish(s: number, by: -1 | 1, onward: boolean) {
			editEnglish((spans) => shiftEnglish(spans, s, by, onward, shown.length));
		}
	};

	function playLine(s: number) {
		const line = shown[s];
		if (!player || !line) return;
		player.currentTime = line.start;
		void player.play();
	}

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
	let finishing = $state(false);
	let finishProblem = $state<unknown>(null);
	async function finishSession() {
		if (!recorder || finishing) return;
		finishing = true;
		finishProblem = null;
		player?.pause();
		try {
			// The same as leaving (asked for 2026-10-18): the questions after real reading or playing,
			// then the library, where the document is listed.
			const home = media?.media ? resolve('/') : resolve('/texts');
			if (recorder.engagedMs() >= FEEDBACK_AFTER_MS) {
				await askBeforeLeaving(() => goto(home));
				return;
			}
			await recorder.finish();
			leavingQuietly = true;
			await goto(home);
		} catch (error) {
			finishProblem = error;
		} finally {
			finishing = false;
		}
	}

	/**
	 * Leaving without Finish session asks the session's questions here, since the reader forgets them
	 * otherwise (asked for 2026-10-04). Only after some real reading or playing, and only for leaving
	 * within the app: closing the app cannot wait for a sheet, and More → Sessions still asks later.
	 */
	let leaving = $state<{
		session: number;
		modality: string;
		engagement: Engagement | null;
		answered: boolean;
		answer: AttentionAnswer;
		go: () => unknown;
	} | null>(null);
	let leavingQuietly = false;
	let answering = $state(false);
	let leaveProblem = $state<unknown>(null);
	beforeNavigate((navigation) => {
		if (leavingQuietly || finishing || leaving || !recorder) return;
		if (navigation.willUnload || !navigation.to) return;
		if (recorder.engagedMs() < FEEDBACK_AFTER_MS) return;
		navigation.cancel();
		const target = navigation.to.url.href;
		const delta = navigation.type === 'popstate' ? navigation.delta : undefined;
		// The URL SvelteKit was already going to, base path included: resolve() would add it twice.
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		void askBeforeLeaving(() => (delta ? history.go(delta) : goto(target)));
	});
	async function askBeforeLeaving(go: () => unknown) {
		if (!recorder) return;
		const modality = media?.media ? 'media' : 'reading';
		player?.pause();
		leavingQuietly = true;
		try {
			const id = await recorder.finish();
			leaving = { session: id, modality, engagement: null, answered: false, answer: null, go };
		} catch {
			// Not saved yet: leave as before; the recorder's stash and More → Sessions keep the session.
			go();
		} finally {
			leavingQuietly = false;
		}
	}
	async function saveLeaving(encounter: Omit<Encounter, 'at'>) {
		if (!leaving || answering) return;
		answering = true;
		leaveProblem = null;
		try {
			await (
				await session()
			).repository.recordEncounters(leaving.session, [
				{ ...encounter, at: new Date().toISOString() }
			]);
			if (encounter.kind === 'engagement')
				leaving.engagement = encounter.detail as unknown as Engagement;
			else {
				leaving.answered = true;
				leaving.answer = (encounter.detail as { answer: AttentionAnswer }).answer;
			}
		} catch (error) {
			leaveProblem = error;
		} finally {
			answering = false;
		}
	}
	function leave() {
		const go = leaving?.go;
		leavingQuietly = true;
		leaving = null;
		go?.();
	}

	const sink: EncounterSink = {
		startSession: async (id, modality) => (await session()).repository.startSession(id, modality),
		recordEncounters: async (id, encounters) =>
			(await session()).repository.recordEncounters(id, encounters)
	};

	/**
	 * Opened from a hardcore step (spec 014): play or show only the part, then go `back`. `back` is
	 * only ever a path inside the app, so a crafted link cannot lead away from it.
	 */
	const hardcore = $derived.by(() => {
		const params = page.url.searchParams;
		const back = params.get('back');
		const step = params.get('step')?.split('.');
		const number = (name: string) => {
			const value = params.get(name);
			return value === null || !Number.isFinite(Number(value)) ? undefined : Number(value);
		};
		return {
			back: back?.startsWith('/') && !back.startsWith('//') ? back : undefined,
			until: number('until'),
			from: number('from'),
			to: number('to'),
			englishShown: params.get('english') === 'shown',
			link:
				step?.length === 3 && HARDCORE_STEPS.includes(step[2] as HardcoreStep)
					? { session: Number(step[0]), part: Number(step[1]), step: step[2] as HardcoreStep }
					: undefined
		};
	});
	/** A text part's range in code points, when only a part is shown. */
	const shownRange = $derived.by(() => {
		const { from, to } = hardcore;
		if (from === undefined || to === undefined) return undefined;
		const ranges = lineRangesOf(characters);
		return ranges[from] && ranges[to] ? [ranges[from][0], ranges[to][1]] : undefined;
	});

	/** One recorder per opened document; replacing `document` after a mark does not restart it. */
	$effect(() => {
		const id = documentId;
		const playable = Boolean(media?.media);
		if (id === undefined || loading) return;
		const made = untrack(() => {
			const made = new Recorder(sink, id, playable ? 'media' : 'reading', lineRanges());
			if (hardcore.link) made.linkHardcore(hardcore.link);
			return made;
		});
		recorder = made;
		return () => {
			void made.close();
		};
	});

	/** Line i's code-point range, the same as the evidence rule uses for a reveal (helped.ts). */
	function lineRanges(): [number, number][] {
		return lineRangesOf(characters);
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
			let found = await loadMedia(id);
			// No video, or only its sound in its place (loadMedia): Termux may still have the bundle.
			if (found && (!found.media || found.media === found.sound) && (await findVideo(id)))
				found = await loadMedia(id);
			// A video asked for again (the document page) that Termux finished while the reader was away.
			if (found && waitingForVideo(found.meta) && (await takeVideo(id).catch(() => false)))
				found = await loadMedia(id);
			// Known before the player mounts: it seeks once, when the video's metadata loads.
			const asked = page.url.searchParams.get('t');
			startAt =
				asked !== null
					? Number(asked)
					: found?.media
						? await resumeOf(id, found.cues).catch(() => 0)
						: 0;
			// In the same step: the English choice can say "edited" only with the lines it was placed on.
			if (found) openLayout(found.layout);
			media = found;
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
	function menuClosed(reason?: TapReason) {
		recorder?.closed({ reason });
		void afterSheet();
		chosen = null;
		if (refreshWhenFree) void showLatestWords();
	}

	function lexemesIn(loaded: StoredDocument): LexemeId[] {
		return loaded.tokens
			.map((token) => token.lexemeId)
			.filter((id): id is LexemeId => id !== undefined);
	}

	/** A status was set in the sheet (StatusButtons saved it): the tap is recorded with it. */
	async function choose(status: Status, reason?: TapReason) {
		const token = chosen;
		if (token?.lexemeId === undefined || !document) return;
		recorder?.closed({ chose: status, reason });
		chosen = null;
		try {
			const { repository } = await session();
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
	 * Record how the reader says a form divides in this document, and show it (spec 004, ADR-0049).
	 * The repository rewrites this document only; it is re-read in place, like a batch of the upgrade.
	 */
	async function correct(
		change: ReturnType<typeof joinWithNext>,
		occurrence: { fromOffset: number; toOffset: number }
	) {
		if (!document || 'refused' in change) return;
		recorder?.corrected();
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
	function sentenceRange(token: Token): [number, number] {
		const ends = media ? /\n/ : /[\n。！？!?]/;
		let from = token.start;
		while (from > 0 && !ends.test(characters[from - 1])) from--;
		let to = token.end;
		while (to < characters.length && !ends.test(characters[to - 1] ?? '')) to++;
		return [from, to];
	}

	function sentenceAround(token: Token): string {
		const [from, to] = sentenceRange(token);
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

	/** For a report: where in the document, never what it says. */
	function reportedScreen(): Record<string, string> {
		const shown: Record<string, string> = {
			Document: page.params.id ?? '?',
			Kind: media ? (media.media ? 'video or audio' : 'video, file not on this device') : 'text',
			Words: String(document?.tokens.length ?? 0)
		};
		if (player) shown.Position = `${player.currentTime.toFixed(1)} s at ${player.playbackRate}×`;
		else shown.Scrolled = `${Math.round(scrollY)} px`;
		return shown;
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

{#if hardcore.back}
	<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- back is resolved by its maker -->
	<a class="back" href={hardcore.back}>← Back to the session</a>
{:else if media}
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
	<div class="session-actions">
		<button class="secondary" onclick={finishSession} disabled={finishing || !recorder}
			>{finishing ? 'Saving session…' : 'Finish session'}</button
		>
		<ReportDialog
			screen={reportedScreen}
			beforeopen={() => (player?.pause(), recorder?.settled())}
		/>
		{#if finishProblem}<ErrorNotice error={finishProblem} onretry={finishSession} />{/if}
	</div>
	<!-- The version is a fingerprint of the analyzer's own behaviour, not a number anyone chose
	     (ADR-0011), so it reads as opaque and is meant to. It is shown because it is the only way
	     to tell whether this device's ICU segments like the one the comparison was run on. -->
	<details class="reader-details" hidden={!!media}>
		<summary>Text details</summary>
		<p class="subtitle">
			Segmented by {document.analyzer} · {document.analyzerVersion}{#if document.upgrade}<br />
				<!-- Two stamps, because a document mid-upgrade genuinely has two: the words before the
			     boundary came from one analyzer and the words after it from another (ADR-0016). A
			     single stamp here would be describing part of the page and claiming all of it. -->
				Upgrading to {document.upgrade.analyzer} — {percentUpgraded(document)}% done{/if}
		</p>
	</details>

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
			cues={shownCues}
			sourceCues={ownCues}
			lines={shownLines}
			language={document.language}
			{startAt}
			translations={shownEnglish}
			askable={quick !== undefined}
			onask={(line) => quick?.focus(firstLineOf(line), true)}
			online={(line) => quick?.focus(firstLineOf(line))}
			onedit={(line) => (editing = line)}
			onword={chooseWord}
			{recorder}
			title={document.title}
			artist={typeof media.meta.uploader === 'string' ? media.meta.uploader : undefined}
			{soundFile}
			until={hardcore.until}
			back={hardcore.back}
			englishShown={hardcore.englishShown}
			bind:player
		>
			{#snippet status()}
				{#if quickStatus}<Progress {...quickStatus} />{/if}
			{/snippet}
		</MediaReader>
		{#if editing !== null && shown[editing]}
			{@const s = editing}
			{@const neighbour = (n: number) =>
				shown[n] ? { chinese: shownCues[n].text, english: shownEnglish[n]?.text } : undefined}
			<LineEditor
				{s}
				count={shown.length}
				words={shownLines.at(s) ?? []}
				english={shownEnglish[s]?.text}
				before={neighbour(s - 1)}
				after={neighbour(s + 1)}
				shiftMs={shiftOf(layout, shown, s)}
				offsetMs={layout.offsetMs}
				canUndo={undo.length > 0}
				{edits}
				onplay={() => playLine(s)}
				onmove={(n) => (editing = n)}
				onundo={() => void takeBack()}
				onclose={() => (editing = null)}
			/>
		{/if}
	{:else}
		<div class="reading" lang={document.language}>
			{#each shownRange ? document.tokens.filter((t) => t.start >= shownRange[0] && t.end <= shownRange[1]) : document.tokens as token (token.start)}{#if token.isWord}<button
						class="token {markOf(token)}"
						data-start={token.start}
						data-end={token.end}
						onclick={() => open(token)}>{@render rubied(token)}</button
					>{:else}<span class="token">{textOf(token)}</span>{/if}{/each}
		</div>
		{#if shownRange && hardcore.back}
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- back is resolved by its maker -->
			<a class="done-reading" href={hardcore.back}>Done</a>
		{/if}
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
			lexemeId={chosen.lexemeId}
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
			onundo={() => {
				recorder?.cancel();
				menuClosed();
			}}
			ontranslate={() =>
				recorder?.translation(undefined, 'google-translate', sentenceRange(chosen!))}
			onclose={menuClosed}
			reasons={recorder !== undefined}
		/>
	{/if}

	<DocumentSettings
		{document}
		bind:media
		reopen="/read/[id]"
		beforechange={() => recorder?.close()}
		leaving={() => (leavingQuietly = true)}
		onrefollow={() => (refollow = true)}
	/>
{/if}

{#if leaving}
	{@const current = leaving}
	<div class="leave-backdrop">
		<div class="leave-sheet" role="dialog" aria-modal="true" aria-label="Before you go">
			<h2>Before you go</h2>
			<p class="muted">
				Session saved. These are optional; you can also answer later under More → Sessions.
			</p>
			<SessionQuestions
				modality={current.modality}
				answered={current.answered}
				answer={current.answer}
				disabled={answering}
				onanswer={(value) => saveLeaving({ kind: 'attention', detail: { answer: value } })}
			/>
			{#if leaveProblem}<ErrorNotice error={leaveProblem} />{/if}
			<div class="leave-actions">
				<button class="secondary" onclick={leave}>Later</button>
				<button onclick={leave}>Done</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.done-reading {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 48px;
		margin: 1rem 0;
		border-radius: 12px;
		background: var(--accent);
		color: var(--on-accent);
		font-weight: 600;
		text-decoration: none;
	}
	.leave-backdrop {
		position: fixed;
		inset: 0;
		z-index: 10;
		display: flex;
		align-items: flex-end;
		justify-content: center;
		background: rgba(0, 0, 0, 0.35);
	}
	/* Anchored to the bottom like the word sheet; scrolls rather than losing its top. */
	.leave-sheet {
		width: 100%;
		max-width: 36rem;
		max-height: 100dvh;
		overflow-y: auto;
		background: var(--paper);
		border-top-left-radius: 12px;
		border-top-right-radius: 12px;
		padding: 0.75rem 1rem calc(0.75rem + env(safe-area-inset-bottom));
		box-shadow: 0 -8px 30px rgba(0, 0, 0, 0.25);
	}
	.leave-sheet h2 {
		font-size: 1.1rem;
		margin: 0.25rem 0;
	}
	.leave-actions {
		display: flex;
		justify-content: space-between;
		gap: 0.75rem;
		margin-top: 1rem;
	}
	h1.compact {
		font-size: 1rem;
		margin: 0.25rem 0;
	}
</style>
