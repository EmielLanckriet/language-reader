import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Repository } from '../../src/lib/storage/repository';
import { sweepStaleDocuments, type SweepStorage } from '../../src/lib/storage/sweep';
import { characterSplitter } from '../../src/lib/analyzer/character';
import { resolveTokens, stampOf } from '../../src/lib/analyzer/resolve';
import { pasteSource } from '../../src/lib/content/paste';
import { codePointsOf } from '../../src/lib/domain/offsets';
import { tiles } from '../../src/lib/domain/tiling';
import { freshDatabase, pairwiseAnalyzer as pairwise, unitBoundaries } from './support';
import type { Database } from '../../src/lib/storage/db';
import type { Analyzer } from '../../src/lib/analyzer/types';

// The sweep is now the only thing that improves a document the reader can already read
// (research.md R18), and since ADR-0016 it is also the thing that has to survive being interrupted.
// These run it against a real database rather than a fake, because what is being checked is the
// part that persists.

const TEXT = '我在中国学习中文。他骑自行车去上班。今天天气很好！你是哪国人？';
const UNITS = unitBoundaries(TEXT, pairwise).length;

/** One unit per batch, and no waiting for a budget the test does not care about. */
const ONE_UNIT_AT_A_TIME = { budgetMs: 0, yieldToBrowser: () => Promise.resolve() };

describe('sweeping the library up to date', () => {
	let db: Database;
	let repository: Repository;
	let client: SweepStorage;

	beforeEach(async () => {
		db = await freshDatabase();
		repository = new Repository(db);
		client = {
			staleDocumentIds: async (name, version) => repository.staleDocumentIds(name, version),
			getDocument: async (id) => repository.getDocument(id),
			advanceUpgrade: async (id, batch, upgrade) => repository.advanceUpgrade(id, batch, upgrade)
		};
	});

	afterEach(() => db?.close());

	async function saveUnder(analyzer: Analyzer, text = TEXT) {
		const document = await pasteSource.ingest(text);
		const analyzed = await analyzer.analyze(document.rawContent);
		const tokens = resolveTokens(document.rawContent, analyzed, analyzer);
		return repository.saveDocument(document, tokens, stampOf(analyzer));
	}

	const always = () => true;

	it('brings a stale document all the way up to date, a batch at a time', async () => {
		const id = await saveUnder(characterSplitter);

		const outcome = await sweepStaleDocuments(client, pairwise, always, {
			batch: ONE_UNIT_AT_A_TIME
		});

		expect(outcome).toEqual({ rederived: 1, batches: UNITS, failed: 0 });

		const document = repository.getDocument(id);
		expect(document.analyzer).toBe(pairwise.name);
		expect(document.upgrade).toBeUndefined();
		expect(tiles(document.tokens, document.rawContent)).toBe(true);
	});

	it('keeps the batches it finished when it is stopped part-way, and resumes from there', async () => {
		const id = await saveUnder(characterSplitter);

		// Visibility lost after two batches — the ordinary way a phone interrupts this. Counted on
		// batches that actually landed rather than on calls to the predicate, which the sweep also
		// makes before it starts and before each document.
		let written = 0;
		const first = await sweepStaleDocuments(client, pairwise, () => written < 2, {
			batch: ONE_UNIT_AT_A_TIME,
			onAdvance: () => (written += 1)
		});
		expect(first.batches).toBe(2);
		expect(first.rederived).toBe(0);

		// The whole point of ADR-0016: what it did is still there, and it says how far it got.
		const halfway = repository.getDocument(id);
		expect(halfway.upgrade?.analyzer).toBe(pairwise.name);
		expect(halfway.upgrade?.through).toBeGreaterThan(0);
		expect(tiles(halfway.tokens, halfway.rawContent)).toBe(true);

		const second = await sweepStaleDocuments(client, pairwise, always, {
			batch: ONE_UNIT_AT_A_TIME
		});

		// Resumed rather than restarted: the two sweeps together do the work exactly once.
		expect(first.batches + second.batches).toBe(UNITS);
		expect(repository.getDocument(id).analyzer).toBe(pairwise.name);
	});

	it('says how far it has got after every batch, so a page being read can show it', async () => {
		const id = await saveUnder(characterSplitter);
		const advances: { documentId: number; through: number; of: number }[] = [];

		await sweepStaleDocuments(client, pairwise, always, {
			batch: ONE_UNIT_AT_A_TIME,
			onAdvance: (documentId, through, of) => advances.push({ documentId, through, of })
		});

		expect(advances).toHaveLength(UNITS);
		expect(advances.every((advance) => advance.documentId === id)).toBe(true);
		expect(advances.every((advance) => advance.of === codePointsOf(TEXT).length)).toBe(true);
		// Monotonic, and finishing at the end of the document.
		expect(advances.map((advance) => advance.through)).toEqual(
			[...advances.map((advance) => advance.through)].sort((a, b) => a - b)
		);
		expect(advances[advances.length - 1].through).toBe(codePointsOf(TEXT).length);
	});

	it('does not run at all in a copy that cannot write', async () => {
		await saveUnder(characterSplitter);

		const outcome = await sweepStaleDocuments(client, pairwise, () => false, {
			batch: ONE_UNIT_AT_A_TIME
		});

		expect(outcome).toEqual({ rederived: 0, batches: 0, failed: 0 });
	});

	it('reports a document it cannot upgrade and carries on with the rest', async () => {
		const broken = await saveUnder(characterSplitter);
		const fine = await saveUnder(characterSplitter);
		const failures: number[] = [];

		const refusing: SweepStorage = {
			...client,
			advanceUpgrade: async (id, batch, upgrade) => {
				if (id === broken) throw new Error('storage said no');
				return repository.advanceUpgrade(id, batch, upgrade);
			}
		};

		const outcome = await sweepStaleDocuments(refusing, pairwise, always, {
			batch: ONE_UNIT_AT_A_TIME,
			onFailure: (id) => failures.push(id)
		});

		expect(failures).toEqual([broken]);
		expect(outcome.failed).toBe(1);
		expect(outcome.rederived).toBe(1);
		expect(repository.getDocument(fine).analyzer).toBe(pairwise.name);
		// Left exactly as it was, which is a state it can be read in.
		expect(repository.getDocument(broken).analyzer).toBe(characterSplitter.name);
	});

	it('keeps every mark across an interruption and a resume', async () => {
		const id = await saveUnder(characterSplitter);
		const words = repository.getDocument(id).tokens.filter((token) => token.lexemeId !== undefined);
		const marked = [words[0], words[words.length - 1]];

		for (const token of marked) {
			repository.assertState(token.lexemeId!, 'learning', {
				documentId: id,
				fromOffset: token.start,
				toOffset: token.end
			});
		}
		const historyBefore = repository.readHistory();

		let written = 0;
		await sweepStaleDocuments(client, pairwise, () => written < 1, {
			batch: ONE_UNIT_AT_A_TIME,
			onAdvance: () => (written += 1)
		});
		await sweepStaleDocuments(client, pairwise, always, { batch: ONE_UNIT_AT_A_TIME });

		// Earned data, asserted exactly: nothing added, removed, altered or reattached.
		expect(repository.readHistory()).toEqual(historyBefore);
		const states = repository.getStates(marked.map((token) => token.lexemeId!));
		expect(states.size).toBe(2);
		for (const token of marked) expect(states.get(token.lexemeId!)?.state).toBe('learning');
	});
});

