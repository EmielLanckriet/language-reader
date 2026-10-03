/**
 * Records what happens while one document is open, as encounters (spec 007, research R3).
 *
 * Buffered and flushed every few seconds, on pause and seek, and when the page is hidden or left,
 * so a kill loses at most the last flush interval. The hidden and pagehide flushes are registered on
 * `window` in the capture phase: they run before session.ts tells the worker to give up the storage
 * lease, so they are written rather than queued behind it.
 */

import {
	MAX_RANGE,
	type AttentionAnswer,
	type Encounter,
	type Modality
} from '$lib/domain/encounter';

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

const STASH_PREFIX = 'reader.unsent.';
/** A stash not updated for this long belongs to a recorder that is gone (a live one saves every flush). */
const ABANDONED_MS = 60_000;

interface Stash {
	documentId: number;
	modality: Modality;
	session: number | null;
	savedAt: number;
	encounters: Encounter[];
}

/**
 * Write what a recorder that is gone left in its stash (the app was killed with writes waiting).
 * Run at start-up and now and then; a stash still being updated is a live recorder's, and is left.
 */
export async function recoverUnsent(
	sink: EncounterSink,
	now: () => number = Date.now
): Promise<number> {
	let recovered = 0;
	let keys: string[];
	try {
		keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i) ?? '').filter(
			(key) => key.startsWith(STASH_PREFIX)
		);
	} catch {
		return 0;
	}
	for (const key of keys) {
		try {
			const stash = JSON.parse(localStorage.getItem(key) ?? 'null') as Stash | null;
			if (!stash || now() - stash.savedAt < ABANDONED_MS) continue;
			const session = stash.session ?? (await sink.startSession(stash.documentId, stash.modality));
			await sink.recordEncounters(session, stash.encounters);
			localStorage.removeItem(key);
			recovered += stash.encounters.length;
		} catch {
			// Left for the next try: storage may be held by another copy, or the lease not yet back.
		}
	}
	return recovered;
}
/** A jump in playback bigger than this, or any jump back, starts a new chunk. */
const CONTINUOUS_MS = 3_000;
const MIN_SEEK_MS = 500;
/** Shorter stretches are the tail of a pause or a seek, not listening. */
const MIN_PLAYED_MS = 250;

