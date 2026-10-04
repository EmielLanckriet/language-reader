import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// Fit personal FSRS parameters to a learning-data export (spec 013): prints the report, and with
// --out writes the fitted set for Reader to import. See README.md.
const args = process.argv.slice(2);
const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : undefined;
const [datasetPath, ...extra] = args.filter((a, i) => a !== '--out' && args[i - 1] !== '--out');
let server;
try {
	if (!datasetPath || extra.length)
		throw new Error('Usage: node scripts/fsrs/fit.mjs DATASET [--out SET.json]');
	const root = fileURLToPath(new URL('../../', import.meta.url));
	server = await createServer({
		root,
		configFile: false,
		appType: 'custom',
		logLevel: 'error',
		server: { middlewareMode: true, watch: null, hmr: false, ws: false }
	});
	const { fitDataset } = await server.ssrLoadModule('/src/lib/domain/fit.ts');
	const { TUNING_SCHEDULER } = await server.ssrLoadModule('/src/lib/domain/tuning.ts');
	const packageInfo = JSON.parse(
		await readFile(new URL('../../node_modules/ts-fsrs/package.json', import.meta.url), 'utf8')
	);
	if (`ts-fsrs@${packageInfo.version}` !== TUNING_SCHEDULER)
		throw new Error('Scheduler version changed; check fsrs6.ts against it first.');
	const data = JSON.parse(await readFile(datasetPath, 'utf8'));
	const started = performance.now();
	const { set, report } = fitDataset(data);
	const seconds = Math.round((performance.now() - started) / 100) / 10;
	if (out) await writeFile(out, JSON.stringify(set, null, 2));
	console.log(JSON.stringify({ seconds, report, set: out ? out : set }, null, 2));
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
} finally {
	await server?.close();
}
