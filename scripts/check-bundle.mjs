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

function everyFile(directory) {
	const found = [];
	for (const entry of readdirSync(directory)) {
		const path = join(directory, entry);
		if (statSync(path).isDirectory()) found.push(...everyFile(path));
		else found.push(path);
	}
	return found;
}

const files = everyFile(BUILD);
const problems = [];

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
			' src/lib/storage/db.ts. Only the storage worker may.'
	);
	process.exit(1);
}

console.log(`check-bundle: one copy of each SQLite artifact in ${BUILD}/`);
