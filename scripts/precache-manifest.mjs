// List every file the deployment actually contains, for the service worker to precache.
//
// SvelteKit's `$service-worker` module offers `build` and `files`, and the obvious thing is to
// precache those. It is also wrong, and wrong in a way that looks fine: `build` covers the entry,
// routes, chunks and CSS, and covers neither `index.html` nor anything Vite emitted for a worker
// created with `new Worker(new URL(...))`. On this project that omits the application shell and the
// entire storage worker -- 1.1 MB of it, including the SQLite WebAssembly binary.
//
// The result would have been an application that caches its JavaScript, reports success, and then
// cannot open a document offline because the thing that reads the database was never stored. That
// is the slice 0 failure again in a different costume: works perfectly until the one condition it
// exists to handle.
//
// So the list is taken from the build directory itself, after the adapter has written it. It is
// exactly what is deployed, by construction, and stays correct when the build emits something new
// that nobody thought to add here.
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BUILD = 'build';
const MANIFEST = 'precache.json';

// The worker manages its own lifecycle and the manifest is fetched fresh at install, so neither
// belongs in a cache keyed to one version.
const EXCLUDED = new Set(['service-worker.js', MANIFEST]);

function everyFile(directory) {
	const found = [];
	for (const entry of readdirSync(directory)) {
		const path = join(directory, entry);
		if (statSync(path).isDirectory()) found.push(...everyFile(path));
		else found.push(path);
	}
	return found;
}

const paths = everyFile(BUILD)
	.map((path) => path.slice(BUILD.length)) // "/index.html", leading slash kept
	.filter((path) => !EXCLUDED.has(path.slice(1)))
	.sort();

writeFileSync(join(BUILD, MANIFEST), JSON.stringify(paths, null, '\t') + '\n');
console.log(`precache-manifest: ${paths.length} files listed in ${BUILD}/${MANIFEST}`);
