// Set up a browser check the way production actually behaves, run one scenario, and clean up.
//
//   node scripts/verify-in-browser/run.mjs <scenario> [--keep]
//
// This file exists because every browser pass on this project has cost more time to *arrange* than
// to write, and three times the arrangement itself produced a failure that looked exactly like an
// application bug. Each guard below is one of those, and the comment says which:
//
//   1. A build made without BASE_PATH 404s every asset, because GitHub Pages serves this app from
//      a sub-path. Checked, not assumed.
//   2. A stale Chrome holding the debug port makes the new one lose the IPv4 bind and fall back to
//      [::1]; `localhost` then resolves to the *old* browser and its old profile. Seen with a
//      21-hour-old Chrome, and the scenario spent five minutes examining the wrong page. So the
//      port is chosen only after checking it is free, and ownership is confirmed afterwards.
//   3. The static server did not compress, so a `Content-Length`-versus-body check passed here and
//      failed on every real attempt (research.md R14). serve.mjs gzips what Pages gzips.
//
// A profile and a browser per run, both thrown away at the end. Cheap, because it is one browser
// rather than the thirty that slice 1 cost.

import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = '/language-reader';
const BUILD = 'build';
const args = process.argv.slice(2);
const scenario = args.find((a) => !a.startsWith('--'));
const keep = args.includes('--keep');

if (!scenario) {
	console.error('usage: node scripts/verify-in-browser/run.mjs <scenario> [--keep]');
	process.exit(2);
}

/** Guard 1: a build that was made without BASE_PATH cannot be verified, only misread. */
function checkBuild() {
	const shell = join(BUILD, 'index.html');
	if (!existsSync(shell)) {
		fail(`no ${shell}. Run:  BASE_PATH=${BASE} npm run build`);
	}
	// The shell references its own assets by absolute path, so the prefix is visible in it.
	if (!readFileSync(shell, 'utf8').includes(`${BASE}/_app/`)) {
		fail(
			`${shell} does not reference ${BASE}/_app/, so it was built without BASE_PATH and every` +
				` asset will 404. Run:  BASE_PATH=${BASE} npm run build`
		);
	}
}

function fail(message) {
	console.error(`verify-in-browser: ${message}`);
	process.exit(2);
}

/** A port nothing is listening on. Asked of the OS rather than picked and hoped for. */
function freePort() {
	return new Promise((resolve, reject) => {
		const probe = createServer();
		probe.unref();
		probe.on('error', reject);
		// 127.0.0.1 specifically: the failure being avoided is an IPv4/IPv6 split, so a check that
		// binds the wildcard address would not see it.
		probe.listen(0, '127.0.0.1', () => {
			const { port } = probe.address();
			probe.close(() => resolve(port));
		});
	});
}

async function until(describe, condition, timeoutMs, everyMs = 200) {
	const deadline = Date.now() + timeoutMs;
	let last;
	while (Date.now() < deadline) {
		try {
			last = await condition();
			if (last) return last;
		} catch (error) {
			last = `threw: ${error.message}`;
		}
		await new Promise((r) => setTimeout(r, everyMs));
	}
	throw new Error(`timed out waiting for ${describe} (last: ${JSON.stringify(last)})`);
}

