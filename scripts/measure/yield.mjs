// Does `await` between pieces of work let the event loop run anything else?
//
//   node scripts/measure/yield.mjs
//
// This is the evidence behind ADR-0016 cause 1 and research.md R20. `taggedAnalyzer.analyze`
// splits a document into chunks and awaits each one, which reads like thirty small pieces of work
// and is in fact one long one: `await` schedules a microtask, and a browser paints and dispatches
// input between *tasks*. The continuation runs inside the same task, so the task never ends and the
// page is frozen for the whole pass.
//
// Kept because the distinction is invisible in the code — the two loops below differ by one line —
// and because it cost a shipped slice's worth of confusion. A timer standing in for the paint that
// never happened.

function busy(ms) {
	const end = Date.now() + ms;
	while (Date.now() < end);
}

/** The shape of a tagger call: async, but its work is synchronous once it starts. */
async function tag() {
	busy(200);
	return 'B';
}

async function measure(label, loop) {
	let timerRan = false;
	setTimeout(() => (timerRan = true), 0);
	const started = Date.now();
	await loop();
	console.log(`${label}: ${Date.now() - started} ms of work, timer ran during it: ${timerRan}`);
}

await measure('await-only', async () => {
	for (let i = 0; i < 10; i++) await tag();
});

await measure('with yield', async () => {
	for (let i = 0; i < 10; i++) {
		await tag();
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
});
