// Issue #14, bit-exact resume: the app's own SpeechAudio (src/lib/speech/audio.ts, WebCodecs AAC)
// in headless desktop Chrome, comparing the 16 kHz samples of a resumed window against the
// uninterrupted run, for several ways of resuming:
//   preroll N   — a fresh decoder started N AAC frames before the window (the app uses N = 2)
//   replay      — a fresh decoder from frame 0, decoding and discarding in bounded steps
//   perWindow N — every window, in the uninterrupted run too, from its own fresh decoder N frames
//                 early: resumed and uninterrupted are then the same computation
// Only private members of the bundled class are overridden; src/ is not changed.
//   node resume-preroll.mjs <audio.mp4|m4a> <results.json> [targets seconds, comma-separated]
import { build } from 'vite';
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const [media, output, targetArg = '120,1800,3600,5400'] = process.argv.slice(2);
if (!media || !output)
	throw new Error('Usage: node resume-preroll.mjs <audio.m4a> <results.json> [targets]');
const clip = resolve(media);
const results = resolve(output);
const root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'resume-preroll-'));
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
const PREROLLS = [2, 8, 32, 128, 512, 2048];
const FRAME = 1024;
const log = (s) => fetch('/progress', { method: 'POST', body: s });
const heap = () => performance.memory ? performance.memory.usedJSHeapSize : -1;
let config;
const configure = AudioDecoder.prototype.configure;
AudioDecoder.prototype.configure = function (c) { config ??= c; return configure.call(this, c); };

function compare(actual, expected) {
	let different = 0, max = 0, first = -1, last = -1, sum = 0;
	for (let j = 0; j < expected.length; j++) {
		const d = Math.abs(actual[j] - expected[j]);
		if (d || Number.isNaN(d)) { different++; if (first < 0) first = j; last = j; max = Math.max(max, d); sum += d * d; }
	}
	return { different, of: expected.length, lengthOk: actual.length === expected.length, first, last, max, rms: Math.sqrt(sum / expected.length) };
}
try {
	const video = await (await fetch('/clip')).blob();
	let t0 = performance.now();
	const straight = await SpeechAudio.open(video);
	if (typeof straight === 'string') throw Error(straight);
	const openMs = performance.now() - t0;
	const samples = straight.samples, timescale = straight.timescale;
	const fresh = () => new SpeechAudio(samples, timescale, config);
	const plan = windowPlan(straight.duration);
	const targets = TARGETS.map((s) => plan.findIndex((w) => w.start >= s)).filter((i) => i >= 0 && i + 1 < plan.length);
	await log('open ' + openMs.toFixed(0) + ' ms, windows ' + plan.length + ', targets ' + targets);

	// The uninterrupted run, as the app does it: one decoder, every window in order.
	const reference = new Map();
	t0 = performance.now();
	let maxHeap = 0;
	for (let i = 0; i < plan.length; i++) {
		const s = await straight.window(plan[i].start, plan[i].end);
		if (targets.includes(i) || targets.includes(i - 1)) reference.set(i, s);
		if (i % 50 === 0) maxHeap = Math.max(maxHeap, heap());
	}
	straight.close();
	const uninterruptedMs = performance.now() - t0;
	await log('uninterrupted ' + uninterruptedMs.toFixed(0) + ' ms');

	// A second uninterrupted run: is the decoder itself deterministic?
	const again = fresh();
	const determinism = [];
	for (let i = 0; i <= Math.max(...targets) + 1; i++) {
		const s = await again.window(plan[i].start, plan[i].end);
		if (reference.has(i)) determinism.push({ window: i, ...compare(s, reference.get(i)) });
	}
	again.close();

	const rows = [];
	for (const k of targets) {
		for (const n of PREROLLS) {
			const a = fresh();
			a.startAt = function (input) { this.next = Math.max(0, Math.floor(input / FRAME) - n); this.started = this.base = this.next * FRAME; };
			t0 = performance.now();
			const w0 = await a.window(plan[k].start, plan[k].end);
			const ms = performance.now() - t0;
			const w1 = await a.window(plan[k + 1].start, plan[k + 1].end);
			a.close();
			rows.push({ method: 'preroll', n, window: k, start: plan[k].start, ms, resumed: compare(w0, reference.get(k)), next: compare(w1, reference.get(k + 1)) });
		}
		// Bounded replay from frame 0: decode and discard in steps of STEP seconds of input.
		for (const step of [10, 60]) {
			const a = fresh();
			a.startAt = () => {};
			const [lo] = a.resampler.inputFor(Math.round(plan[k].start * 16000), Math.round(plan[k].end * 16000));
			const STEP = step * a.resampler.rate;
			let peak = 0;
			t0 = performance.now();
			for (let at = STEP; at < lo; at += STEP) {
				await a.decodeThrough(at);
				a.join();
				a.dropBefore(at);
				peak = Math.max(peak, heap(), 0);
			}
			const replayMs = performance.now() - t0;
			const w0 = await a.window(plan[k].start, plan[k].end);
			const ms = performance.now() - t0;
			const w1 = await a.window(plan[k + 1].start, plan[k + 1].end);
			a.close();
			rows.push({ method: 'replay', stepSeconds: step, window: k, start: plan[k].start, replayMs, ms, peakHeap: peak, resumed: compare(w0, reference.get(k)), next: compare(w1, reference.get(k + 1)) });
		}
		await log('target ' + k + ' done');
	}

	// Fresh decoder per window: two independent runs of the same windows must agree, and how far
	// do they move from the single-decoder samples?
	const perWindow = [];
	for (const n of [2, 8]) {
		for (const k of targets) {
			const runs = [];
			for (let r = 0; r < 2; r++) {
				const a = fresh();
				a.startAt = function (input) { this.next = Math.max(0, Math.floor(input / FRAME) - n); this.started = this.base = this.next * FRAME; };
				runs.push(await a.window(plan[k].start, plan[k].end));
				a.close();
			}
			perWindow.push({ n, window: k, twoRuns: compare(runs[1], runs[0]), vsSingleDecoder: compare(runs[0], reference.get(k)) });
		}
	}
	postMessage({ userAgent: navigator.userAgent, config: { codec: config.codec, sampleRate: config.sampleRate, numberOfChannels: config.numberOfChannels }, frames: samples.length, duration: straight.duration, windows: plan.length, openMs, uninterruptedMs, uninterruptedMaxHeap: maxHeap, determinism, rows, perWindow });
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
}).listen(0, '127.0.0.1', () => {
	const { port } = server.address();
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
