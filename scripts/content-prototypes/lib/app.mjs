// The app's own storage, memory and analyzer code, loaded from Node (as scripts/fsrs does), so
// "due", "known" and "new" for a candidate text mean what they mean in Reader.
//
// restoreLibrary: a Reader backup restored into an in-memory database (Repository.restoreCopy),
// every document re-segmented (replaceTokens, which applies the reader's corrections), then
// rebuildMemory. scoreText: a candidate saved as an ordinary document in that database (no
// history, so no memory changes) and measured with domain/shares.ts as the library measures it.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const WEEK = 7 * 86_400_000;
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

export async function openApp() {
	const server = await createServer({
		root: ROOT,
		configFile: false,
		appType: 'custom',
		logLevel: 'error',
		resolve: {
			alias: { '$app/paths': fileURLToPath(new URL('./paths-stub.js', import.meta.url)) }
		},
		server: { middlewareMode: true, watch: null, hmr: false, ws: false }
	});
	const load = (path) => server.ssrLoadModule(path);
	return { load, close: () => server.close() };
}

/**
 * The shipped segmenter: src/lib/analyzer/bert-tagger.ts's tagging with onnxruntime-node instead of
 * onnxruntime-web, the same model file (Xenova/bert-base-chinese-ws, model_quantized.onnx, cached
 * by the segmenter comparison harness) and the app's vocabulary and decoding code.
 */
export async function bertAnalyzer(load) {
	const require = createRequire(new URL('../../measure/sensevoice/', import.meta.url));
	const ort = require('onnxruntime-node');
	const { taggedAnalyzer } = await load('/src/lib/analyzer/tagger.ts');
	const { parseVocabulary, encodeCharacters } = await load('/src/lib/analyzer/bert-tokenizer.ts');
	const { BERT_ANALYZER_VERSION } = await load('/src/lib/analyzer/bert-tagger.ts');
	const vocab = parseVocabulary(readFileSync(`${ROOT}static/bert-vocab-zh.txt`, 'utf8'));
	const model = `${ROOT}scripts/compare-segmenters/data/bert-ws-model_quantized.onnx`;
	if (!existsSync(model))
		throw new Error(`No segmenter model at ${model}: run scripts/compare-segmenters once.`);
	const session = await ort.InferenceSession.create(model, {
		graphOptimizationLevel: 'all',
		intraOpNumThreads: 2
	});
	const tagging = async (characters) => {
		const { inputIds, attentionMask, tokenTypeIds } = encodeCharacters(characters, vocab);
		const shape = [1, inputIds.length];
		const output = await session.run({
			input_ids: new ort.Tensor('int64', inputIds, shape),
			attention_mask: new ort.Tensor('int64', BigInt64Array.from(attentionMask), shape),
			token_type_ids: new ort.Tensor('int64', BigInt64Array.from(tokenTypeIds), shape)
		});
		const logits = output.logits.data;
		const labels = [];
		for (let i = 0; i < characters.length; i++) {
			const at = (i + 1) * 2;
			labels.push(logits[at] >= logits[at + 1] ? 'B' : 'I');
		}
		return labels;
	};
	return taggedAnalyzer(tagging, 'bert-ws-zh', BERT_ANALYZER_VERSION);
}

/**
 * The shipped segmenter's name and version without loading its model: enough to open a library
 * cached by restoreLibrary, which is all a run that splits its texts with the dictionary needs.
 */
export async function bertStamp(load) {
	const { BERT_ANALYZER_VERSION } = await load('/src/lib/analyzer/bert-tagger.ts');
	return {
		name: 'bert-ws-zh',
		version: BERT_ANALYZER_VERSION,
		analyze() {
			throw new Error('Restore the library with check-library.mjs first.');
		}
	};
}

