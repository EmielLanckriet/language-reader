// Candidate: `bert-ws-zh`, the contextual segmentation model the application actually ships
// (ADR-0015). Every other candidate in this directory was tried and rejected on the reader's own
// material; this is the one the harness must be able to compare *against*, or the slice's
// conclusion (T039) has nothing to point to.
//
// **This is a reimplementation, not the shipped code.** It is written to mirror
// `src/lib/analyzer/bert-tokenizer.ts`, `src/lib/analyzer/tagger.ts` and
// `src/lib/analyzer/bert-tagger.ts` as they read on the date this file was written (2026-09-03), but
// this file cannot import them — they are TypeScript with extensionless imports, and this harness is
// plain .mjs, deliberately outside `src/` (ADR-0012). Nothing enforces the two staying in step: if
// those three files change and this candidate is not updated to match, it quietly stops measuring
// what the application actually ships, and any conclusion drawn about "the shipped analyzer" would
// be about something else. Whoever next changes them should re-check this candidate by hand; there
// is no test that would catch drift between the two, the same risk named for `intl-segmenter.mjs`.
//
// What is mirrored, deliberately:
//   - one input id per character — `[CLS]` + one id per character (unknown characters become
//     `[UNK]`, never dropped) + `[SEP]` — because dropping a character shifts every later tag onto
//     the wrong character (bert-tokenizer.ts).
//   - input tensors as BigInt64Array (`input_ids`, `attention_mask`, `token_type_ids`) — the model
//     was exported expecting int64, and a Float32 or Int32 tensor of the same shape would either be
//     rejected by the runtime or silently misread.
//   - decoding: two logits per position, index 0 is B and index 1 is I; a position begins a new word
//     when `i === 0 || tag !== 'I'` — the `i === 0` clause is load-bearing, because the quantised
//     model really does sometimes answer 'I' for the first character of a chunk, and without this
//     clause the first token in that chunk would have no start (tagger.ts).
//   - chunking at 500 characters (`LONGEST_RUN` in tagger.ts) — the model sees 512 positions
//     including its own two markers, and a chunk boundary always starts a new word, because a
//     boundary the model cannot see across is a boundary it may get wrong regardless.
//   - non-Han runs (whitespace, punctuation the unit-splitter left inside the unit, digits, Latin
//     text) are tiled as single unmarkable tokens and never sent to the model — they are not its
//     vocabulary, and sending them would spend sequence budget on text the model was not trained to
//     tag.
//
// Data: the model (Xenova/bert-base-chinese-ws, quantised ONNX export, ~98 MB) and its vocabulary
// (21,128 entries), both fetched at run time and cached in data/ (never committed, never bundled —
// ADR-0012). The vocabulary is fetched from the same source the application's own
// `scripts/build-bert-vocab.mjs` fetches from, rather than read from the application's committed
// `static/bert-vocab-zh.txt`: that file is a build artefact this harness does not generate, and
// depending on it would make this harness break for a non-obvious reason (or silently drift) if it
// were regenerated or removed. Fetching the same upstream source keeps this candidate's data
// provenance self-contained, the same way every other candidate fetches its own dictionary.
//
// Unlike the other two dictionary candidates, `segmentUnit` here is `async` — model inference is
// inherently asynchronous, and `run.mjs` awaits every candidate's result to accommodate it.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DATA_DIR } from '../lib/fetch-data.mjs';
import { codePointsOf } from '../lib/offsets.mjs';

export const id = 'bert-ws';
export const label = 'bert-ws-zh (shipped, contextual segmentation model)';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..');

const MODEL_URL =
	'https://huggingface.co/Xenova/bert-base-chinese-ws/resolve/main/onnx/model_quantized.onnx';
const VOCAB_URL = 'https://huggingface.co/Xenova/bert-base-chinese-ws/resolve/main/vocab.txt';

const MODEL_CACHE_NAME = 'bert-ws-model_quantized.onnx';
const VOCAB_CACHE_NAME = 'bert-ws-vocab.txt';

// bert-base-chinese's vocabulary size. Asserted, not assumed, matching
// scripts/build-bert-vocab.mjs exactly: pairing this model's ids with a vocabulary of a different
// size produces confident nonsense rather than an error, so the mismatch has to be caught here
// rather than downstream.
const EXPECTED_VOCAB_ENTRIES = 21128;

// The model sees 512 positions including its own [CLS] and [SEP] markers; 500 leaves comfortable
// room. Copied from tagger.ts's LONGEST_RUN.
const LONGEST_RUN = 500;

function isHan(character) {
	return /\p{Script=Han}/u.test(character);
}

/**
 * Download a binary file to `data/<cacheFileName>`, reporting progress as it goes — this one file
 * is ~98 MB, long enough on an ordinary connection that a silent hang looks like a hung process. If
 * a cached copy already exists, the network is not touched at all.
 */
