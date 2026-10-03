import { expect, it } from 'vitest';
import { Repository } from '../../src/lib/storage/repository';
import { queryRows } from '../../src/lib/storage/db';
import { freshDatabase } from './support';
import { buildHistory } from '../backup/support';

// Shown English, end to end (spec 013): a reveal stored as the recorder writes it leaves the words
// of its line without credit, while the session's other words keep theirs.

it('gives no credit to the words of a revealed line, and keeps it for the others', async () => {
	const db = await freshDatabase();
	try {
		const repo = new Repository(db);
		const [id] = await buildHistory(repo, ['我看书\n你好'], []);
		const tokens = repo.getDocument(id).tokens.filter((t) => t.isWord);
		const onLine = (line: number) => tokens.find((t) => (line === 0 ? t.end <= 3 : t.start >= 4))!;
		const session = repo.startSession(id, 'media');
		const at = '2026-10-04T10:00:00Z';
		repo.recordEncounters(session, [
			{
				kind: 'played',
				at,
				documentId: id,
				fromOffset: 0,
				toOffset: 6,
				mediaMs: 0,
				textVisible: true,
				detail: { toMs: 5000 }
			},
			{ kind: 'session-end', at },
			{ kind: 'attention', at, detail: { answer: 'all' } }
		]);
		// Written after the answer, as a late flush can be, and as written before 2026-10-04: the
		// line only, no offsets.
		repo.recordEncounters(session, [
			{ kind: 'translation', at, documentId: id, detail: { line: 1, source: 'quick' } }
		]);
		const memory = (lexemeId: number) =>
			queryRows(db, `SELECT skill FROM memory WHERE lexeme_id = ?`, [lexemeId]).map((r) => r.skill);
		expect(memory(onLine(0).lexemeId!)).toEqual(['reading']);
		expect(memory(onLine(1).lexemeId!)).toEqual([]);
	} finally {
		db.close();
	}
});