/** The dictionary analyzer every import starts with (fallbackAnalyzer in analyzer/active.ts). */
export async function dictionaryAnalyzer(load) {
	const { dictionaryAnalyzer } = await load('/src/lib/analyzer/dictionary.ts');
	const { parseWordList } = await load('/src/lib/analyzer/wordlist.ts');
	const words = parseWordList(readFileSync(`${ROOT}static/wordlist-zh.txt`, 'utf8'));
	return dictionaryAnalyzer(async () => words);
}

/**
 * The reader's library from a backup, segmented by `analyzer`. With `cache`, the resulting
 * database is written there and reused when the backup and analyzer are the same.
 */
export async function restoreLibrary(load, backupPath, analyzer, cache) {
	const { loadSqlite, applyMigrations } = await load('/src/lib/storage/db.ts');
	const { Repository } = await load('/src/lib/storage/repository.ts');
	const { open } = await load('/src/lib/backup/format.ts');
	const { resolveTokens, stampOf } = await load('/src/lib/analyzer/resolve.ts');
	const sqlite3 = await loadSqlite();
	const text = readFileSync(backupPath, 'utf8');
	const key = `${analyzer.name}@${analyzer.version}|${text.length}|${JSON.parse(text).integrity}`;
	const db = new sqlite3.oo1.DB(':memory:', 'c');
	if (
		cache &&
		existsSync(cache) &&
		existsSync(`${cache}.key`) &&
		readFileSync(`${cache}.key`, 'utf8') === key
	) {
		const bytes = new Uint8Array(readFileSync(cache));
		const p = sqlite3.wasm.allocFromTypedArray(bytes);
		const rc = sqlite3.capi.sqlite3_deserialize(
			db.pointer,
			'main',
			p,
			bytes.length,
			bytes.length,
			sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE
		);
		if (rc) throw new Error(`deserialize failed: ${rc}`);
		return { db, repository: new Repository(db), sqlite3, fromCache: true };
	}
	applyMigrations(db);
	const repository = new Repository(db);
	repository.restoreCopy(await open(text));
	for (const { id } of repository.listDocuments()) {
		const document = repository.getDocument(id);
		const tokens = resolveTokens(
			document.rawContent,
			await analyzer.analyze(document.rawContent),
			analyzer
		);
		repository.replaceTokens(id, tokens, stampOf(analyzer));
	}
	repository.rebuildMemory();
	if (cache) {
		writeFileSync(cache, sqlite3.capi.sqlite3_js_db_export(db));
		writeFileSync(`${cache}.key`, key);
	}
	return { db, repository, sqlite3, fromCache: false };
}

