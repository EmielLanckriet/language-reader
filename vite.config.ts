import { defineConfig } from 'vitest/config';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';

// GitHub Pages serves a project site from https://<user>.github.io/<repo>/, so every asset
// URL needs that prefix. It is empty for local development and for a user/organisation site.
// Set BASE_PATH in the deploy workflow rather than hard-coding a repository name here.
const base = process.env.BASE_PATH ?? '';

export default defineConfig({
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
			prerender: { entries: [] }
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
