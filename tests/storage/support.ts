import { loadSqlite, applyMigrations, type Database } from '../../src/lib/storage/db';
import { CHINESE_UNIT_DELIMITERS } from '../../src/lib/analyzer/delimiters';
import { splitIntoUnits } from '../../src/lib/analyzer/units';
import { codePointsOf } from '../../src/lib/domain/offsets';
import type { Analyzer, AnalyzedToken } from '../../src/lib/analyzer/types';

/**
 * A fresh, empty database in memory.
 *
 * In memory rather than OPFS because what these tests examine is the schema and the write paths,
 * not where the bytes end up. OPFS is exercised on the phone, which is where it can actually fail.
 */
export async function freshDatabase(): Promise<Database> {
	const sqlite3 = await loadSqlite();
	const db = new sqlite3.oo1.DB(':memory:', 'c');
	applyMigrations(db);
	return db;
}

/**
 * An analyzer that pairs characters inside each segmentation unit.
 *
 * Shared by the three storage tests that need *a different analyzer to upgrade to*, rather than
 * copied into each of them. It produces multi-character words, so a document upgraded from
 * `characterSplitter` changes visibly, and it respects the unit delimiters, which is the condition
 * ADR-0016's boundary rests on.
 *
 * It is not, and cannot be, evidence that batching preserves a *contextual* analyzer's decisions:
 * it decides each unit independently, so for this analyzer any batching at unit boundaries gives
 * the same answer by construction. That property belongs to the analyzers themselves and is
 * checked where it lives, in tests/analyzer/unit-locality.test.ts.
 */
export const pairwiseAnalyzer: Analyzer = {
	name: 'pairwise-test',
	version: '1',
	language: 'zh',
	unitDelimiters: CHINESE_UNIT_DELIMITERS,

	async analyze(text: string): Promise<AnalyzedToken[]> {
		const tokens: AnalyzedToken[] = [];
		for (const unit of splitIntoUnits(text, CHINESE_UNIT_DELIMITERS)) {
			const characters = codePointsOf(unit.text);
			let at = 0;
			while (at < characters.length) {
				if (CHINESE_UNIT_DELIMITERS.has(characters[at])) {
					tokens.push({ start: unit.start + at, end: unit.start + at + 1, isWord: false });
					at += 1;
					continue;
				}
				const end = Math.min(at + 2, characters.length);
				tokens.push({ start: unit.start + at, end: unit.start + end, isWord: true });
				at = end;
			}
		}
		return tokens;
	},

	lexemeKey: (surface) => surface
};

/** Where segmentation units end, which is where a batch may stop (ADR-0013, ADR-0016). */
export function unitBoundaries(text: string, analyzer: Analyzer): number[] {
	return splitIntoUnits(text, analyzer.unitDelimiters).map(
		(unit) => unit.start + codePointsOf(unit.text).length
	);
}
