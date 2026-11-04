/**
 * The copy of the reader's work that lives outside the app (ADR-0020, contracts/copy-format.md).
 *
 * A logical format, versioned on its own: words are `(language, surface)`, never lexeme ids, so a
 * copy means the same thing whatever the database looks like when it is restored. Pure; nothing
 * here touches storage.
 */

export const FORMAT = 4;

export interface CopyDocument {
	id: number;
	title: string;
	language: string;
	contentType: string;
	rawContent: string;
	createdAt: string;
	/** A media document's subtitles and metadata; the video itself is found again, not copied. */
	media?: { subtitles: { name: string; text: string }; meta: Record<string, unknown> };
	/** Hidden from the library, its media gone; kept because encounters point into it (format 2). */
	removedAt?: string;
}

/** Format 2 (spec 007): a sitting with one document. */
export interface CopySession {
	deviceId: string;
	deviceSeq: number;
	documentId: number;
	modality: string;
	startedAt: string;
	userId: number;
}

/** Format 2: one encounter; its word, like an event's, as `(language, surface)`. */
export interface CopyEncounter {
	deviceId: string;
	deviceSeq: number;
	session?: { deviceId: string; deviceSeq: number };
	kind: string;
	language?: string;
	surface?: string;
	documentId?: number;
	from?: number;
	to?: number;
	mediaMs?: number;
	speed?: number;
	textVisible?: boolean;
	detail: Record<string, unknown>;
	at: string;
	userId: number;
}

export interface CopyEvent {
	deviceId: string;
	deviceSeq: number;
	language: string;
	surface: string;
	asserted: string;
	assertedAt: string;
	provenance: string;
	userId: number;
	documentId?: number;
	from?: number;
	to?: number;
	observedPronunciation?: string;
}

export interface CopyState {
	language: string;
	surface: string;
	state: string;
	provenance: string;
	userId: number;
}

/** Format 3 (spec 004): one segmentation correction, or with no `parts` an undo of one. */
export interface CopyCorrection {
	deviceId: string;
	deviceSeq: number;
	language: string;
	form: string;
	parts?: { surface: string; key: string }[];
	madeAt: string;
	userId: number;
	documentId?: number;
	from?: number;
	to?: number;
}

export interface CopyBody {
	format: number;
	app: string;
	createdAt: string;
	/** The device that wrote the copy; it carries on as this device after a restore. */
	writer: string;
	devices: { id: string; nextSeq: number }[];
	documents: CopyDocument[];
	events: CopyEvent[];
	states: CopyState[];
	sessions: CopySession[];
	encounters: CopyEncounter[];
	/** Spec 004's segmentation corrections; always empty before format 3. */
	corrections: CopyCorrection[];
	/** Format 4 (spec 019): every status change, in history order. */
	statuses: CopyStatus[];
}

/** Format 4 (spec 019): one change of a word's status, the word by surface like a mark. */
export interface CopyStatus {
	deviceId: string;
	deviceSeq: number;
	language: string;
	surface: string;
	status: string;
	cause: string;
	at: string;
	userId: number;
}

export interface Copy extends CopyBody {
	integrity: string;
}

/**
 * A copy with nothing earned in it: what a fresh or wiped library exports. Sent, it would become
 * Termux's newest copy, in front of the one worth restoring (issue #22).
 */
export function holdsNothing(body: CopyBody): boolean {
	return (
		body.documents.length === 0 &&
		body.events.length === 0 &&
		body.states.length === 0 &&
		body.sessions.length === 0 &&
		// A new library records that it began with statuses (spec 019); that is not earned work.
		body.encounters.every((encounter) => encounter.kind === 'status-switch') &&
		body.corrections.length === 0 &&
		body.statuses.length === 0
	);
}

/** Why a copy was refused; `check` names the failing rule for the reader and for diagnostics. */
export class CopyRejected extends Error {
	constructor(
		readonly check: string,
		message: string
	) {
		super(message);
		this.name = 'CopyRejected';
	}
}

/** JSON with keys sorted at every level, so the same content always hashes the same. */
export function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
	if (value && typeof value === 'object') {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, v]) => v !== undefined)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
		return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
	}
	return JSON.stringify(value);
}

async function sha256(text: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function seal(body: CopyBody): Promise<Copy> {
	return { ...body, integrity: await sha256(canonical(body)) };
}

/**
 * The body of a copy, once it has been proved whole: it parses, its format is one this build
 * knows, and its integrity matches. Refuses otherwise, before anything is written (FR-008).
 */
export async function open(text: string): Promise<CopyBody> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new CopyRejected('parse', 'The copy is not complete: it could not be read.');
	}
	if (!parsed || typeof parsed !== 'object') {
		throw new CopyRejected('parse', 'The copy is not a copy of this app.');
	}
	const { integrity, ...body } = parsed as Copy;
	if (typeof body.format !== 'number' || body.format < 1 || body.format > FORMAT) {
		throw new CopyRejected(
			'format',
			`The copy's format (${body.format}) is not one this app reads.`
		);
	}
	if (integrity !== (await sha256(canonical(body)))) {
		throw new CopyRejected(
			'integrity',
			'The copy is damaged: its contents do not match its check.'
		);
	}
	return upgrade(body);
}

/** Bring an older format up to the current one, one step at a time. */
export function upgrade(body: CopyBody): CopyBody {
	let current = body;
	// 1 → 2: sessions and encounters did not exist yet.
	if (current.format === 1) current = { ...current, format: 2, sessions: [], encounters: [] };
	// 2 → 3: corrections were reserved and always empty.
	if (current.format === 2)
		current = { ...current, format: 3, corrections: current.corrections ?? [] };
	// 3 → 4: statuses began with spec 019; restoring such a copy runs the switch on it.
	if (current.format === 3) current = { ...current, format: 4, statuses: [] };
	return current;
}

