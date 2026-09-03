import { defineConfig } from 'vitest/config';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';

// GitHub Pages serves a project site from https://<user>.github.io/<repo>/, so every asset
// URL needs that prefix. It is empty for local development and for a user/organisation site.
// Set BASE_PATH in the deploy workflow rather than hard-coding a repository name here.
// Typed as SvelteKit types it: empty, or a leading-slash path such as '/language-reader'.
const base = (process.env.BASE_PATH ?? '') as '' | `/${string}`;

export default defineConfig({
	resolve: {
		// Keep onnxruntime-web's WebAssembly out of the bundle (ADR-0015).
		//
		// Without this condition the package resolves to its *bundled* build, and Vite emits the
		// 26.5 MB jsep variant as a hashed asset -- which then lands in the precache, more than
		// doubling every install for a runtime that is useless without a model fetched on demand.
		// Caught by the install budget rather than by inspection: the assumption that a dynamic
		// import would keep it out was simply wrong.
		//
		// With it, the runtime loads its WebAssembly from `ort.env.wasm.wasmPaths` at run time,
		// which is the copy scripts/copy-ort-runtime.mjs puts in build/ort/ and the precache
		// deliberately skips.
		conditions: ['onnxruntime-web-use-extern-wasm']
	},

	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// A single fallback page, not one prerendered page per route. Every route this app has
			// reads from the device's own database, so there is nothing for a build machine to
			// render: /read/[id] depends on a document that exists only on the reader's phone.
			adapter: adapter({ fallback: 'index.html' }),

			paths: { base },

			// Prerendering is off for the same reason. Left explicit rather than defaulted, so that
			// a later attempt to prerender a route fails loudly instead of shipping an empty page.
			prerender: { entries: [] },

			// Registered by hand in src/lib/ui/registerServiceWorker.ts rather than automatically.
			// FR-010 says the reader is told when a new version is ready and moves to it by an
			// explicit action, and that needs the ServiceWorkerRegistration object — specifically
			// its `waiting` worker, which is the one to activate. SvelteKit's automatic
			// registration does not hand it back.
			serviceWorker: { register: false }
		})
	],
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'unit',
					environment: 'node',
					// Tests live in tests/, mirroring src/lib/, per plan.md's project structure.
					include: ['tests/**/*.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
