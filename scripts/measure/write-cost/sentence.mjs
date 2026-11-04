// cardSentence for 200 of today's cards, timed: the other storage call between two grades.
import { openApp, dictionaryAnalyzer, restoreLibrary } from '../../content-prototypes/lib/app.mjs';
const [backup, cache] = process.argv.slice(2);
const { load, close } = await openApp();
const { repository } = await restoreLibrary(load, backup, await dictionaryAnalyzer(load), cache);
const today = repository.cardsToday(50);
const ids = [...today.queue.due, ...today.queue.fresh].slice(0, 200);
const ms = ids
	.map((id) => {
		const t = performance.now();
		repository.cardSentence(id);
		return performance.now() - t;
	})
	.sort((a, b) => a - b);
console.log(
	`${ms.length} cardSentence: median ${ms[ms.length >> 1].toFixed(1)} ms, p90 ${ms[Math.floor(ms.length * 0.9)].toFixed(1)} ms, max ${ms.at(-1).toFixed(1)} ms; queue due ${today.queue.due.length} fresh ${today.queue.fresh.length}`
);
await close();
