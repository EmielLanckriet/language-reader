import { Repository } from '../../src/lib/storage/repository';
import { characterSplitter } from '../../src/lib/analyzer/character';
import { resolveTokens, stampOf } from '../../src/lib/analyzer/resolve';
import { queryRows, type Database } from '../../src/lib/storage/db';
import { AVAILABLE_STATES } from '../../src/lib/domain/state';

export const STATES = AVAILABLE_STATES.map((state) => state.name);

export interface Mark {
	document: number;
	word: number;
	state: string;
}

/** Documents saved in order, then marks made on their words, with occurrences, as the reader makes them. */
export async function buildHistory(repository: Repository, texts: string[], marks: Mark[]) {
	const ids: number[] = [];
	for (const text of texts) {
		const tokens = resolveTokens(text, await characterSplitter.analyze(text), characterSplitter);
		ids.push(
			repository.saveDocument(
				{ rawContent: text, contentType: 'text/plain', language: 'zh', title: text },
				tokens,
				stampOf(characterSplitter)
			)
		);
	}
	for (const mark of marks) {
		const document = repository.getDocument(ids[mark.document % ids.length]);
		const words = document.tokens.filter((token) => token.isWord);
		const token = words[mark.word % words.length];
		repository.assertState(token.lexemeId!, mark.state, {
			documentId: document.id,
			fromOffset: token.start,
			toOffset: token.end
		});
	}
	return ids;
}

/** Every row of every table, to prove a refused restore changed nothing at all. */
export function dump(db: Database): string {
	const tables = queryRows(db, "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name");
	return JSON.stringify(
		tables.map(({ name }) => [
			name,
			queryRows(db, `SELECT * FROM "${String(name)}" ORDER BY rowid`)
		])
	);
}
