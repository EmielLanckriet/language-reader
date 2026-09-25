/**
 * The copy of the reader's work that lives outside the app (ADR-0020, contracts/copy-format.md).
 *
 * A logical format, versioned on its own: words are `(language, surface)`, never lexeme ids, so a
 * copy means the same thing whatever the database looks like when it is restored. Pure; nothing
 * here touches storage.
 */

export const FORMAT = 1;

export interface CopyDocument {
	id: number;
	title: string;
	language: string;
	contentType: string;
	rawContent: string;
	createdAt: string;
	/** A media document's subtitles and metadata; the video itself is found again, not copied. */
	media?: { subtitles: { name: string; text: string }; meta: Record<string, unknown> };
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
	/** Spec 004's segmentation corrections, once they exist. */
	corrections: unknown[];
}

export interface Copy extends CopyBody {
	integrity: string;
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

/** Bring an older format up to the current one, one step at a time. There are no older formats yet. */
export function upgrade(body: CopyBody): CopyBody {
	return body;
}