export class Recorder {
	private session: number | undefined;
	private buffer: Encounter[] = [];
	private opening: Encounter[] = [];
	private chunk: OpenChunk | undefined;
	private open: { word: WordAt; moment?: MediaMoment; at: string } | undefined;
	private lastRead = '';
	private flushing: Promise<void> | undefined;
	/** A batch sent but not yet confirmed written: kept in the stash until it is. */
	private inflight: Encounter[] = [];
	private readonly stashKey = `${STASH_PREFIX}${Math.random().toString(36).slice(2)}${Date.now()}`;
	private timer: ReturnType<typeof setInterval> | undefined;
	private engaged = 0;
	private readSince: number | undefined;
	private readingUntil = 0;
	private visible = typeof document === 'undefined' || document.visibilityState === 'visible';
	private ended = false;
	private readonly onHide = () => {
		this.setVisible(document.visibilityState === 'visible');
	};
	private readonly onLeave = () => {
		this.setVisible(false);
		void this.flush();
	};

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
		const reading =
			this.readSince === undefined
				? 0
				: Math.max(0, Math.min(this.now(), this.readingUntil) - this.readSince);
		return (
			this.engaged +
			(this.chunk ? (this.chunk.toMs - this.chunk.fromMs) / this.chunk.speed : 0) +
			reading
		);
	}

	setVisible(visible: boolean): void {
		const now = this.now();
		this.settleReading(now);
		this.visible = visible;
		this.readSince = visible && this.lastRead && !this.ended ? now : undefined;
		if (this.readSince !== undefined) this.readingUntil = now + 60000;
		if (!visible) void this.flush();
	}

	private addTime(durationMs: number, end = this.now()): void {
		let remaining = Math.max(0, Math.round(durationMs));
		while (remaining > 0) {
			const part = Math.min(remaining, 60000);
			this.buffer.push({
				kind: 'study-time',
				at: new Date(end - remaining + part).toISOString(),
				detail: { durationMs: part }
			});
			remaining -= part;
		}
	}

	private settleReading(now = this.now()): void {
		if (this.readSince === undefined) return;
		const duration = Math.max(0, Math.min(now, this.readingUntil) - this.readSince);
		this.engaged += duration;
		this.addTime(duration, Math.min(now, this.readingUntil));
		this.readSince = now;
	}

	/** Playback is at `mediaMs` in line `line`. Called on every timeupdate. */
	playing(line: number, moment: MediaMoment): void {
		if (this.ended) return;
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

	/** `via` names where the replay came from when it was not the ↻ button (e.g. `media-key`). */
	replay(line: number, toPrevious: boolean, mediaMs: number, via?: string): void {
		this.push({
			kind: 'replay',
			documentId: this.documentId,
			mediaMs,
			detail: { line, toPrevious, ...(via ? { via } : {}) }
		});
	}

	/**
	 * English was put on screen for a line, or (`range`) for a sentence of a text. Its range lets the
	 * evidence rule leave the untapped words under it unscored (asked for 2026-10-04).
	 */
	translation(
		line: number | undefined,
		source: string | undefined,
		range = line === undefined ? undefined : this.lineRanges[line]
	): void {
		this.push({
			kind: 'translation',
			documentId: this.documentId,
			...(range ? { fromOffset: range[0], toOffset: range[1] } : {}),
			detail: line === undefined ? { source } : { line, source }
		});
	}

	/** A setting as the session opened, written with its first batch: opening alone writes nothing. */
	noteAtStart(name: string, value: unknown): void {
		this.opening.push({ kind: 'setting', at: this.stamp(), detail: { name, value } });
	}

	setting(name: string, value: unknown): void {
		this.push({ kind: 'setting', detail: { name, value } });
	}

	/** The lines from `fromOffset` to `toOffset` of a text were on screen long enough to be read. */
	read(fromOffset: number, toOffset: number): void {
		if (this.ended) return;
		if (this.modality === 'reading' && this.visible) {
			const now = this.now();
			this.settleReading(now);
			this.readSince = now;
			this.readingUntil = now + 60000;
		}
		const key = `${fromOffset}-${toOffset}`;
		if (key === this.lastRead) return;
		this.lastRead = key;
		for (let from = fromOffset; from < toOffset; from += MAX_RANGE)
			this.push({
				kind: 'read',
				documentId: this.documentId,
				fromOffset: from,
				toOffset: Math.min(from + MAX_RANGE, toOffset)
			});
	}

	/**
	 * A word's sheet opened, showing its meaning. Held until the sheet closes, so that a mistaken tap
	 * can still be undone (spec 013).
	 */
	opened(word: WordAt, moment?: MediaMoment): void {
		this.settle();
		this.closeChunk();
		this.open = { word, moment, at: this.stamp() };
	}

	/** The sheet closed: a lookup, whatever was done in it. `chose` is a state the reader picked. */
	closed(outcome: { chose?: string } = {}): void {
		this.settle(outcome);
	}

	/** The tap was a mistake: no lookup, only the fact that a tap was undone. */
	cancel(): void {
		const open = this.open;
		if (!open) return;
		this.open = undefined;
		this.buffer.push({
			kind: 'tap-undone',
			at: open.at,
			documentId: this.documentId,
			...open.word,
			...open.moment
		});
	}

	attention(answer: AttentionAnswer): Promise<void> {
		this.push({ kind: 'attention', detail: { answer } });
		return this.flush();
	}

	/**
	 * Write everything buffered. Encounters that fail stay for the next flush, and everything not
	 * yet written is also in the stash: with the screen locked the storage lease is let go, so a
	 * write waits until the reader is back, and Android may kill the app first (a bike ride).
	 */
	flush(): Promise<void> {
		this.settleReading();
		this.splitPlaying();
		this.stash();
		this.flushing ??= this.write().finally(() => (this.flushing = undefined));
		return this.flushing;
	}

	/** A chunk still playing is written as it stands and continued in a new one. */
	private splitPlaying(): void {
		const playing = this.chunk;
		if (!playing || playing.toMs <= playing.fromMs) return;
		this.closeChunk();
		this.chunk = { ...playing, fromMs: playing.toMs, fromLine: playing.toLine, at: this.stamp() };
	}

	private stash(): void {
		const unsent = [...this.inflight, ...(this.buffer.length ? this.opening : []), ...this.buffer];
		try {
			if (unsent.length === 0) localStorage.removeItem(this.stashKey);
			else
				localStorage.setItem(
					this.stashKey,
					JSON.stringify({
						documentId: this.documentId,
						modality: this.modality,
						session: this.session ?? null,
						savedAt: this.now(),
						encounters: unsent
					} satisfies Stash)
				);
		} catch {
			// No storage for it (private mode, or full): the encounters are only in memory, as before.
		}
	}

	/** Leave the document: an open sheet counts as a lookup, and everything is written. */
	async close(force = false): Promise<void> {
		this.settle();
		this.closeChunk();
		this.settleReading();
		this.readSince = undefined;
		if (!this.ended && (force || this.session !== undefined || this.buffer.length > 0))
			this.push({ kind: 'session-end' });
		this.ended = true;
		if (this.timer) clearInterval(this.timer);
		if (typeof window !== 'undefined') {
			window.removeEventListener('visibilitychange', this.onHide, true);
			window.removeEventListener('pagehide', this.onLeave, true);
		}
		await this.flush();
		if (this.buffer.length > 0) await this.flush();
	}

	async finish(): Promise<number> {
		await this.close(true);
		if (this.buffer.length || this.inflight.length || this.session === undefined)
			throw new Error('Your session has not been saved yet. Try Finish session again.');
		return this.session;
	}

	private settle(outcome: { chose?: string } = {}): void {
		const open = this.open;
		if (!open) return;
		this.open = undefined;
		const detail: Record<string, unknown> = {};
		if (outcome.chose) detail.chose = outcome.chose;
		this.buffer.push({
			kind: 'lookup',
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
		const duration = (c.toMs - c.fromMs) / c.speed;
		this.engaged += duration;
		if (Number.isFinite(duration) && duration > 0) this.addTime(duration);
		const from = this.lineRanges[c.fromLine];
		const to = this.lineRanges[c.toLine];
		if (!from || !to || c.toMs - c.fromMs < MIN_PLAYED_MS) return;
		// Five seconds of subtitles never come near MAX_RANGE; a jump the continuity check missed might.
		if (to[1] - from[0] > MAX_RANGE) return;
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
		if (this.buffer.length === 0) return;
		const batch = [...this.opening, ...this.buffer];
		this.opening = [];
		this.buffer = [];
		this.inflight = batch;
		try {
			this.session ??= await this.sink.startSession(this.documentId, this.modality);
			await this.sink.recordEncounters(this.session, batch);
		} catch {
			// Kept for the next flush. All or nothing on the other side, so resending is safe.
			this.buffer = [...batch, ...this.buffer];
		} finally {
			this.inflight = [];
			this.stash();
		}
	}
}