function run(command, commandArgs, options = {}) {
	const child = spawn(command, commandArgs, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
	child.stdout.setEncoding('utf8');
	child.stderr.setEncoding('utf8');
	// Tracked with a flag rather than read off `exitCode`, which stays null forever for a process
	// stopped by a signal — so a "wait until it has exited" check on a killed child never settles.
	// That is exactly how this script first hung after printing a passing result.
	child.finished = false;
	child.on('exit', () => (child.finished = true));
	return child;
}

checkBuild();

const servePort = await freePort();
const cdpPort = await freePort();
const profile = mkdtempSync(join(tmpdir(), 'verify-profile-'));
const origin = `http://127.0.0.1:${servePort}`;

const server = run('node', [
	join(import.meta.dirname, 'serve.mjs'),
	BUILD,
	BASE,
	String(servePort)
]);
const chromeLog = [];
const chrome = run('google-chrome', [
	'--headless=new',
	`--remote-debugging-port=${cdpPort}`,
	`--user-data-dir=${profile}`,
	'--no-first-run',
	'--no-default-browser-check',
	'--disable-gpu',
	'about:blank'
]);
chrome.stderr.on('data', (chunk) => chromeLog.push(chunk));

// By PID, and only the processes this script started. Pattern-matching a name here once killed the
// shell running the check.
function stopChildren() {
	for (const child of [chrome, server]) {
		if (!child.finished) child.kill();
	}
}

/**
 * Stop the children and remove the profile, in that order and waiting in between.
 *
 * Chrome writes to its profile directory while it shuts down, so removing it the instant after
 * `kill` fails with ENOTEMPTY — which it did, turning a passing check into a crash after the
 * result had already been printed.
 */
async function cleanUp() {
	stopChildren();
	await Promise.all(
		[chrome, server].map((child) =>
			child.finished
				? Promise.resolve()
				: // Deadlined, so that tidying up can never be the reason a check hangs.
					new Promise((resolve) => {
						child.on('exit', resolve);
						setTimeout(resolve, 5000).unref();
					})
		)
	);
	if (!keep) rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}

// Last resort only. An exit handler cannot await, so it kills and leaves the profile behind rather
// than racing to delete it; a directory under the system temp directory is not worth a crash.
process.on('exit', stopChildren);
process.on('SIGINT', () => process.exit(130));

/** Scenarios that need something to have happened first, and what produces it. */
const WARM_UP = { offline: 'words' };

function runScenario(name) {
	const harness = run(
		'node',
		[join(import.meta.dirname, 'harness.mjs'), name, '--cdp', String(cdpPort), '--app', origin],
		{ cwd: process.cwd() }
	);
	harness.stdout.on('data', (chunk) => process.stdout.write(chunk));
	harness.stderr.on('data', (chunk) => process.stderr.write(chunk));
	return new Promise((resolve) => harness.on('exit', (code) => resolve(code ?? 1)));
}

// Left unassigned: every path below sets it, and a default here would be a second answer to the
// question "did this pass" competing with the real one.
let status;
try {
	await until(
		'the static server to answer',
		async () => (await fetch(`${origin}${BASE}/index.html`)).ok,
		15000
	);

	// Guard 3, asserted rather than trusted: the point of this server is that it behaves like the
	// host, and a silent regression to no-compression is how the last bug reached the phone.
	const compressed = await fetch(`${origin}${BASE}/_app/version.json`, {
		headers: { 'accept-encoding': 'gzip' }
	});
	if (compressed.headers.get('content-encoding') !== 'gzip') {
		fail('the static server is not compressing; it is kinder than GitHub Pages and cannot verify');
	}

	const version = await until(
		'Chrome to accept a debugger connection',
		async () => await (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).json(),
		20000
	);

	// Guard 2. Chrome prints `bind() failed` and then carries on having bound the other address
	// family, so its own exit code says nothing. The connection reaching a browser is not proof it
	// reached *this* browser.
	if (chromeLog.join('').includes('bind() failed')) {
		fail(
			`Chrome could not bind 127.0.0.1:${cdpPort} and fell back to another address, so this` +
				` connection may be to a different browser. Check for leftover Chromes:` +
				`  ps -eo pid,args | grep -- --headless=new | grep -v type=`
		);
	}
	const tabs = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
	const pages = tabs.filter((t) => t.type === 'page');
	if (pages.length !== 1 || pages[0].url !== 'about:blank') {
		fail(
			`expected one blank tab in a fresh profile, found ${pages.length}:` +
				` ${pages.map((t) => t.url).join(', ')}. This is very likely a stale browser.`
		);
	}

	console.error(`verify-in-browser: ${version.Browser}, serving ${origin}${BASE}/`);

	// `offline` reads with the server stopped, and it needs a profile that already has the
	// application cached and a document saved — so a scenario that produces both runs first, in
	// the same browser, and then the server goes away. Emulating the network instead does not
	// work: `Network.emulateNetworkConditions` does not apply to a service worker's own fetches.
	if (WARM_UP[scenario]) {
		console.error(`verify-in-browser: warming with "${WARM_UP[scenario]}" first`);
		const warmed = await runScenario(WARM_UP[scenario]);
		if (warmed !== 0) {
			fail(
				`the warm-up scenario "${WARM_UP[scenario]}" failed, so "${scenario}" cannot be trusted`
			);
		}
		server.kill();
		await until(
			'the static server to stop answering',
			async () => {
				try {
					await fetch(`${origin}${BASE}/index.html`);
					return false;
				} catch {
					return true;
				}
			},
			10000
		);
		console.error('verify-in-browser: server stopped');
	}

	status = await runScenario(scenario);
} catch (error) {
	console.error(`verify-in-browser: ${error.message}`);
	status = 2;
}

await cleanUp();
process.exit(status);
