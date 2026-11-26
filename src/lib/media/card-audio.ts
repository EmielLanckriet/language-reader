import type { CardSentence } from '../storage/repository';
import { englishFor, llmByLine } from '../translation/lines';
import { playbackUrl, type Readable } from './files';
import { englishOfShown, shownAt, shownOf, type Pos } from './layout';
import type { StoredMedia } from './store';
import { humanLines } from './translation';

/**
 * A card's sentence as the player shows its line (ADR-0050, #62): the whole line, since punctuation
 * inside a subtitle has no timestamp of its own, joined, cut and timed as the reader edited it, with
 * its English. A joined line keeps its line breaks, so `from + wordFrom` stays the word's place in
 * the document; the card does not show them.
 */
export function shownExample(
	sentence: CardSentence,
	media: Pick<
		StoredMedia,
		'cues' | 'layout' | 'english' | 'translation' | 'quick' | 'tracks' | 'recut'
	>
) {
	const { cues, layout } = media;
	const cue = cues[sentence.line];
	if (
		sentence.source !== 'reader' ||
		!cue ||
		sentence.lineText !== cue.text ||
		sentence.lineFrom === undefined
	)
		return;
	const shown = shownOf(cues, layout);
	const at = sentence.from - sentence.lineFrom + sentence.wordFrom;
	const s = shownAt(shown, { line: sentence.line, at });
	const line = shown[s];
	if (!Number.isFinite(line.start) || !Number.isFinite(line.end) || line.end <= line.start) return;

	const document = cues.map((c) => c.text).join('\n');
	const starts = [0];
	for (const c of cues) starts.push(starts.at(-1)! + [...c.text].length + 1);
	const offset = ({ line, at }: Pos) => starts[line] + at;
	const from = offset(line.from);
	// A line ending where the next starts ends before the line break.
	const to = offset(line.to) - (line.to.at === 0 ? 1 : 0);
	// The same distance moves `from` and `wordFrom`, so their sum stays the word's document offset.
	const before = starts[sentence.line] + at - from;
	const english = englishOfShown(
		shown,
		layout,
		englishFor(cues.length, llmByLine(cues, media.translation), media.quick, humanLines(media)),
		media.english.source === 'edited'
	)[s]?.text;
	return {
		sentence: {
			...sentence,
			text: [...document].slice(from, to).join(''),
			from: sentence.lineFrom + at - before,
			to: sentence.lineFrom + at - before + (to - from),
			wordFrom: before,
			wordTo: before + sentence.wordTo - sentence.wordFrom
		},
		start: line.start,
		end: line.end,
		english
	};
}

/** Android's text-to-speech in the native app, whose WebView has no speechSynthesis (WordSpeech.kt). */
interface NativeSpeech {
	speak(id: string, text: string): 'ok' | 'starting' | 'no-voice';
	stop(): void;
}
const nativeSpeech = () => (globalThis as { ReaderSpeech?: NativeSpeech }).ReaderSpeech;
let utterances = 0;
const NO_VOICE =
	'No Mandarin voice is available. Add Chinese (Mandarin) in your phone’s text-to-speech settings, or import your Anki word recordings.';

