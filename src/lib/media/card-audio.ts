import type { CardSentence } from '../storage/repository';
import type { Cue } from './subtitles';

/** Display the whole timed cue: punctuation inside a subtitle has no independent timestamp. */
export function timedExample(sentence: CardSentence, cues: Cue[]) {
	const cue = cues[sentence.line];
	if (
		sentence.source !== 'reader' ||
		!cue ||
		sentence.lineText !== cue.text ||
		sentence.lineFrom === undefined ||
		!Number.isFinite(cue.start) ||
		!Number.isFinite(cue.end) ||
		cue.start < 0 ||
		cue.end <= cue.start
	)
		return;
	const shift = sentence.from - sentence.lineFrom;
	return {
		sentence: {
			...sentence,
			text: cue.text,
			from: sentence.lineFrom,
			to: sentence.lineFrom + [...cue.text].length,
			wordFrom: sentence.wordFrom + shift,
			wordTo: sentence.wordTo + shift
		},
		start: cue.start,
		end: cue.end
	};
}

/** Owns a single short playback. Never decodes an entire video or records a reading encounter. */
export class CardAudio {
	private audio: HTMLAudioElement | undefined;
	private url: string | undefined;
	private timer: ReturnType<typeof setInterval> | undefined;
	private generation = 0;
	private timeout: ReturnType<typeof setTimeout> | undefined;
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
		if (this.url) URL.revokeObjectURL(this.url);
		this.url = undefined;
		globalThis.speechSynthesis?.cancel();
		this.report(false);
	}
	play(file: Blob, start = 0, end?: number) {
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
		this.url = URL.createObjectURL(file);
		audio.src = this.url;
	}
	speak(word: string) {
		this.stop();
		const synthesis = globalThis.speechSynthesis;
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
	dispose() {
		this.stop();
		document.removeEventListener('visibilitychange', this.hidden);
	}
}