async function fetchBinaryCached(url, cacheFileName) {
	mkdirSync(DATA_DIR, { recursive: true });
	const cachePath = join(DATA_DIR, cacheFileName);
	if (existsSync(cachePath)) return cachePath;

	let response;
	try {
		response = await fetch(url, { signal: AbortSignal.timeout(600_000) });
	} catch (cause) {
		throw new Error(`could not reach ${url}: ${cause.message}`, { cause });
	}
	if (!response.ok) {
		throw new Error(`${url} responded ${response.status} ${response.statusText}`);
	}

	const totalBytes = Number(response.headers.get('content-length') ?? 0);
	const chunks = [];
	let receivedBytes = 0;
	let lastReportedPercent = -1;

	for await (const chunk of response.body) {
		chunks.push(chunk);
		receivedBytes += chunk.length;

		// Reported once per whole percentage point, not once per chunk (which arrives in pieces far
		// smaller than 1 MB) — otherwise this loop writes thousands of lines for one 98 MB download,
		// which buries the signal ("is this progressing?") in noise rather than showing it.
		const percent = totalBytes > 0 ? Math.floor((receivedBytes / totalBytes) * 100) : 0;
		if (percent !== lastReportedPercent) {
			lastReportedPercent = percent;
			const receivedMb = (receivedBytes / 1_000_000).toFixed(1);
			if (totalBytes > 0) {
				const totalMb = (totalBytes / 1_000_000).toFixed(1);
				process.stdout.write(
					`\r  bert-ws: downloading model ${receivedMb}/${totalMb} MB (${percent}%)`
				);
			} else {
				process.stdout.write(`\r  bert-ws: downloading model ${receivedMb} MB`);
			}
		}
	}
	process.stdout.write('\n');

	writeFileSync(cachePath, Buffer.concat(chunks));
	return cachePath;
}

async function fetchTextCached(url, cacheFileName) {
	mkdirSync(DATA_DIR, { recursive: true });
	const cachePath = join(DATA_DIR, cacheFileName);
	if (existsSync(cachePath)) return readFileSync(cachePath, 'utf-8');

	let response;
	try {
		response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
	} catch (cause) {
		throw new Error(`could not reach ${url}: ${cause.message}`, { cause });
	}
	if (!response.ok) {
		throw new Error(`${url} responded ${response.status} ${response.statusText}`);
	}

	const text = await response.text();
	writeFileSync(cachePath, text, 'utf-8');
	return text;
}

/**
 * Parse the model's vocabulary: one token per line, its line number is its id. Matches
 * `parseVocabulary` in bert-tokenizer.ts and the assertions `scripts/build-bert-vocab.mjs` makes
 * before committing this same file for the application to use.
 */
function parseVocabulary(text) {
	const lines = text
		.split('\n')
		.filter((line, index, all) => line !== '' || index < all.length - 1);

	if (lines.length !== EXPECTED_VOCAB_ENTRIES) {
		throw new Error(`expected ${EXPECTED_VOCAB_ENTRIES} vocabulary entries, found ${lines.length}`);
	}
	for (const [token, expectedId] of [
		['[UNK]', 100],
		['[CLS]', 101],
		['[SEP]', 102]
	]) {
		if (lines[expectedId] !== token) {
			throw new Error(`expected ${token} at id ${expectedId}, found "${lines[expectedId]}"`);
		}
	}

	const vocabulary = new Map();
	for (let vocabularyId = 0; vocabularyId < lines.length; vocabularyId++) {
		// First occurrence wins, matching how the model's own tokenizer reads this file.
		if (!vocabulary.has(lines[vocabularyId])) vocabulary.set(lines[vocabularyId], vocabularyId);
	}
	return vocabulary;
}

/** [CLS] + one id per character (unknown characters become [UNK]) + [SEP] — bert-tokenizer.ts. */
function encodeCharacters(characters, vocabulary) {
	const unknownId = vocabulary.get('[UNK]') ?? 100;
	const ids = [
		vocabulary.get('[CLS]') ?? 101,
		...characters.map((character) => vocabulary.get(character) ?? unknownId),
		vocabulary.get('[SEP]') ?? 102
	];

	return {
		inputIds: BigInt64Array.from(ids.map((tokenId) => BigInt(tokenId))),
		attentionMask: BigInt64Array.from(ids.map(() => 1n)),
		tokenTypeIds: BigInt64Array.from(ids.map(() => 0n))
	};
}

/**
 * Configure onnxruntime-web to run under Node rather than a browser, and load the quantised model.
 *
 * Mirrors bert-tagger.ts's `openSession`: wasm execution provider, one thread (there are no
 * COOP/COEP headers to make threaded WASM possible here either, and this only ever runs once per
 * harness invocation so the cost of single-threading is not worth avoiding), and the runtime's own
 * WASM binaries located explicitly on disk rather than left to the default CDN-relative lookup the
 * browser build assumes.
 */
