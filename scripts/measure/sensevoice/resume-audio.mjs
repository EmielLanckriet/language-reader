// Compare the actual app audio pipeline on a phone, before involving the speech model.
// The fromBeginning control overrides only the private mid-file seek in the bundled probe;
// it does not change application code. Use a >178 s AAC-LC MP4 to reproduce window 5.
import { build } from 'vite';
import { writeFileSync, readFileSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const [media, output] = process.argv.slice(2);
if (!media || !output)
	throw new Error(
		'Usage: node scripts/measure/sensevoice/resume-audio.mjs <video.mp4> <results.json>'
	);
const clip = resolve(media),
	results = resolve(output);
if (!readFileSync(clip).length) throw new Error('Empty media file');
const root = mkdtempSync('/tmp/reader-resume-probe-');
writeFileSync(
	join(root, 'entry.ts'),
	`export {SpeechAudio} from '${repo}/src/lib/speech/audio.ts'; export {windowPlan} from '${repo}/src/lib/speech/windows.ts';`
);
await build({
	configFile: false,
	logLevel: 'error',
	build: {
		outDir: join(root, 'dist'),
		lib: { entry: join(root, 'entry.ts'), formats: ['es'], fileName: 'probe' },
		minify: false
	}
});
const worker = String.raw`
import { SpeechAudio, windowPlan } from '/probe.js';
try {
	const video = await (await fetch('/clip.mp4')).blob();
	const straight = await SpeechAudio.open(video);
	if (typeof straight === 'string') throw Error(straight);
	const plan = windowPlan(straight.duration);
	if (plan.length < 7)
		throw Error('Use a video longer than 178 seconds for windows 5 and 6');
	const baseline = [];
	for (const w of plan) {
		await fetch('/progress', { method: 'POST', body: 'baseline ' + w.start });
		baseline.push(
			await Promise.race([
				straight.window(w.start, w.end),
				new Promise((_, reject) =>
					setTimeout(
						() =>
							reject(
								Error(
									'decode timeout ' +
										JSON.stringify({
											start: w.start,
											next: straight.next,
											decoded: straight.decoded,
											base: straight.base,
										}),
								),
							),
						10000,
					),
				),
			]),
		);
	}
	straight.close();
	const rows = [];
	for (const [start, fromBeginning] of [
		[5, false],
		[5, true],
		[5, true],
	]) {
		const resumed = await SpeechAudio.open(video);
		if (typeof resumed === 'string') throw Error(resumed);
		if (fromBeginning) resumed.startAt = () => {};
		for (let i = start; i < Math.min(start + 2, plan.length); i++) {
			const actual = await resumed.window(plan[i].start, plan[i].end),
				expected = baseline[i];
			let count = 0,
				max = 0,
				first = -1,
				last = -1,
				sum = 0;
			for (let j = 0; j < expected.length; j++) {
				const d = Math.abs(actual[j] - expected[j]);
				if (d) {
					count++;
					if (first < 0) first = j;
					last = j;
					max = Math.max(max, d);
					sum += d * d;
				}
			}
			rows.push({
				fromBeginning,
				resumeAt: start,
				window: i,
				start: plan[i].start,
				samples: expected.length,
				actual: actual.length,
				different: count,
				first,
				last,
				max,
				rmse: Math.sqrt(sum / expected.length),
			});
		}
		resumed.close();
	}
	const result = {
		userAgent: navigator.userAgent,
		duration: plan.at(-1).end,
		rows,
	};
	postMessage(result);
} catch (e) {
	postMessage({ error: String(e) });
}
`;
const html = `
<meta charset="utf-8"><title>Reader audio resume check</title>
<button id="start">Start audio comparison</button><button id="stop">Stop</button>
<pre>Keep this page visible. The comparison stops after five minutes.</pre>
<script>
let worker, deadline;
const stop = () => { worker?.terminate(); worker = undefined; clearTimeout(deadline); };
document.querySelector('#stop').onclick = stop;
addEventListener('pagehide', stop);
document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
document.querySelector('#start').onclick = () => {
  stop();
  if (document.hidden) return;
  worker = new Worker('/run.js', {type: 'module'});
  deadline = setTimeout(() => { stop(); document.querySelector('pre').textContent = 'Stopped at time limit'; }, 300000);
  worker.onmessage = async e => {
    document.querySelector('pre').textContent = JSON.stringify(e.data, null, 2);
    stop();
    await fetch('/result', {method: 'POST', body: JSON.stringify(e.data)});
  };
  worker.onerror = e => { stop(); document.querySelector('pre').textContent = e.message; };
};
</script>`;

const server = createServer((req, res) => {
	if (req.url === '/run.js') {
		res.setHeader('Content-Type', 'text/javascript');
		res.end(worker);
		return;
	}
	if (req.url === '/progress') {
		let b = '';
		req.on('data', (c) => (b += c));
		req.on('end', () => {
			console.log(b);
			res.writeHead(204).end();
		});
		return;
	}
	if (req.url === '/result') {
		let body = '';
		req.on('data', (b) => (body += b));
		req.on('end', () => {
			writeFileSync(results, body);
			console.log(body);
			res.writeHead(204).end();
		});
		return;
	}
	const path =
		req.url === '/clip.mp4'
			? clip
			: req.url?.endsWith('.js')
				? join(root, 'dist', req.url)
				: undefined;
	res.setHeader(
		'Content-Type',
		req.url === '/clip.mp4' ? 'video/mp4' : path ? 'text/javascript' : 'text/html'
	);
	res.setHeader('Cache-Control', 'no-store');
	res.end(path ? readFileSync(path) : html);
}).listen(18799, '127.0.0.1', () =>
	console.log('Probe on http://127.0.0.1:18799/; output ' + results)
);
process.on('SIGINT', () => server.close());