/** Owns a single short playback. Never decodes an entire video or records a reading encounter. */
export class CardAudio {
	private audio: HTMLAudioElement | undefined;
	private release: (() => void) | undefined;
	private timer: ReturnType<typeof setInterval> | undefined;
	private generation = 0;
	private timeout: ReturnType<typeof setTimeout> | undefined;
	private unlisten: (() => void) | undefined;
	private hidden = () => {
		if (document.hidden) this.stop();
	};
	constructor(private report: (playing: boolean, error?: string) => void) {
		document.addEventListener('visibilitychange', this.hidden);
	}
	stop() {
		this.generation++;
		if (this.timer) clearInterval(this.timer);
		this.timer = undefined;
		if (this.timeout) clearTimeout(this.timeout);
		this.timeout = undefined;
		if (this.audio) {
			this.audio.pause();
			this.audio.removeAttribute('src');
			this.audio.load();
			this.audio = undefined;
		}
		this.release?.();
		this.release = undefined;
		globalThis.speechSynthesis?.cancel();
		if (this.unlisten) {
			this.unlisten();
			this.unlisten = undefined;
			nativeSpeech()?.stop();
		}
		this.report(false);
	}
	play(file: Readable, start = 0, end?: number) {
		this.stop();
		const generation = this.generation;
		const audio = new Audio();
		this.audio = audio;
		audio.preload = 'metadata';
		const fail = () => {
			if (this.generation === generation) {
				this.stop();
				this.report(false, 'This recording could not be played.');
			}
		};
		audio.onerror = fail;
		audio.onended = () => {
			if (this.generation === generation) this.stop();
		};
		audio.onloadedmetadata = () => {
			if (this.generation !== generation) return;
			if (
				start < 0 ||
				!Number.isFinite(start) ||
				(end !== undefined && (!Number.isFinite(end) || end <= start)) ||
				start >= audio.duration
			) {
				fail();
				return;
			}
			audio.currentTime = start;
			void audio
				.play()
				.then(() => {
					if (this.generation !== generation) {
						audio.pause();
						return;
					}
					if (this.timeout) clearTimeout(this.timeout);
					this.timeout = undefined;
					this.report(true);
				})
				.catch(fail);
		};
		const stopAtEnd = () => {
			if (this.generation === generation && end !== undefined && audio.currentTime >= end)
				this.stop();
		};
		audio.ontimeupdate = stopAtEnd;
		if (end !== undefined) this.timer = setInterval(stopAtEnd, 40);
		this.timeout = setTimeout(fail, 15000);
		const { url, release } = playbackUrl(file);
		this.release = release;
		audio.src = url;
	}
	speak(word: string) {
		this.stop();
		const synthesis = globalThis.speechSynthesis;
		const native = nativeSpeech();
		if (!synthesis && native) {
			this.speakNatively(native, word);
			return;
		}
		if (!synthesis) {
			this.report(false, 'Word pronunciation is unavailable on this device.');
			return;
		}
		const voice = synthesis
			.getVoices()
			.find((v) => v.localService && /^(zh[-_]?(CN|SG|Hans)|cmn)([-_]|$)/i.test(v.lang));
		if (!voice) {
			this.report(
				false,
				'No local Mandarin voice is available. Enable a Chinese voice in your phone’s text-to-speech settings, or import your Anki word recordings.'
			);
			return;
		}
		const generation = this.generation;
		const utterance = new SpeechSynthesisUtterance(word);
		utterance.voice = voice;
		utterance.lang = voice.lang;
		utterance.onend = () => {
			if (this.generation === generation) this.stop();
		};
		utterance.onerror = () => {
			if (this.generation === generation) {
				this.stop();
				this.report(false, 'Word pronunciation could not be played.');
			}
		};
		synthesis.speak(utterance);
		this.report(true);
	}
	private speakNatively(native: NativeSpeech, word: string) {
		const generation = this.generation;
		const id = String(++utterances);
		const heard = (event: Event) => {
			const { detail } = event as CustomEvent<{ id: string; event: string }>;
			if (detail.id !== id || this.generation !== generation) return;
			this.stop();
			if (detail.event === 'error') this.report(false, 'Word pronunciation could not be played.');
			if (detail.event === 'no-voice') this.report(false, NO_VOICE);
		};
		addEventListener('readerspeech', heard);
		this.unlisten = () => removeEventListener('readerspeech', heard);
		if (native.speak(id, word) === 'no-voice') {
			this.stop();
			this.report(false, NO_VOICE);
			return;
		}
		this.report(true);
	}
	dispose() {
		this.stop();
		document.removeEventListener('visibilitychange', this.hidden);
	}
}
