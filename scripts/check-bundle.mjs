// Assert that the build ships exactly one copy of SQLite.
//
// It shipped two for the whole of slice 0 and nothing noticed, because nothing looks. The main
// thread does not run SQLite -- only the storage worker does -- but one value import of a
// persistence helper from db.ts pulled the entire WebAssembly bundle into the main-thread graph:
// 844 KB of .wasm, 206 KB of glue, 31 KB of proxy, fetched on every load and never executed.
//
// This matters more from slice 1 onward than it did before. The service worker precaches the whole
// build, so a duplicate is no longer a one-off download but a cost paid again on every install and
// every version change.
//
// Runs in postbuild, beside spa-fallback.mjs, so a regression fails the build rather than shipping.
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const BUILD = 'build';

// One entry per artifact that must be unique, with the pattern that identifies it. Deliberately
// literal: a clever generic rule would also match files we have not thought about.
const MUST_BE_UNIQUE = [
	{ what: 'the SQLite WebAssembly binary', matches: (name) => /^sqlite3[.-].*\.wasm$/.test(name) },
	{
		what: 'the OPFS async proxy',
		matches: (name) => /^sqlite3-opfs-async-proxy[.-].*\.js$/.test(name)
	}
];

function megabytes(bytes) {
	return (bytes / 1048576).toFixed(3);
}

function everyFile(directory) {
	const found = [];
	for (const entry of readdirSync(directory)) {
		const path = join(directory, entry);
		if (statSync(path).isDirectory()) found.push(...everyFile(path));
		else found.push(path);
	}
	return found;
}

// The install budget (FR-033/FR-034, ADR-0012).
//
// Slice 1 shipped 34 files and 1,472,106 bytes, and that was the reference the budget was first
// stated against. Slice 2 exceeds it deliberately, and FR-034 requires the reason to be written
// down rather than the ceiling quietly raised.
//
// **The justification.** Splitting Chinese into words needs a dictionary. `Intl.Segmenter` reads
// one out of the browser's own ICU and costs nothing, and on the reader's Android phone it is not
// there: the browser ships without the CJK dictionary data, returns one token per character,
// reports no error, and offers no way to ask (research.md R11). Measured on the device, not
// inferred. The zero-cost option therefore does not exist on the only device the constitution
// treats as the oracle, so the application carries its own word list.
//
// **What it costs, measured.** 120,176 CC-CEDICT headwords: 1.002 MB on disk, **0.432 MB gzipped
// over the wire**, which is what the reader actually downloads once and then has offline forever.
// Whole application: 2.412 MB on disk, about 1.46 MB over the wire against roughly 1.03 MB before.
// Headwords only -- the definitions are four times the size and segmentation does not need them,
// so they stay a slice-3 cost if slice 3 still wants them.
//
// The ceiling therefore moves to the sanctioned figure below rather than being removed. What it
// still catches is the thing it was built for: a second dictionary, or the full CC-CEDICT with
// glosses, arriving without a decision.
const SANCTIONED_INSTALL = { files: 37, bytes: 2529253 };

// Ten per cent, unchanged in spirit. Wide enough that ordinary code growth never trips it, and far
// narrower than anything this check exists to catch -- jieba's frequency dictionary alone would add
// another 1.6 MB gzipped.
const GROWTH_ALLOWED = 0.1;

const files = everyFile(BUILD);
const problems = [];

const totalBytes = files.reduce((sum, path) => sum + statSync(path).size, 0);
const ceiling = Math.round(SANCTIONED_INSTALL.bytes * (1 + GROWTH_ALLOWED));

if (totalBytes > ceiling) {
	const largest = files
		.map((path) => ({ path, size: statSync(path).size }))
		.sort((a, b) => b.size - a.size)
		.slice(0, 3);

	problems.push(
		`check-bundle: the install is ${megabytes(totalBytes)} MB across ${files.length} files,` +
			` over the ${megabytes(ceiling)} MB ceiling.\n` +
			`    The sanctioned install is ${megabytes(SANCTIONED_INSTALL.bytes)} MB in ${SANCTIONED_INSTALL.files} files.\n` +
			`    Largest files now:\n` +
			largest
				.map(({ path, size }) => `      ${megabytes(size)} MB  ${relative(BUILD, path)}`)
				.join('\n')
	);
}

for (const { what, matches } of MUST_BE_UNIQUE) {
	const hits = files.filter((path) => matches(path.split('/').pop()));
	if (hits.length === 1) continue;

	problems.push(
		hits.length === 0
			? `check-bundle: ${what} is missing from ${BUILD}/ entirely.`
			: `check-bundle: ${what} appears ${hits.length} times, and should appear once:\n` +
					hits.map((path) => `    ${relative(BUILD, path)}`).join('\n')
	);
}

if (problems.length > 0) {
	console.error(problems.join('\n\n'));
	console.error(
		'\nA second copy usually means something on the main thread imported from' +
			' src/lib/storage/db.ts. Only the storage worker may. An install over budget usually means' +
			' a segmentation candidate\u2019s dictionary reached the bundle: those belong in' +
			' scripts/compare-segmenters/, which never ships (ADR-0012).'
	);
	process.exit(1);
}

console.log(`check-bundle: one copy of each SQLite artifact in ${BUILD}/`);
console.log(
	`check-bundle: install is ${megabytes(totalBytes)} MB across ${files.length} files` +
		` (sanctioned: ${megabytes(SANCTIONED_INSTALL.bytes)} MB).`
);
