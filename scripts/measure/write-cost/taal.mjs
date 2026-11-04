import { openApp, dictionaryAnalyzer, restoreLibrary } from '../../content-prototypes/lib/app.mjs';
const [backup, cache] = process.argv.slice(2);
const { load, close } = await openApp();
const { repository } = await restoreLibrary(load, backup, await dictionaryAnalyzer(load), cache);
for (const days of [1, 7, 30]) {
	const from = new Date(Date.now() - days * 86400e3).toISOString();
	const t = performance.now();
	repository.taalInputs(from);
	console.log(`taalInputs ${days} d: ${(performance.now() - t).toFixed(0)} ms`);
}
await close();