async function openSession(modelPath) {
	const ort = await import('onnxruntime-web/wasm');

	const wasmDir = join(REPO_ROOT, 'node_modules', 'onnxruntime-web', 'dist');
	ort.env.wasm.wasmPaths = `${wasmDir}/`;
	ort.env.wasm.numThreads = 1;

	const bytes = readFileSync(modelPath);
	const session = await ort.InferenceSession.create(new Uint8Array(bytes), {
		executionProviders: ['wasm'],
		graphOptimizationLevel: 'all'
	});
	return { ort, session };
}

export async function prepare() {
	const vocabularyText = await fetchTextCached(VOCAB_URL, VOCAB_CACHE_NAME);
	const vocabulary = parseVocabulary(vocabularyText);

	const modelPath = await fetchBinaryCached(MODEL_URL, MODEL_CACHE_NAME);
	const { ort, session } = await openSession(modelPath);

	/** One tagging call: characters in, one 'B'/'I' answer per character out. */
	async function tag(characters) {
		const { inputIds, attentionMask, tokenTypeIds } = encodeCharacters(characters, vocabulary);
		const shape = [1, inputIds.length];

		const output = await session.run({
			input_ids: new ort.Tensor('int64', inputIds, shape),
			attention_mask: new ort.Tensor('int64', attentionMask, shape),
			token_type_ids: new ort.Tensor('int64', tokenTypeIds, shape)
		});

		const logits = output.logits.data;
		const labels = [];
		// Two labels per position: index 0 is B, index 1 is I. The first and last positions are the
		// model's own [CLS]/[SEP] markers and are skipped, so answer i belongs to character i.
		for (let i = 0; i < characters.length; i++) {
			const at = (i + 1) * 2;
			labels.push(logits[at] >= logits[at + 1] ? 'B' : 'I');
		}
		return labels;
	}

	return {
		async segmentUnit(unitText) {
			const characters = codePointsOf(unitText);
			const tokens = [];
			let at = 0;

			while (at < characters.length) {
				// Everything that is not Chinese is tiled as a single unmarkable run, and is never
				// sent to the model: it is not vocabulary, and it would spend sequence budget the
				// model needs for the text that is (tagger.ts).
				if (!isHan(characters[at])) {
					let end = at;
					while (end < characters.length && !isHan(characters[end])) end += 1;
					tokens.push({
						start: at,
						end,
						text: characters.slice(at, end).join(''),
						isWord: false
					});
					at = end;
					continue;
				}

				let runEnd = at;
				while (runEnd < characters.length && isHan(characters[runEnd])) runEnd += 1;

				// One run of Chinese, in chunks the model can actually see.
				for (let from = at; from < runEnd; from += LONGEST_RUN) {
					const to = Math.min(from + LONGEST_RUN, runEnd);
					const chunk = characters.slice(from, to);
					const labels = await tag(chunk);

					for (let i = 0; i < chunk.length; i++) {
						// A word begins here if the model says so — and always at the start of a
						// chunk, whatever it says. 'I' on the first character would otherwise
						// continue a word that does not exist, and the quantised model does
						// occasionally say exactly that.
						const begins = i === 0 || labels[i] !== 'I';
						if (begins) {
							tokens.push({ start: from + i, end: from + i + 1, text: chunk[i], isWord: true });
						} else {
							const previous = tokens[tokens.length - 1];
							previous.end = from + i + 1;
							previous.text += chunk[i];
						}
					}
				}

				at = runEnd;
			}

			assertTilesExactly(tokens, characters.length, unitText);
			return tokens;
		}
	};
}

/**
 * A decoder bug here shows up as plausible-looking output — a shifted or dropped character reads as
 * a slightly different, still-fluent segmentation, not as an obvious crash. So tiling is checked
 * explicitly rather than trusted: tokens must be contiguous, in order, with no gap and no overlap,
 * and must cover the whole unit from 0 to its code-point length.
 */
function assertTilesExactly(tokens, unitLength, unitText) {
	let expectedStart = 0;
	for (const token of tokens) {
		if (token.start !== expectedStart) {
			throw new Error(
				`bert-ws: tokens do not tile "${unitText}" — expected a token starting at ` +
					`${expectedStart}, found one starting at ${token.start}`
			);
		}
		if (token.end <= token.start) {
			throw new Error(`bert-ws: token with non-positive length at ${token.start} in "${unitText}"`);
		}
		expectedStart = token.end;
	}
	if (expectedStart !== unitLength) {
		throw new Error(
			`bert-ws: tokens cover [0, ${expectedStart}) but "${unitText}" has ${unitLength} characters`
		);
	}
}
