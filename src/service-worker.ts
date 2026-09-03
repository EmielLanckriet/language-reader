/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />

/**
 * Keeping the application itself on the device.
 *
 * The reader's *data* has been on the device since slice 0, but the HTML, JavaScript and
 * WebAssembly were not — so restarting the phone and opening the application without a network
 * failed. Offline reading is a constitutional requirement rather than a convenience, and this file
 * is what makes it true.
 *
 * Written by hand, and short enough to read in one sitting. Workbox would generate this from
 * configuration; it was rejected because it is a dependency whose defaults would have to be
 * studied to know what the application does, and because what is actually needed is one `addAll`,
 * one cache sweep, and one cache-first handler.
 *
 * **The most important thing here is a line that is absent.** There is no `skipWaiting()` in the
 * install handler. Most examples include one, and it is precisely what FR-009 forbids: it replaces
 * the running application mid-session, which is a way to lose work. A new version installs, waits,
 * and does nothing until the reader asks for it. See contracts/service-worker.md.
 */

import { base, version } from '$service-worker';

// `self` is a ServiceWorkerGlobalScope here; TypeScript needs telling, since the ambient `self` in
// a DOM-typed project is a Window.
const worker = self as unknown as ServiceWorkerGlobalScope;

// Named for the build, so a new deployment writes a new cache and the old one is swept on
// activation rather than accumulating.
const CACHE = `language-reader-${version}`;

// What to precache is read from a manifest the build writes, rather than from `$service-worker`'s
// `build` and `files`.
//
// This is not fussiness. `build` omits `index.html` and omits everything Vite emits for a worker
// created with `new Worker(new URL(...))` — on this project, the application shell and the whole
// storage worker, 1.1 MB of it including the SQLite WebAssembly binary. Precaching `build` would
// have produced an application that caches its JavaScript, reports success, and cannot open a
// document offline. The manifest is generated from the build directory itself by
// scripts/precache-manifest.mjs, so it is what is deployed by construction.
const MANIFEST = `${base}/precache.json`;

// Where a navigation lands when the network is gone. This is the same shell 404.html already uses
// to make deep links work on a static host; here it makes them work with no host at all.
const SHELL = `${base}/index.html`;

worker.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			// Fetched past the HTTP cache: an old copy would describe a previous deployment, and
			// precaching a list of files that no longer exist fails installation for the wrong
			// reason.
			const response = await fetch(MANIFEST, { cache: 'no-store' });
			if (!response.ok) throw new Error(`precache manifest: ${response.status}`);
			const paths: string[] = await response.json();

			const cache = await caches.open(CACHE);
			// `addAll` rejects if any single request fails, and that rejection is wanted: it fails
			// the installation, so a half-cached version never becomes the live one. FR-007 asks
			// for exactly this — say so, rather than appear to succeed and fail later somewhere
			// unpredictable.
			await cache.addAll(paths.map((path) => `${base}${path}`));
		})()
	);
});

worker.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const name of await caches.keys()) {
				if (name !== CACHE) await caches.delete(name);
			}
			// Safe, and different in kind from `skipWaiting()`. Activation happens either on a
			// first install, when there is no running version to displace, or after the reader has
			// accepted a new one. In neither case does this replace anything behind their back.
			await worker.clients.claim();
		})()
	);
});

worker.addEventListener('fetch', (event) => {
	// Only GET is cacheable, and this application makes no other kind of request anyway.
	if (event.request.method !== 'GET') return;

	// Other origins are not ours to serve.
	const url = new URL(event.request.url);
	if (url.origin !== worker.location.origin) return;

	event.respondWith(respond(event.request));
});

async function respond(request: Request): Promise<Response> {
	const cache = await caches.open(CACHE);

	// Cache first. Everything in the precache is content-hashed by the build, so a cached entry is
	// never a stale version of something — a new build has new names and its own cache.
	const cached = await cache.match(request);
	if (cached) return cached;

	// A navigation is the case worth rescuing: the reader followed a link or reloaded on /read/3,
	// which was never a file on any server. Serving the cached shell lets the client router take it
	// from there.
	//
	// This covers a *failed* response as well as a thrown one, and the difference matters. Offline,
	// `fetch` throws. Online, a static host has no /read/3 to serve and answers 404 — GitHub Pages
	// happens to answer it with our own 404.html, which is the shell, but that is the host being
	// accommodating rather than us being correct. We have the shell; there is no reason to depend
	// on how a particular host answers for a file it does not have.
	try {
		const response = await fetch(request);
		if (response.ok || request.mode !== 'navigate') return response;
	} catch (error) {
		if (request.mode !== 'navigate') throw error;
	}

	const shell = await cache.match(SHELL);
	if (shell) return shell;

	// No shell cached and no network: nothing left to serve. app.html's own fallback markup is the
	// last word here, and it can only appear if some copy of the shell arrived from somewhere.
	return Response.error();
}

worker.addEventListener('message', (event) => {
	// Which build this worker is. Asked by the page before it offers an update, because a worker
	// waiting in the wings is not by itself proof there is anything new to move to: on a fresh
	// start with a network, the browser can fetch the new page and the new scripts directly, so
	// the reader is already running the new build while the old worker is still nominally in
	// charge and the new one queues behind it. Offering an update to the version already running
	// is worse than saying nothing, because it teaches the reader the notice means nothing.
	if (event.data?.type === 'which-version') {
		event.ports[0]?.postMessage(version);
		return;
	}

	// The one message this worker accepts, and only when the reader has asked for the new version
	// (FR-010). Nothing here decides to activate on its own.
	if (event.data?.type === 'skip-waiting') worker.skipWaiting();
});
