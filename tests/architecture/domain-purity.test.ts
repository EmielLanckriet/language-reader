import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Constitution Principle V.4: the code owning word state must not import a web framework or a
// storage layer. That boundary is what let the entire backend disappear in ADR-0007 without the
// data model moving, so it is worth more than an intention. A principle verified by a test is a
// principle; one verified by good intentions is a preference.

const DOMAIN = 'src/lib/domain';

const FORBIDDEN: { pattern: RegExp; why: string }[] = [
	{ pattern: /^svelte(\/|$)/, why: 'Svelte — the domain must not know how it is rendered' },
	{ pattern: /^@sveltejs\//, why: 'SvelteKit — same reason' },
	{ pattern: /^\$app\//, why: 'SvelteKit runtime modules' },
	{ pattern: /sqlite/i, why: 'SQLite — only src/lib/storage/ may know the database exists' },
	{ pattern: /(^|\/)storage(\/|$)/, why: 'the storage layer' },
	{ pattern: /^\$lib\/storage/, why: 'the storage layer' }
];

function typeScriptFilesUnder(dir: string): string[] {
	let found: string[] = [];
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) found = found.concat(typeScriptFilesUnder(path));
		else if (entry.endsWith('.ts')) found.push(path);
	}
	return found;
}

// Matches `import ... from 'x'`, `export ... from 'x'`, and `import('x')`.
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*)['"]([^'"]+)['"]/g;

function importsIn(source: string): string[] {
	return [...source.matchAll(SPECIFIER)].map((m) => m[1]);
}

describe('the domain core is isolated from delivery (Principle V.4)', () => {
	const files = typeScriptFilesUnder(DOMAIN);

	it('has domain files to check at all', () => {
		// Without this, an empty or renamed directory would make every assertion below vacuous
		// and the suite would report success for a boundary it never examined.
		expect(files.length).toBeGreaterThan(0);
	});

	it('imports no framework and no storage', () => {
		const violations: string[] = [];
		for (const file of files) {
			for (const specifier of importsIn(readFileSync(file, 'utf8'))) {
				for (const { pattern, why } of FORBIDDEN) {
					if (pattern.test(specifier)) violations.push(`${file} imports ${specifier} (${why})`);
				}
			}
		}
		expect(violations).toEqual([]);
	});
});
