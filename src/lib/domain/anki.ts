/**
 * The reader's Anki words as a starting point (spec 006, ADR-0024): reading the laptop's export, and
 * deciding what an import writes for each word. Pure; the repository applies the plan.
 */

export interface AnkiWord {
	word: string;
	level: string;
	stability: number;
	type: number;
	lapses: number;
	suspended: boolean;
	/** Format 2 (spec 007): the card's FSRS difficulty, its last review, and its curve's decay. */
	difficulty?: number | null;
	lastReview?: string | null;
	decay?: number | null;
}

/** The FSRS-6 parameters Anki fitted to the reader's reviews, read from one preset (spec 007). */
export interface FsrsParameters {
	preset: string;
	weights: number[];
	retention: number;
}

export interface AnkiExport {
	format: 1 | 2;
	profile: string;
	collectionModified: string;
	/** The import's id: exporting again gives a new one. */
	exportedAt: string;
	/** Format 2; null when the collection has no FSRS-6 preset. */
	parameters?: FsrsParameters | null;
	words: AnkiWord[];
}

export function parseAnkiExport(text: string): AnkiExport {
	const file = JSON.parse(text);
	if (file?.format !== 1 && file?.format !== 2)
		throw new Error(
			`This is Anki export format ${file?.format}; this Reader reads formats 1 and 2.`
		);
	if (!Array.isArray(file.words) || typeof file.exportedAt !== 'string')
		throw new Error('This does not look like an Anki export from export_words.py.');
	return file;
}

/**
 * The provenance of an imported judgment: Anki, which import, and the memory it came from, which
 * is what the scheduler starts the word from (spec 007, FR-014). Format 1 had stability only.
 */
export function ankiProvenance(importId: string, word: number | AnkiWord): string {
	if (typeof word === 'number') return `anki ${importId} s=${word}`;
	let provenance = `anki ${importId} s=${word.stability}`;
	if (typeof word.difficulty === 'number') provenance += ` d=${word.difficulty}`;
	if (word.lastReview) provenance += ` r=${word.lastReview}`;
	if (typeof word.decay === 'number') provenance += ` decay=${word.decay}`;
	return provenance;
}

export interface AnkiSeed {
	stability: number;
	difficulty: number;
	lastReview: string;
	decay?: number;
	/** False for a format-1 import: the import's own date stands in for the last review. */
	dateKnown: boolean;
}

/** Anki's default FSRS difficulty, for a word imported without one. */
const MIDDLE_DIFFICULTY = 5;

/** The memory an imported judgment carries, or undefined for any other judgment. */
export function ankiSeedOf(provenance: string): AnkiSeed | undefined {
	if (!isFromAnki(provenance)) return undefined;
	const [, importId, ...fields] = provenance.split(' ');
	const field = new Map(
		fields.map((pair) => [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)])
	);
	if (!field.has('s')) return undefined;
	const decay = field.get('decay');
	return {
		stability: Number(field.get('s')),
		difficulty: field.has('d') ? Number(field.get('d')) : MIDDLE_DIFFICULTY,
		lastReview: field.get('r') ?? importId,
		decay: decay === undefined ? undefined : Number(decay),
		dateKnown: field.has('r')
	};
}

export function isFromAnki(provenance: string): boolean {
	return provenance.startsWith('anki ');
}

/** The import a provenance names, or undefined for any judgment Anki did not make. */
export function ankiImportOf(provenance: string): string | undefined {
	return isFromAnki(provenance) ? provenance.split(' ')[1] : undefined;
}

export interface CurrentState {
	state: string;
	provenance: string;
}

export interface ImportPlan {
	set: { word: string; level: string; provenance: string }[];
	/** Words the reader judged themselves, which the import leaves alone (FR-005). */
	keptOwn: string[];
	/** Words whose Anki level and strength are what the Reader already has (FR-007). */
	unchanged: number;
}

/** What to write for each word (research R6); `current` is the word's state now, if any. */
export function planImport(
	file: AnkiExport,
	current: (word: string) => CurrentState | undefined
): ImportPlan {
	const plan: ImportPlan = { set: [], keptOwn: [], unchanged: 0 };
	for (const entry of file.words) {
		const now = current(entry.word);
		const provenance = ankiProvenance(file.exportedAt, entry);
		if (now && !isFromAnki(now.provenance)) plan.keptOwn.push(entry.word);
		else if (now && now.state === entry.level && sameMemory(now.provenance, provenance))
			plan.unchanged++;
		else plan.set.push({ word: entry.word, level: entry.level, provenance });
	}
	return plan;
}

/** Whether two imported judgments carry the same memory, whichever imports they came from. */
function sameMemory(a: string, b: string): boolean {
	const memory = (provenance: string) => provenance.slice(provenance.indexOf(' s='));
	return memory(a) === memory(b);
}