/** Rows per history table: an increment says how many the chain holds once it is applied. */
export interface CopyCounts {
	events: number;
	sessions: number;
	encounters: number;
	corrections: number;
	statuses: number;
}

/**
 * Where a chain of copies stands (ADR-0048): the full copy it started from, the last piece sent,
 * the writer's last sequence number in it, and the counts that must hold for the next increment.
 */
export interface CopyCursor {
	base: string;
	tip: string;
	writer: string;
	seq: number;
	counts: CopyCounts;
}

/**
 * What was added since the piece before (Sapling's log, ADR-0048): history rows with a later
 * sequence number of the writer; documents whose content changed, with every current id in
 * `documentIds`; the states of the words those rows touched, or their removal; devices whole.
 */
export interface CopyIncrement {
	format: number;
	kind: 'increment';
	app: string;
	createdAt: string;
	writer: string;
	base: string;
	after: string;
	devices: { id: string; nextSeq: number }[];
	documentIds: number[];
	documents: CopyDocument[];
	events: CopyEvent[];
	states: CopyState[];
	statesRemoved: { language: string; surface: string }[];
	sessions: CopySession[];
	encounters: CopyEncounter[];
	corrections: CopyCorrection[];
	statuses: CopyStatus[];
	counts: CopyCounts;
}

/**
 * Keep only the documents whose mark differs from the one last sent; `marks` holds the current
 * mark of every document in the increment. Returns the trimmed increment and the marks to keep.
 */
export function trimDocuments(
	sent: Record<number, string>,
	increment: CopyIncrement,
	marks: Record<number, string>
): { increment: CopyIncrement; sent: Record<number, string> } {
	return {
		increment: {
			...increment,
			documents: increment.documents.filter((d) => sent[d.id] !== marks[d.id])
		},
		sent: Object.fromEntries(increment.documentIds.map((id) => [id, marks[id] ?? sent[id]]))
	};
}

const bySequence = <T extends { deviceId: string; deviceSeq: number }>(a: T, b: T) =>
	a.deviceId === b.deviceId ? a.deviceSeq - b.deviceSeq : a.deviceId < b.deviceId ? -1 : 1;

const wordKey = (word: { language: string; surface: string }) =>
	`${word.language}\u0000${word.surface}`;

/**
 * The full copy a base and its increments stand for, in the order `exportBody` writes. Throws when
 * a piece does not follow the one before it, or the counts it promises do not come out.
 */
export function mergeChain(base: CopyBody, increments: CopyIncrement[]): CopyBody {
	const merged: CopyBody = {
		...base,
		documents: [...base.documents],
		events: [...base.events],
		sessions: [...base.sessions],
		encounters: [...base.encounters],
		corrections: [...base.corrections],
		statuses: [...base.statuses]
	};
	const states = new Map(base.states.map((state) => [wordKey(state), state]));
	let tip = base.createdAt;
	for (const piece of increments) {
		if (piece.kind !== 'increment' || piece.base !== base.createdAt || piece.after !== tip) {
			throw new CopyRejected('chain', 'The copies do not follow each other.');
		}
		tip = piece.createdAt;
		const documents = new Map(merged.documents.map((d) => [d.id, d]));
		for (const document of piece.documents) documents.set(document.id, document);
		const missing = piece.documentIds.find((id) => !documents.has(id));
		if (missing !== undefined) {
			throw new CopyRejected('chain', `The copies lack document ${missing}.`);
		}
		merged.documents = piece.documentIds.map((id) => documents.get(id)!);
		merged.events.push(...piece.events);
		merged.sessions.push(...piece.sessions);
		merged.encounters.push(...piece.encounters);
		merged.corrections.push(...piece.corrections);
		merged.statuses.push(...piece.statuses);
		for (const state of piece.states) states.set(wordKey(state), state);
		for (const word of piece.statesRemoved) states.delete(wordKey(word));
		const { counts } = piece;
		if (
			merged.events.length !== counts.events ||
			merged.sessions.length !== counts.sessions ||
			merged.encounters.length !== counts.encounters ||
			merged.corrections.length !== counts.corrections ||
			merged.statuses.length !== counts.statuses
		) {
			throw new CopyRejected('chain', 'The copies do not add up: a piece is missing.');
		}
		merged.app = piece.app;
		merged.createdAt = piece.createdAt;
		merged.writer = piece.writer;
		merged.devices = piece.devices;
	}
	merged.events.sort(bySequence);
	merged.sessions.sort(bySequence);
	merged.encounters.sort(bySequence);
	merged.corrections.sort(bySequence);
	merged.statuses.sort(bySequence);
	merged.states = [...states.values()].sort((a, b) =>
		wordKey(a) < wordKey(b) ? -1 : wordKey(a) > wordKey(b) ? 1 : 0
	);
	return merged;
}

/** Seal any piece: the same check as a full copy's. */
export async function sealPiece<T extends object>(piece: T): Promise<T & { integrity: string }> {
	return { ...piece, integrity: await sha256(canonical(piece)) };
}

/** Read an increment, refusing a damaged one. */
export async function openIncrement(text: string): Promise<CopyIncrement> {
	let parsed: (CopyIncrement & { integrity?: string }) | undefined;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new CopyRejected('parse', 'A piece of the copy could not be read.');
	}
	const { integrity, ...piece } = parsed ?? ({} as CopyIncrement & { integrity?: string });
	if (piece.kind !== 'increment' || piece.format !== FORMAT) {
		throw new CopyRejected('format', 'A piece of the copy is not one this app reads.');
	}
	if (integrity !== (await sha256(canonical(piece)))) {
		throw new CopyRejected('integrity', 'A piece of the copy is damaged.');
	}
	return piece;
}
