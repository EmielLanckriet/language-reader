// Serve build/ under a base path, the way GitHub Pages does.
//
// `vite preview` mounts the output at / and only applies the base to page routes, so every asset
// 404s on a cold profile -- which is invisible if a service worker from an earlier visit is warm.
// Slice 1's quickstart says to serve *with* the base path for exactly this class of reason.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { gzipSync } from 'node:zlib';

// GitHub Pages gzips text-ish assets, and the earlier version of this server did not -- which is
// exactly how the model download shipped broken: `Content-Length` then describes the compressed
// transfer while `fetch` hands back the decompressed body, and the completeness check compared the
// two. Compressing here means a laptop pass can see that class of bug.
const COMPRESS = new Set([
	'.js',
	'.mjs',
	'.css',
	'.html',
	'.json',
	'.txt',
	'.svg',
	'.webmanifest',
	'.wasm'
]);

const ROOT = process.argv[2];
const BASE = process.argv[3] ?? '/language-reader';
const PORT = Number(process.argv[4] ?? 4175);

const TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript',
	'.mjs': 'text/javascript',
	'.css': 'text/css',
	'.json': 'application/json',
	'.txt': 'text/plain; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.wasm': 'application/wasm',
	'.webmanifest': 'application/manifest+json'
};

createServer((request, response) => {
	let path = decodeURIComponent(new URL(request.url, 'http://x').pathname);
	if (!path.startsWith(BASE)) {
		response.writeHead(404).end('outside base');
		return;
	}
	path = path.slice(BASE.length) || '/';

	let file = join(ROOT, path);
	if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
	// The SPA fallback the build writes, so deep links behave as they do in production.
	if (!existsSync(file)) file = join(ROOT, '404.html');
	if (!existsSync(file)) {
		response.writeHead(404).end('not found');
		return;
	}

	const extension = extname(file);
	const headers = { 'content-type': TYPES[extension] ?? 'application/octet-stream' };
	let body = readFileSync(file);
	if (COMPRESS.has(extension) && /\bgzip\b/.test(request.headers['accept-encoding'] ?? '')) {
		body = gzipSync(body);
		headers['content-encoding'] = 'gzip';
	}
	headers['content-length'] = String(body.byteLength);
	response.writeHead(200, headers);
	response.end(body);
}).listen(PORT, '127.0.0.1', () =>
	console.log(`serving ${ROOT} at http://127.0.0.1:${PORT}${BASE}/`)
);