/** What a candidate text is measured against: everything that does not depend on the text. */
export async function scorer(load, db, repository, analyzer, now = new Date()) {
	const { queryRows } = await load('/src/lib/storage/db.ts');
	const { ENCOUNTERED_WORDS } = await load('/src/lib/storage/repository.ts');
	const { textShares, wordCounts, understood, kindOf } = await load('/src/lib/domain/shares.ts');
	const { isActive } = await load('/src/lib/domain/queue.ts');
	const { recall } = await load('/src/lib/domain/memory.ts');
	const { resolveTokens, stampOf } = await load('/src/lib/analyzer/resolve.ts');
	// Never encountered: not in any read/played/lookup/check range, no Anki example, no mark, no
	// encounter naming it (a Cards review, a drill) and no memory. The memory rows matter: a word
	// reviewed on Cards whose library tokens all split differently is still not new to the reader.
	const encountered = new Set(
		queryRows(
			db,
			`${ENCOUNTERED_WORDS} UNION SELECT lexeme_id FROM status_event
       UNION SELECT lexeme_id FROM encounter WHERE lexeme_id IS NOT NULL
       UNION SELECT lexeme_id FROM memory`
		).map((r) => Number(r.lexeme_id))
	);
	const surfaceOf = (ids) =>
		new Map(
			ids.length === 0
				? []
				: queryRows(
						db,
						`SELECT id, surface FROM lexeme WHERE id IN (${ids.map(() => '?').join(',')})`,
						ids
					).map((r) => [Number(r.id), String(r.surface)])
		);

	/** The words due now, as Cards and the library count them (wordCounts). */
	function dueWords() {
		const ids = queryRows(db, `SELECT DISTINCT lexeme_id FROM memory WHERE skill='reading'`).map(
			(r) => Number(r.lexeme_id)
		);
		const states = repository.getStates(ids);
		const { memory, parameters } = repository.getMemory(ids);
		const surfaces = surfaceOf(ids);
		const due = [];
		for (const id of ids) {
			const reading = memory.get(id)?.reading;
			if (!reading || states.get(id)?.state === 'ignored') continue;
			if (isActive(reading) && Date.parse(reading.due) <= now.getTime())
				due.push({
					id,
					surface: surfaces.get(id),
					due: reading.due,
					recall: recall(reading, now, parameters)
				});
		}
		return due.sort((a, b) => a.due.localeCompare(b.due));
	}

	/** Words the library counts as known (kindOf), with no memory needed: for prompts. */
	function knownWords() {
		const ids = queryRows(
			db,
			`SELECT lexeme_id FROM memory WHERE skill='reading' UNION SELECT lexeme_id FROM word_state`
		).map((r) => Number(r.lexeme_id));
		const states = repository.getStates(ids);
		const { memory, parameters } = repository.getMemory(ids);
		const surfaces = surfaceOf(ids);
		return ids
			.filter(
				(id) => kindOf(states.get(id)?.state, memory.get(id)?.reading, now, parameters) === 'known'
			)
			.map((id) => surfaces.get(id))
			.filter((s) => s && /\p{Script=Han}/u.test(s));
	}

	async function score(text, title = 'candidate') {
		const tokens = resolveTokens(text, await analyzer.analyze(text), analyzer);
		const id = repository.saveDocument(
			{ rawContent: text, contentType: 'text/plain', language: 'zh', title },
			tokens,
			stampOf(analyzer)
		);
		const words = repository.wordOccurrences([id]).get(id) ?? new Map();
		const lines = repository.wordLines([id]).get(id) ?? new Map();
		const ids = [...words.keys()];
		const states = repository.getStates(ids);
		const { memory, parameters, noise } = repository.getMemory(ids);
		const surfaces = surfaceOf(ids);
		const shares = textShares(words, states, memory, now, parameters);
		const counts = wordCounts(words, lines, states, memory, now, parameters);
		const share = understood(words, states, memory, now, parameters, noise);
		const due = [];
		/** Not due now but within 7 days: what watching this week would also serve. */
		const dueWeek = [];
		const neverMet = [];
		const setAside = [];
		let running = 0;
		let neverMetRunning = 0;
		for (const [lexeme, n] of words) {
			const reading = memory.get(lexeme)?.reading;
			if (states.get(lexeme)?.state === 'ignored') continue;
			running += n;
			if (reading && isActive(reading) && Date.parse(reading.due) <= now.getTime())
				due.push([surfaces.get(lexeme), n]);
			else if (reading && isActive(reading) && Date.parse(reading.due) <= now.getTime() + WEEK)
				dueWeek.push([surfaces.get(lexeme), n]);
			if (reading?.setAside) setAside.push([surfaces.get(lexeme), n]);
			else if (!encountered.has(lexeme)) {
				neverMet.push([surfaces.get(lexeme), n]);
				neverMetRunning += n;
			}
		}
		const byCount = (a, b) => b[1] - a[1];
		return {
			runningWords: running,
			distinctWords: ids.length,
			known: shares?.known,
			learning: shares?.learning,
			fresh: shares?.fresh,
			understood: share,
			dueCount: counts.due,
			dueOccurrences: counts.dueOccurrences,
			due: due.sort(byCount),
			dueWeek: dueWeek.sort(byCount),
			neverMetCount: neverMet.length,
			neverMetShare: running ? neverMetRunning / running : undefined,
			neverMet: neverMet.sort(byCount),
			setAside: setAside.sort(byCount),
			documentId: id
		};
	}

	return { score, dueWords, knownWords, encountered };
}
