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
import { readdirSync, readFileSync, statSync } from 'node:fs';
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

// The install budget (FR-033/FR-034, ADR-0012, ADR-0015).
//
// **Measured against the precache list, not the build directory.** Those were the same thing until
// slice 2 put the ONNX runtime in the build and deliberately out of the install: 3.15 MB gzipped
// that is useless without a 98 MB model fetched on demand, so precaching it would more than double
// every install for a capability the reader may never turn on. What an install costs is what the
// service worker fetches before first use, which is exactly the precache list -- so that is what
// this measures. Counting the build directory would now report a cost nobody pays.
//
// Slice 1 shipped 34 files and 1,472,106 bytes, the reference the budget was first stated against.
// Slice 2 exceeds it deliberately, and FR-034 requires the reason written down rather than the
// ceiling quietly raised.
//
// **The justification.** Splitting Chinese into words needs a dictionary, and the browser's own
// (`Intl.Segmenter`) is absent on the reader's Android phone: it returns one token per character,
// reports no error, and offers no way to ask (research.md R11). Measured on the device. So the
// application carries CC-CEDICT's headwords -- 120,176 entries, 1.002 MB on disk, 0.432 MB gzipped
// over the wire -- and the definitions, four times that, are not shipped because segmentation does
// not read them.
//
// What this ceiling still catches is the thing it was built for: a second dictionary, the full
// CC-CEDICT with glosses, or the model itself arriving in the install without a decision.
const SANCTIONED_INSTALL = { files: 37, bytes: 2529253 };

// Ten per cent, unchanged in spirit: wide enough that ordinary code growth never trips it, far
// narrower than anything worth catching.
const GROWTH_ALLOWED = 0.1;

const files = everyFile(BUILD);
const problems = [];

// What the install actually fetches, read from the manifest the previous postbuild step wrote.
const precached = JSON.parse(readFileSync(join(BUILD, 'precache.json'), 'utf-8'));
const installedFiles = precached.map((path) => join(BUILD, path));
const totalBytes = installedFiles.reduce((sum, path) => sum + statSync(path).size, 0);
const ceiling = Math.round(SANCTIONED_INSTALL.bytes * (1 + GROWTH_ALLOWED));

if (totalBytes > ceiling) {
	const largest = installedFiles
		.map((path) => ({ path, size: statSync(path).size }))
		.sort((a, b) => b.size - a.size)
		.slice(0, 3);

	problems.push(
		`check-bundle: the install is ${megabytes(totalBytes)} MB across ${installedFiles.length} files,` +
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
const buildBytes = files.reduce((sum, path) => sum + statSync(path).size, 0);
console.log(
	`check-bundle: install is ${megabytes(totalBytes)} MB across ${installedFiles.length} precached ` +
		`files (sanctioned: ${megabytes(SANCTIONED_INSTALL.bytes)} MB); ` +
		`${megabytes(buildBytes)} MB sits in the build, the difference fetched on demand.`
);
