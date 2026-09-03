// One parameterised harness for browser checks, reusing a single Chrome.
//
// Slice 1 cost ~3h on browser verification by launching 30 browsers and writing 22 near-duplicate
// scripts, and by using fixed sleeps that produced two FALSE failures. So: one Chrome, targets
// opened and closed via /json/new and /json/close, and every wait is a poll against a condition
// with a deadline. Never a sleep.
//
//   node harness.mjs <scenario> --cdp <port> --app <origin>

import { appendFileSync } from 'node:fs';

const args = process.argv.slice(2);
const scenario = args[0];
const cdpPort = Number(valueOf('--cdp') ?? 9222);
const appOrigin = valueOf('--app') ?? 'http://localhost:4173';
const BASE = '/language-reader';

function valueOf(flag) {
	const i = args.indexOf(flag);
	return i === -1 ? undefined : args[i + 1];
}

async function until(describe, condition, timeoutMs = 20000, everyMs = 100) {
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

/** A CDP session against one freshly opened tab. */
async function openTab(url) {
	const created = await fetch(`http://localhost:${cdpPort}/json/new?${encodeURIComponent(url)}`, {
		method: 'PUT'
	});
	const target = await created.json();
	const socket = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		socket.addEventListener('open', resolve, { once: true });
		socket.addEventListener('error', reject, { once: true });
	});

	let nextId = 1;
	const pending = new Map();
	let listener = () => {};
	socket.addEventListener('close', () => {
		for (const { reject } of pending.values()) reject(new Error('CDP socket closed'));
		pending.clear();
	});
	socket.addEventListener('message', (event) => {
		const message = JSON.parse(event.data);
		if (message.method) listener(message.method, message.params ?? {});
		if (message.id && pending.has(message.id)) {
			const { resolve, reject } = pending.get(message.id);
			pending.delete(message.id);
			if (message.error) reject(new Error(JSON.stringify(message.error)));
			else resolve(message.result);
		}
	});

	function send(method, params = {}) {
		const id = nextId++;
		return new Promise((resolve, reject) => {
			pending.set(id, { resolve, reject });
			socket.send(JSON.stringify({ id, method, params }));
		});
	}

	async function evaluate(expression) {
		const result = await send('Runtime.evaluate', {
			expression: `(async () => { ${expression} })()`,
			awaitPromise: true,
			returnByValue: true,
			// Without this, a `.click()` evaluated here reports success and the handler does not
			// run: the model scenario sat for five minutes on a button it believed it had pressed,
			// which is the false-failure class this harness exists to avoid. Clicking by hand over
			// CDP *with* a gesture started the download immediately.
			userGesture: true
		});
		if (result.exceptionDetails) {
			throw new Error(result.exceptionDetails.exception?.description ?? 'evaluate threw');
		}
		return result.result.value;
	}

	async function close() {
		socket.close();
		await fetch(`http://localhost:${cdpPort}/json/close/${target.id}`);
	}

	async function goto(path) {
		await send('Page.enable');
		await send('Page.navigate', { url: `${appOrigin}${BASE}${path}` });
		await until('document ready', () => evaluate("return document.readyState === 'complete'"));
	}

	return {
		send,
		evaluate,
		close,
		goto,
		targetId: target.id,
		onEvent: (fn) => {
			listener = fn;
		}
	};
}

const SAVE_BUTTON = `[...document.querySelectorAll("main button")].find((b) => b.textContent.trim() === "Save")`;
const READ_LINKS = `[...document.querySelectorAll("a")].filter((a) => (a.getAttribute("href") || "").includes("/read/")).length`;
const READ_LINK = `[...document.querySelectorAll("a")].map((a) => a.getAttribute("href")).find((h) => h && h.includes("/read/"))`;

