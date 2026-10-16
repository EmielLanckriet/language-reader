// Issue #14, after the change: the app's SpeechAudio (a decoder per window) in headless Chrome.
// One instance decodes every window in order up to the last target; a second instance decodes only
// the target windows, as a resumed transcript would. Their samples must be identical.
//   node per-window-check.mjs <audio.m4a> <results.json> [targets seconds, comma-separated]
// On a phone: PORT=18991 NO_CHROME=1 node per-window-check.mjs …, adb reverse tcp:18991 tcp:18991,
// and open http://127.0.0.1:18991/ in the phone's Chrome.
import { build } from 'vite';
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const [media, output, targetArg = '120,1800'] = process.argv.slice(2);
if (!media || !output)
	throw new Error('Usage: node per-window-check.mjs <audio.m4a> <results.json> [targets]');
const clip = resolve(media);
const results = resolve(output);
const root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'per-window-'));
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
const TARGETS = ${JSON.stringify(targetArg.split(',').map(Number))};
const log = (s) => fetch('/progress', { method: 'POST', body: s });
function different(a, b) {
	if (a.length !== b.length) return 'length ' + a.length + ' vs ' + b.length;
	let n = 0;
	for (let j = 0; j < a.length; j++) if (a[j] !== b[j] && !(Number.isNaN(a[j]) && Number.isNaN(b[j]))) n++;
	return n;
}
try {
	const video = await (await fetch('/clip')).blob();
	const straight = await SpeechAudio.open(video);
	if (typeof straight === 'string') throw Error(straight);
	const plan = windowPlan(straight.duration);
	const targets = TARGETS.map((s) => plan.findIndex((w) => w.start >= s)).filter((i) => i >= 0);
	const reference = new Map();
	const times = [];
	for (let i = 0; i <= Math.max(...targets); i++) {
		const t = performance.now();
		const s = await straight.window(plan[i].start, plan[i].end);
		times.push(performance.now() - t);
		if (targets.includes(i)) reference.set(i, s);
	}
	straight.close();
	await log('uninterrupted to window ' + Math.max(...targets));
	const resumed = await SpeechAudio.open(video);
	const rows = [];
	for (const k of targets) {
		const t = performance.now();
		const s = await resumed.window(plan[k].start, plan[k].end);
		rows.push({ window: k, start: plan[k].start, ms: performance.now() - t, differentSamples: different(s, reference.get(k)), samples: s.length });
	}
	resumed.close();
	times.sort((a, b) => a - b);
	postMessage({ userAgent: navigator.userAgent, windows: plan.length, rows, perWindowMs: { median: times[times.length >> 1], p95: times[Math.floor(times.length * 0.95)], n: times.length } });
} catch (e) {
	postMessage({ error: String(e && e.stack || e) });
}
`;
const html = `<meta charset="utf-8"><title>resume preroll</title><pre id="o">running</pre><script>
const w = new Worker('/run.js', { type: 'module' });
w.onmessage = async (e) => { document.querySelector('#o').textContent = 'done'; await fetch('/result', { method: 'POST', body: JSON.stringify(e.data) }); };
w.onerror = (e) => fetch('/result', { method: 'POST', body: JSON.stringify({ error: e.message }) });
</script>`;

let chrome;
const server = createServer((req, res) => {
	const body = () =>
		new Promise((ok) => {
			let b = '';
			req.on('data', (c) => (b += c));
			req.on('end', () => ok(b));
		});
	if (req.url === '/run.js')
		return (res.setHeader('Content-Type', 'text/javascript'), res.end(worker));
	if (req.url === '/progress')
		return body().then((b) => {
			console.log(new Date().toISOString().slice(11, 19), b);
			res.writeHead(204).end();
		});
	if (req.url === '/result') {
		return body().then((b) => {
			writeFileSync(results, JSON.stringify(JSON.parse(b), null, 1));
			console.log('written', results);
			res.writeHead(204).end();
			server.close();
			chrome?.once('exit', () => rmSync(root, { recursive: true, force: true }));
			chrome?.kill('SIGTERM');
		});
	}
	if (req.url === '/clip')
		return (res.setHeader('Content-Type', 'video/mp4'), res.end(readFileSync(clip)));
	if (req.url?.endsWith('.js'))
		return (
			res.setHeader('Content-Type', 'text/javascript'),
			res.end(readFileSync(join(root, 'dist', req.url)))
		);
	res.setHeader('Content-Type', 'text/html');
	res.end(html);
}).listen(Number(process.env.PORT ?? 0), '127.0.0.1', () => {
	const { port } = server.address();
	// PORT=n NO_CHROME=1: only serve, for a phone's Chrome over \`adb reverse tcp:n tcp:n\`.
	if (process.env.NO_CHROME) return console.log('serving on port', port);
	chrome = spawn(
		process.env.CHROME ?? 'google-chrome',
		[
			'--headless=new',
			...(process.env.CHROME_LOG ? ['--enable-logging=stderr', '--v=0'] : []),
			'--no-first-run',
			'--no-default-browser-check',
			'--disable-gpu',
			`--user-data-dir=${join(root, 'profile')}`,
			`http://127.0.0.1:${port}/`
		],
		{ stdio: process.env.CHROME_LOG ? 'inherit' : 'ignore' }
	);
	console.log('chrome pid', chrome.pid, 'port', port);
});
