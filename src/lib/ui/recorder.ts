/**
 * Records what happens while one document is open, as encounters (spec 007, research R3).
 *
 * Buffered and flushed every few seconds, on pause and seek, and when the page is hidden or left,
 * so a kill loses at most the last flush interval. The hidden and pagehide flushes are registered on
 * `window` in the capture phase: they run before session.ts tells the worker to give up the storage
 * lease, so they are written rather than queued behind it.
 */

import type { AttentionAnswer, Encounter, Modality } from '$lib/domain/encounter';

export interface EncounterSink {
	startSession(documentId: number, modality: Modality): Promise<number>;
	recordEncounters(sessionId: number, encounters: Encounter[]): Promise<void>;
}

export interface WordAt {
	lexemeId: number;
	fromOffset: number;
	toOffset: number;
}

export interface MediaMoment {
	mediaMs: number;
	speed: number;
	textVisible: boolean;
}

/** A played stretch still being extended: flushed as one `played` encounter. */
interface OpenChunk {
	fromMs: number;
	toMs: number;
	fromLine: number;
	toLine: number;
	speed: number;
	textVisible: boolean;
	at: string;
}

export const FLUSH_EVERY_MS = 5_000;
/** A jump in playback bigger than this, or any jump back, starts a new chunk. */
const CONTINUOUS_MS = 3_000;
const MIN_SEEK_MS = 500;
/** Shorter stretches are the tail of a pause or a seek, not listening. */
const MIN_PLAYED_MS = 250;

export class Recorder {
	private session: number | undefined;
	private buffer: Encounter[] = [];
	private chunk: OpenChunk | undefined;
	private open: { word: WordAt; moment?: MediaMoment; at: string } | undefined;
	private lastRead = '';
	private flushing: Promise<void> | undefined;
	private timer: ReturnType<typeof setInterval> | undefined;
	private engaged = 0;
	private readSince: number | undefined;
	private readonly onHide = () => {
		if (document.visibilityState === 'hidden') void this.flush();
	};
	private readonly onLeave = () => void this.flush();

	constructor(
		private readonly sink: EncounterSink,
		private readonly documentId: number,
		private readonly modality: Modality,
		/** Line i's code-point range in the document, for media: its cue's text. */
		private readonly lineRanges: [number, number][] = [],
		private readonly now: () => number = Date.now
	) {
		if (typeof window !== 'undefined') {
			window.addEventListener('visibilitychange', this.onHide, true);
			window.addEventListener('pagehide', this.onLeave, true);
			this.timer = setInterval(() => void this.flush(), FLUSH_EVERY_MS);
		}
	}

	/** How long the reader has read or played, for whether the attention question is worth asking. */
	engagedMs(): number {
		const reading = this.readSince === undefined ? 0 : this.now() - this.readSince;
		return this.engaged + (this.chunk ? this.chunk.toMs - this.chunk.fromMs : 0) + reading;
	}

	/** Playback is at `mediaMs` in line `line`. Called on every timeupdate. */
	playing(line: number, moment: MediaMoment): void {
		const c = this.chunk;
		const continuous =
			c &&
			moment.mediaMs >= c.toMs - 250 &&
			moment.mediaMs <= c.toMs + CONTINUOUS_MS &&
			moment.speed === c.speed &&
			moment.textVisible === c.textVisible;
		if (c && continuous) {
			c.toMs = moment.mediaMs;
			c.toLine = Math.max(c.toLine, line);
			return;
		}
		this.closeChunk();
		if (line < 0) return;
		this.chunk = {
			fromMs: moment.mediaMs,
			toMs: moment.mediaMs,
			fromLine: line,
			toLine: line,
			speed: moment.speed,
			textVisible: moment.textVisible,
			at: this.stamp()
		};
	}

	paused(): void {
		this.closeChunk();
		void this.flush();
	}

	seek(fromMs: number, toMs: number): void {
		this.closeChunk();
		// A replay's or a line's own small correction is not a skip.
		if (Math.abs(toMs - fromMs) < MIN_SEEK_MS) return;
		this.push({ kind: 'seek', documentId: this.documentId, detail: { fromMs, toMs } });
		void this.flush();
	}

	replay(line: number, toPrevious: boolean, mediaMs: number): void {
		this.push({
			kind: 'replay',
			documentId: this.documentId,
			mediaMs,
			detail: { line, toPrevious }
		});
	}

