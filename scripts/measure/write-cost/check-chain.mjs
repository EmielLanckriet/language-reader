// Check and merge a chain fetched from Termux's /backup/chain with the app's own code (ADR-0048).
// usage: node scripts/measure/write-cost/check-chain.mjs <chain.json>
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';
const server = await createServer({
	root: new URL('../../../', import.meta.url).pathname,
	configFile: false,
	appType: 'custom',
	logLevel: 'error',
	server: { middlewareMode: true, hmr: false, ws: false }
});
const { open, openIncrement, mergeChain } = await server.ssrLoadModule('/src/lib/backup/format.ts');
const { base, increments } = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const body = await open(JSON.stringify(base));
const pieces = [];
for (const p of increments) pieces.push(await openIncrement(JSON.stringify(p)));
const merged = mergeChain(body, pieces);
const sizes = increments.map((p) => JSON.stringify(p).length);
console.log(
	'base',
	body.createdAt,
	'documents',
	body.documents.length,
	'encounters',
	body.encounters.length
);
console.log(
	'increments',
	pieces.length,
	'bytes',
	sizes,
	'rows',
	pieces.map((p) => p.encounters.length + p.events.length + p.statuses.length)
);
console.log(
	'merged',
	merged.createdAt,
	'documents',
	merged.documents.length,
	'encounters',
	merged.encounters.length,
	'states',
	merged.states.length
);
await server.close();
