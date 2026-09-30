import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const [datasetPath, candidatePath, ...extra] = process.argv.slice(2);
let server;
try {
	if (!datasetPath || extra.length)
		throw new Error('Usage: node scripts/fsrs/evaluate.mjs DATASET [CANDIDATE]');
	const root = fileURLToPath(new URL('../../', import.meta.url));
	server = await createServer({
		root,
		configFile: false,
		appType: 'custom',
		logLevel: 'error',
		server: { middlewareMode: true, watch: null, hmr: false, ws: false }
	});
	const { validateDataset, validateCandidate, evaluateDataset, TUNING_SCHEDULER } =
		await server.ssrLoadModule('/src/lib/domain/tuning.ts');
	const packageInfo = JSON.parse(
		await readFile(new URL('../../node_modules/ts-fsrs/package.json', import.meta.url), 'utf8')
	);
	if (`ts-fsrs@${packageInfo.version}` !== TUNING_SCHEDULER)
		throw new Error(
			'Scheduler version changed; update and validate the evaluation contract first.'
		);
	const data = JSON.parse(await readFile(datasetPath, 'utf8'));
	validateDataset(data);
	const baseline = evaluateDataset(data);
	const candidate = candidatePath
		? evaluateDataset(data, validateCandidate(JSON.parse(await readFile(candidatePath, 'utf8'))))
		: undefined;
	console.log(JSON.stringify({ baseline, ...(candidate ? { candidate } : {}) }, null, 2));
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
} finally {
	await server?.close();
}
