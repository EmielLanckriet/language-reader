// Put the ONNX runtime where the application can fetch it, and keep it out of the install.
//
// The contextual segmenter needs onnxruntime-web's WebAssembly build: 12.34 MB raw, 3.15 MB
// gzipped. That is more than twice the entire application, and it is useless without the 98 MB
// model, which is fetched on demand (ADR-0015). Precaching it would more than double every
// install for a capability the reader may never turn on.
//
// So it is served from our own origin -- same-origin, so the service worker can cache it properly
// rather than as an opaque cross-origin response -- and excluded from the precache list. It is
// fetched once, when the reader first asks for the better segmenter, and cached from then on.
//
// Copied at build time rather than imported, deliberately. Letting Vite emit it pulled in the
// 26.5 MB jsep variant and put it in the precache -- caught by the install budget, not by
// inspection.
//
// **Renamed on the way in, and this is load-bearing.** The runtime's loader is a `.mjs` file, and
// a static host that serves .mjs as application/octet-stream makes it unloadable: browsers enforce
// strict MIME checking on module scripts. Observed exactly that in local verification. Named .js
// here, and pointed at explicitly through the object form of `wasmPaths`, so no host's MIME table
// is in a position to break it.
//
//   node scripts/copy-ort-runtime.mjs

import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const FROM = 'node_modules/onnxruntime-web/dist';
const INTO = 'build/ort';

// The CPU-only pair, and nothing else. The dist directory carries WebGPU, WebGL, JSEP and
// asyncify variants totalling 125 MB; a phone running a small token-classification model wants
// none of them, and shipping the whole directory would be the duplicate-SQLite mistake again.
const NEEDED = [
	['ort-wasm-simd-threaded.wasm', 'ort-runtime.wasm'],
	['ort-wasm-simd-threaded.mjs', 'ort-runtime.js']
];

mkdirSync(INTO, { recursive: true });

let total = 0;
for (const [from, to] of NEEDED) {
	copyFileSync(join(FROM, from), join(INTO, to));
	total += statSync(join(INTO, to)).size;
}

console.log(
	`copy-ort-runtime: ${NEEDED.length} files, ${(total / 1048576).toFixed(2)} MB into ${INTO}/` +
		` (excluded from precache: fetched when the reader asks for the model)`
);
