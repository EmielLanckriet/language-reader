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

// The install budget (slice 2, FR-033/FR-034, ADR-0012).
//
// Measured on 2026-09-02, from the last build of slice 1 exactly as it shipped. This is the figure
// the spec's budget is stated *relative to*: not an absolute size anyone chose, but what the
// application actually weighed once it was installable and offline.
const SLICE_1_INSTALL = { files: 34, bytes: 1472106 };

// Ten per cent. The number is not arbitrary: it is wide enough that ordinary code growth never
// trips it, and far narrower than the smallest thing this check exists to catch. Every candidate
// segmenter that is not the browser's own needs reference data -- CC-CEDICT is 3.97 MB gzipped,
// jieba's frequency dictionary 5.07 MB raw -- so a dictionary reaching the bundle shows up as
// +140% or worse, not +11%. The gap between "a few more kilobytes of JavaScript" and "a dictionary
// got in" is two orders of magnitude, and any threshold in between would do.
//
// This matters because the service worker precaches the whole build. A data file that leaks in is
// not a lazy cost paid by whoever needs it; it is downloaded by every install, for ever.
const GROWTH_ALLOWED = 0.1;

const files = everyFile(BUILD);
const problems = [];

const totalBytes = files.reduce((sum, path) => sum + statSync(path).size, 0);
const ceiling = Math.round(SLICE_1_INSTALL.bytes * (1 + GROWTH_ALLOWED));

if (totalBytes > ceiling) {
	const largest = files
		.map((path) => ({ path, size: statSync(path).size }))
		.sort((a, b) => b.size - a.size)
		.slice(0, 3);

	problems.push(
		`check-bundle: the install is ${megabytes(totalBytes)} MB across ${files.length} files,` +
			` over the ${megabytes(ceiling)} MB ceiling.\n` +
			`    Slice 1 shipped ${megabytes(SLICE_1_INSTALL.bytes)} MB in ${SLICE_1_INSTALL.files} files.\n` +
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
		` (slice 1 shipped ${megabytes(SLICE_1_INSTALL.bytes)} MB).`
);
