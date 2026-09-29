// A local test reader plus a disposable reader service. --phone reverses only these two ports.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';

const args = process.argv.slice(2);
if (args.includes('--help')) {
	console.log(
		'npm run verify:isolated -- [--phone]\nBuilds a test reader; Ctrl-C stops its servers. Does not open or interact with the phone.'
	);
	process.exit(0);
}
if (args.some((arg) => arg !== '--phone')) throw new Error('Only --phone is supported.');
const phone = args.includes('--phone');
const webPort = 4176;
const servicePort = 18765;
const ports = [webPort, servicePort];
const children = [];
const reversed = [];
let stopping = false;

function stop() {
	if (stopping) return;
	stopping = true;
	for (const child of children) child.kill();
	for (const port of reversed) {
		try {
			execFileSync('adb', ['-d', 'reverse', '--remove', `tcp:${port}`], { timeout: 5000 });
		} catch {
			console.error(`Could not remove test reverse mapping tcp:${port}.`);
		}
	}
}
process.on('exit', stop);
process.on('SIGINT', () => {
	stop();
	process.exit(130);
});
process.on('SIGTERM', () => {
	stop();
	process.exit(143);
});

for (const port of ports) {
	await new Promise((resolve, reject) => {
		const probe = createServer();
		probe.on('error', reject);
		probe.listen(port, '127.0.0.1', () => probe.close(resolve));
	});
}
if (phone) {
	const mappings = execFileSync('adb', ['-d', 'reverse', '--list'], {
		encoding: 'utf8',
		timeout: 5000
	});
	if (ports.some((port) => mappings.includes(`tcp:${port}`))) {
		throw new Error('A test port is already reversed. Stop its owner before starting another run.');
	}
}

function run(command, args, options = {}) {
	const child = spawn(command, args, { stdio: 'inherit', ...options });
	children.push(child);
	return child;
}

// Always rebuild: serving a production bundle here would send backups to the real service.
const build = run('npm', ['run', 'build', '--', '--mode', 'verification'], {
	env: { ...process.env, BASE_PATH: '/language-reader' }
});
await new Promise((resolve, reject) => {
	build.on('error', reject);
	build.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Build failed: ${code}`))));
});

const root = mkdtempSync(join(tmpdir(), 'reader-verification-'));
// Prevent reader-service.py from linking the real ~/downloads into its temporary root.
mkdirSync(join(root, 'downloads'));
const servers = [
	run(process.execPath, [
		'scripts/verify-in-browser/serve.mjs',
		'build',
		'/language-reader',
		String(webPort)
	]),
	run(
		'python3',
		['scripts/termux/reader-service.py', '--root', root, '--port', String(servicePort)],
		{
			env: {
				...process.env,
				TRANSLATE_STUB: '1',
				READER_TRANSLATE: resolve('scripts/termux/translate.py')
			}
		}
	)
];
for (const server of servers) {
	server.on('error', (error) => {
		console.error(error);
		stop();
		process.exitCode = 1;
	});
	server.on('exit', () => {
		if (!stopping) {
			stop();
			process.exitCode = 1;
		}
	});
}

async function ready(url) {
	const deadline = Date.now() + 10_000;
	while (Date.now() < deadline && !stopping) {
		try {
			if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return;
		} catch {
			/* Starting. */
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error(`Server did not become ready: ${url}`);
}
await ready(`http://127.0.0.1:${servicePort}/health`);
await ready(`http://127.0.0.1:${webPort}/language-reader/`);
if (phone) {
	for (const port of ports) {
		execFileSync('adb', ['-d', 'reverse', '--no-rebind', `tcp:${port}`, `tcp:${port}`], {
			timeout: 5000
		});
		reversed.push(port);
	}
}
console.log(`Test reader: http://127.0.0.1:${webPort}/language-reader/`);
console.log(
	`Disposable service data: ${root}\nTranslations are stubbed. Place fixture bundles under ${root}/downloads.`
);
console.log(
	'Browser test data persists on this test origin. Clear only that origin when a fresh run is needed.'
);