const scenarios = {
	// Download the 98 MB model, then check the device probe changes to model-quality segmentation.
	async model() {
		const tab = await openTab('about:blank');
		const console_ = [];
		try {
			await tab.send('Runtime.enable');
			await tab.send('Log.enable');
			tab.onEvent((method, params) => {
				if (method === 'Runtime.exceptionThrown')
					console_.push(
						'EXC: ' +
							(params.exceptionDetails.exception?.description ?? params.exceptionDetails.text)
					);
				if (method === 'Log.entryAdded' && params.entry.level === 'error')
					console_.push('ERR: ' + params.entry.text);
			});

			await tab.goto('/diagnostics');
			// Wait for a REAL segmentation, not the loading placeholder. Treating '…' as the
			// baseline made an earlier run pass on the dictionary merely finishing loading.
			const before = await until('a real device probe', async () => {
				const text = await tab.evaluate(
					'return document.querySelector("code.probe")?.textContent || ""'
				);
				return text.includes('|') ? text : null;
			});

			const clicked = await tab.evaluate(`
				const b = [...document.querySelectorAll('button')].find((x) => /Download the sentence-reading/.test(x.textContent));
				if (!b) return false;
				b.click();
				return true;
			`);
			if (!clicked)
				return { pass: false, error: 'no download control found', before, console: console_ };

			// Poll for the model to be in use, allowing generous time for 98 MB plus a session start.
			// The decisive signal is the STAMP naming the model, not the probe changing: the probe
			// can change for other reasons, and the stamp is what says which analyzer produced it.
			const after = await until(
				'the model to become active, or an error to appear',
				async () => {
					const state = await tab.evaluate(`
						return {
							probe: document.querySelector('code.probe')?.textContent || '',
							problem: document.querySelector('.problem')?.textContent || '',
							stamp: [...document.querySelectorAll('dd')].map((d) => d.textContent).find((t) => /bert-ws|cedict/.test(t)) || '',
							progress: [...document.querySelectorAll('small')].map((s) => s.textContent).find((t) => / MB/.test(t)) || ''
						};
					`);
					if (state.problem) return state;
					// Progress to its own file: stdout carries the JSON result, and a check that
					// looks identical whether it is working or wedged is worth nothing.
					appendFileSync(
						'model-progress.log',
						`${new Date().toISOString()} ${state.progress || '(no progress yet)'} | stamp: ${state.stamp.slice(0, 60)}\n`
					);
					return /bert-ws/.test(state.stamp) ? state : null;
				},
				// 112 MB at the throughput actually observed here. The previous run timed out at
				// 500s with 80 MB already on disk -- not a failure, an impatient deadline.
				1500000,
				5000
			);
			return { pass: !after.problem, before, after, console: console_.slice(0, 6) };
		} catch (error) {
			return { pass: false, error: error.message, console: console_.slice(0, 8) };
		} finally {
			await tab.close();
		}
	},

	// Collect console output and uncaught exceptions during boot.
	async boot() {
		const tab = await openTab('about:blank');
		const messages = [];
		try {
			await tab.send('Runtime.enable');
			await tab.send('Log.enable');
			tab.onEvent((method, params) => {
				if (method === 'Runtime.exceptionThrown') {
					const d = params.exceptionDetails;
					messages.push(`EXCEPTION: ${d.exception?.description ?? d.text}`);
				}
				if (method === 'Runtime.consoleAPICalled') {
					messages.push(
						`console.${params.type}: ${params.args.map((a) => a.description ?? a.value).join(' ')}`
					);
				}
				if (method === 'Log.entryAdded') {
					messages.push(`log.${params.entry.level}: ${params.entry.text}`);
				}
			});
			await tab.goto('/');
			await until(
				'boot to settle',
				async () =>
					messages.length > 0 ||
					(await tab.evaluate('return document.querySelectorAll("button").length > 0')),
				12000
			);
			const body = await tab.evaluate('return document.body.innerText.slice(0, 300)');
			return { pass: true, messages, body };
		} catch (error) {
			return { pass: false, error: error.message, messages };
		} finally {
			await tab.close();
		}
	},

	// Reports what is actually on the page, so a failing selector is diagnosed rather than guessed at.
	async probe() {
		const tab = await openTab('about:blank');
		try {
			await tab.goto('/');
			await until('any button', () =>
				tab.evaluate('return document.querySelectorAll("button").length > 0')
			);
			const seen = await tab.evaluate(`
				return {
					buttons: [...document.querySelectorAll('button')].map((b) => ({
						text: b.textContent.trim().slice(0, 40),
						disabled: b.disabled,
						inMain: !!b.closest('main')
					})),
					links: [...document.querySelectorAll('a')].map((a) => a.getAttribute('href')),
					bodyText: document.body.innerText.slice(0, 400)
				};
			`);
			return { pass: true, ...seen };
		} finally {
			await tab.close();
		}
	},

	// Real segmentation is visible in the reader, and the words are words.
	async words() {
		const tab = await openTab('about:blank');
		try {
			await tab.goto('/');
			await until('textarea', () => tab.evaluate('return !!document.querySelector("textarea")'));

			await tab.evaluate(`
				const area = document.querySelector('textarea');
				area.value = '我在中国学习中文。他骑自行车去上班。';
				area.dispatchEvent(new Event('input', { bubbles: true }));
				return true;
			`);

			await until('save enabled', () => tab.evaluate(`return ${SAVE_BUTTON}?.disabled === false;`));
			await tab.evaluate(`${SAVE_BUTTON}.click(); return true;`);

			const link = await until('document listed', () =>
				tab.evaluate(`return ${READ_LINK} ?? null;`)
			);

			await tab.send('Page.navigate', { url: `${appOrigin}${link}` });
			await until('reader rendered', () =>
				tab.evaluate('return document.querySelectorAll(".reading button.token").length > 0')
			);

			const observed = await tab.evaluate(`
				const words = [...document.querySelectorAll('.reading button.token')].map((b) => b.textContent);
				const subtitle = document.querySelector('p.subtitle')?.textContent ?? '';
				const gap = getComputedStyle(document.querySelector('.reading button.token')).marginRight;
				return { words, subtitle, gap };
			`);

			const multi = observed.words.filter((w) => [...w].length > 1);
			// A multi-character word exists, the boundary gap is actually applied, and the stamp is
			// a fingerprint rather than the placeholder's "v1".
			// Whichever analyzer ships, it must name itself and must not be the placeholder.
			const stamped =
				/Segmented by \S+/.test(observed.subtitle) && !/character-splitter/.test(observed.subtitle);
			const gapApplied = parseFloat(observed.gap) > 0;
			return {
				pass: multi.length > 0 && stamped && gapApplied,
				words: observed.words.join(' | '),
				multiCharacterWords: multi,
				subtitle: observed.subtitle,
				wordGap: observed.gap
			};
		} finally {
			await tab.close();
		}
	},

	// The service worker takes control and the manifest is real. True installability is the phone.
	async shell() {
		const tab = await openTab('about:blank');
		try {
			await tab.goto('/');
			const controlled = await until('service worker controlling', () =>
				tab.evaluate(`
					const reg = await navigator.serviceWorker.getRegistration();
					return !!(reg && navigator.serviceWorker.controller);
				`)
			);
			const manifest = await tab.evaluate(`
				const res = await fetch('${BASE}/manifest.webmanifest');
				const m = await res.json();
				return { ok: res.ok, name: m.name, icons: (m.icons ?? []).length, start: m.start_url, display: m.display };
			`);
			const precached = await tab.evaluate(`
				const res = await fetch('${BASE}/precache.json');
				return (await res.json()).length;
			`);
			return {
				pass: !!controlled && manifest.ok && manifest.icons > 0,
				controlled,
				manifest,
				precached
			};
		} finally {
			await tab.close();
		}
	},

	// Reading with the server stopped. The server must already be down when this runs:
	// Network.emulateNetworkConditions does not apply to a service worker's own fetches.
	async offline() {
		const tab = await openTab('about:blank');
		try {
			await tab.goto('/');
			const link = await until('library rendered', () =>
				tab.evaluate(`return ${READ_LINK} ?? null;`)
			);
			await tab.send('Page.navigate', { url: `${appOrigin}${link}` });
			const words = await until('reader rendered offline', () =>
				tab.evaluate('return document.querySelectorAll(".reading button.token").length')
			);
			return { pass: words > 0, wordsRendered: words };
		} finally {
			await tab.close();
		}
	},

	// A second copy must not accept a change it cannot keep.
	//
	// The notice appears when a change is *attempted*, not when a second copy merely opens: slice 1
	// decided the check happens inside the action, so a change is performed or refused immediately
	// rather than held in hope. So this scenario has to actually try to save.
	async readonly() {
		const first = await openTab('about:blank');
		const second = await openTab('about:blank');
		try {
			await first.goto('/');
			await until('first copy ready', () =>
				first.evaluate(`return ${SAVE_BUTTON} ? true : false;`)
			);

			await second.goto('/');
			// Wait for the foreground copy to have actually TOUCHED storage, not merely rendered.
			// `session()` is lazy, so a copy that has only painted its controls has not yet asked
			// for the lease — and attempting the save before then would test nothing but a race.
			// "Opening your library…" disappearing is the observable end of that acquisition.
			await until('foreground copy to have acquired storage', () =>
				second.evaluate(
					'return !document.body.innerText.includes("Opening your library") && !!document.querySelector("main button");'
				)
			);

			// The first tab is now in the background, so the visible copy is the second one. Attempt
			// a save in the BACKGROUND copy, which is the one that should not hold storage.
			const before = await first.evaluate(`return ${READ_LINKS};`);

			await first.evaluate(`
				const area = document.querySelector('textarea');
				area.value = '这是第二个窗口写的。';
				area.dispatchEvent(new Event('input', { bubbles: true }));
				return true;
			`);
			await until('save enabled in background copy', () =>
				first.evaluate(`return ${SAVE_BUTTON}?.disabled === false;`)
			);
			await first.evaluate(`${SAVE_BUTTON}.click(); return true;`);

			// Poll for either outcome — refused, or accepted — rather than only for the one being
			// hoped for. A harness that can only observe failure cannot tell a regression from an
			// artefact of headless visibility handling.
			const outcome = await until(
				'the background copy to refuse or accept',
				async () => {
					const state = await first.evaluate(`
						const refusal = document.body.innerText.match(/cannot save right now|will not let the app store/i);
						return {
							refusal: refusal ? refusal[0] : null,
							documents: ${READ_LINKS},
							visibility: document.visibilityState
						};
					`);
					// Either it refused, or a NEW document appeared. Counting from a baseline taken
					// just before the click, because earlier scenarios already saved documents and
					// "a /read/ link exists" was therefore true before this scenario began.
					return state.refusal || state.documents > before ? state : null;
				},
				15000
			);

			const visibilities = {
				background: outcome.visibility,
				foreground: await second.evaluate('return document.visibilityState')
			};

			return {
				pass: !!outcome.refusal,
				refusal: outcome.refusal,
				visibilities,
				note: outcome.refusal
					? 'the copy without the lease refused, as slice 1 requires'
					: 'the background copy accepted the change — check whether headless reports both tabs visible, which would mean it legitimately held the lease'
			};
		} finally {
			await first.close();
			await second.close();
		}
	}
};

if (!scenarios[scenario]) {
	console.error(`unknown scenario "${scenario}". known: ${Object.keys(scenarios).join(', ')}`);
	process.exit(2);
}

try {
	const result = await scenarios[scenario]();
	console.log(JSON.stringify({ scenario, ...result }, null, 2));
	process.exit(result.pass ? 0 : 1);
} catch (error) {
	console.log(JSON.stringify({ scenario, pass: false, error: error.message }, null, 2));
	process.exit(1);
}