	translation(line: number, source: string | undefined): void {
		this.push({ kind: 'translation', documentId: this.documentId, detail: { line, source } });
	}

	setting(name: string, value: unknown): void {
		this.push({ kind: 'setting', detail: { name, value } });
	}

	/** The lines from `fromOffset` to `toOffset` of a text were on screen long enough to be read. */
	read(fromOffset: number, toOffset: number): void {
		this.readSince ??= this.now();
		const key = `${fromOffset}-${toOffset}`;
		if (key === this.lastRead) return;
		this.lastRead = key;
		this.push({ kind: 'read', documentId: this.documentId, fromOffset, toOffset });
	}

	/**
	 * A word's sheet opened, showing its meaning. Held until the sheet closes: only then is it known
	 * whether this was a lookup or a check ("I knew it").
	 */
	opened(word: WordAt, moment?: MediaMoment): void {
		this.settle();
		this.closeChunk();
		this.open = { word, moment, at: this.stamp() };
	}

	/** The sheet closed. `knew` when the reader said they knew it; `chose` a state they picked. */
	closed(outcome: { knew?: 'knew' | 'known'; chose?: string } = {}): void {
		this.settle(outcome);
	}

	attention(answer: AttentionAnswer): Promise<void> {
		this.push({ kind: 'attention', detail: { answer } });
		return this.flush();
	}

	/** Write everything buffered. Encounters that fail stay for the next flush. */
	flush(): Promise<void> {
		this.flushing ??= this.write().finally(() => (this.flushing = undefined));
		return this.flushing;
	}

	/** Leave the document: an open sheet counts as a lookup, and everything is written. */
	async close(): Promise<void> {
		this.settle();
		this.closeChunk();
		if (this.timer) clearInterval(this.timer);
		if (typeof window !== 'undefined') {
			window.removeEventListener('visibilitychange', this.onHide, true);
			window.removeEventListener('pagehide', this.onLeave, true);
		}
		await this.flush();
		if (this.buffer.length > 0) await this.flush();
	}

	private settle(outcome: { knew?: 'knew' | 'known'; chose?: string } = {}): void {
		const open = this.open;
		if (!open) return;
		this.open = undefined;
		const detail: Record<string, unknown> = {};
		if (outcome.knew) detail.via = outcome.knew;
		if (outcome.chose) detail.chose = outcome.chose;
		this.buffer.push({
			kind: outcome.knew ? 'check' : 'lookup',
			at: open.at,
			documentId: this.documentId,
			...open.word,
			...open.moment,
			detail
		});
	}

	private closeChunk(): void {
		const c = this.chunk;
		if (!c) return;
		this.chunk = undefined;
		this.engaged += c.toMs - c.fromMs;
		const from = this.lineRanges[c.fromLine];
		const to = this.lineRanges[c.toLine];
		if (!from || !to || c.toMs - c.fromMs < MIN_PLAYED_MS) return;
		this.buffer.push({
			kind: 'played',
			at: c.at,
			documentId: this.documentId,
			fromOffset: from[0],
			toOffset: to[1],
			mediaMs: Math.round(c.fromMs),
			speed: c.speed,
			textVisible: c.textVisible,
			detail: { toMs: Math.round(c.toMs) }
		});
	}

	/** Anything that happens ends the stretch before it, so the log reads in the order it happened. */
	private push(encounter: Omit<Encounter, 'at'>): void {
		this.closeChunk();
		this.buffer.push({ ...encounter, at: this.stamp() });
	}

	private stamp(): string {
		return new Date(this.now()).toISOString();
	}

	private async write(): Promise<void> {
		// A chunk still playing is written as it stands and continued in a new one.
		const playing = this.chunk;
		if (playing && playing.toMs > playing.fromMs) {
			this.closeChunk();
			this.chunk = { ...playing, fromMs: playing.toMs, fromLine: playing.toLine, at: this.stamp() };
		}
		if (this.buffer.length === 0) return;
		const batch = this.buffer;
		this.buffer = [];
		try {
			this.session ??= await this.sink.startSession(this.documentId, this.modality);
			await this.sink.recordEncounters(this.session, batch);
		} catch {
			// Kept for the next flush. All or nothing on the other side, so resending is safe.
			this.buffer = [...batch, ...this.buffer];
		}
	}
}
