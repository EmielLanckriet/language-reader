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
}

export interface AnkiExport {
	format: 1;
	profile: string;
	collectionModified: string;
	/** The import's id: exporting again gives a new one. */
	exportedAt: string;
	words: AnkiWord[];
}

export function parseAnkiExport(text: string): AnkiExport {
	const file = JSON.parse(text);
	if (file?.format !== 1)
		throw new Error(`This is Anki export format ${file?.format}; this Reader reads format 1.`);
	if (!Array.isArray(file.words) || typeof file.exportedAt !== 'string')
		throw new Error('This does not look like an Anki export from export_words.py.');
	return file;
}

/** The provenance of an imported judgment: Anki, which import, and the strength it came from. */
export function ankiProvenance(importId: string, stability: number): string {
	return `anki ${importId} s=${stability}`;
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
		const provenance = ankiProvenance(file.exportedAt, entry.stability);
		if (now && !isFromAnki(now.provenance)) plan.keptOwn.push(entry.word);
		else if (now && now.state === entry.level && sameStrength(now.provenance, entry.stability))
			plan.unchanged++;
		else plan.set.push({ word: entry.word, level: entry.level, provenance });
	}
	return plan;
}

function sameStrength(provenance: string, stability: number): boolean {
	return provenance.endsWith(` s=${stability}`);
}