describe('choosing which document to upgrade next', () => {
	let db: Database;
	let repository: Repository;
	let client: SweepStorage;

	beforeEach(async () => {
		db = await freshDatabase();
		repository = new Repository(db);
		client = {
			staleDocumentIds: async (name, version) => repository.staleDocumentIds(name, version),
			getDocument: async (id) => repository.getDocument(id),
			advanceUpgrade: async (id, batch, upgrade) => repository.advanceUpgrade(id, batch, upgrade)
		};
	});

	afterEach(() => db?.close());

	async function saveUnder(analyzer: Analyzer, text = TEXT) {
		const document = await pasteSource.ingest(text);
		const analyzed = await analyzer.analyze(document.rawContent);
		const tokens = resolveTokens(document.rawContent, analyzed, analyzer);
		return repository.saveDocument(document, tokens, stampOf(analyzer));
	}

	it('does the document the reader is looking at first, whatever its place in the library', async () => {
		await saveUnder(characterSplitter);
		await saveUnder(characterSplitter);
		const reading = await saveUnder(characterSplitter);

		const order: number[] = [];
		await sweepStaleDocuments(client, pairwise, () => true, {
			batch: ONE_UNIT_AT_A_TIME,
			prefer: () => reading,
			onAdvance: (documentId) => {
				if (order[order.length - 1] !== documentId) order.push(documentId);
			}
		});

		expect(order[0]).toBe(reading);
		expect(order).toHaveLength(3);
	});

	it('falls back to library order when the reader is not reading anything', async () => {
		const first = await saveUnder(characterSplitter);
		await saveUnder(characterSplitter);

		const order: number[] = [];
		await sweepStaleDocuments(client, pairwise, () => true, {
			batch: ONE_UNIT_AT_A_TIME,
			prefer: () => undefined,
			onAdvance: (documentId) => {
				if (order[order.length - 1] !== documentId) order.push(documentId);
			}
		});

		expect(order[0]).toBe(first);
	});
});
