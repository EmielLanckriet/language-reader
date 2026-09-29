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
/**
 * A new tab's target. `/json/new` first; Chrome for Android 154 answers it with "Could not create
 * new page", so then `Target.createTarget` over the browser connection, which it does support.
 */
async function newTarget(url) {
	const created = await fetch(`http://localhost:${cdpPort}/json/new?${encodeURIComponent(url)}`, {
		method: 'PUT'
	});
	const text = await created.text();
	if (created.ok && text.startsWith('{')) return JSON.parse(text);

	const { webSocketDebuggerUrl } = await (
		await fetch(`http://localhost:${cdpPort}/json/version`)
	).json();
	const browser = new WebSocket(webSocketDebuggerUrl);
	await new Promise((resolve) => browser.addEventListener('open', resolve, { once: true }));
	const targetId = await new Promise((resolve, reject) => {
		browser.addEventListener('message', (event) => {
			const message = JSON.parse(event.data);
			if (message.id !== 1) return;
			if (message.error) reject(new Error(JSON.stringify(message.error)));
			else resolve(message.result.targetId);
		});
		browser.send(JSON.stringify({ id: 1, method: 'Target.createTarget', params: { url } }));
	});
	browser.close();
	return until('the new tab to be listed', async () => {
		const list = await (await fetch(`http://localhost:${cdpPort}/json/list`)).json();
		return list.find((target) => target.id === targetId);
	});
}

async function openTab(url) {
	const target = await newTarget(url);
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

// Import a Termux job the way the reader does: open the library, find it under "New from Termux",
// press Open. The reader service must be serving it (make-fixtures.sh).
async function importFromTermux(tab, title) {
	await tab.send('Storage.clearDataForOrigin', { origin: appOrigin, storageTypes: 'all' });
	await tab.goto('/');
	await until(
		`"${title}" under New from Termux`,
		() =>
			tab.evaluate(`
				const item = [...document.querySelectorAll('.fresh li')].find((li) => li.textContent.includes(${JSON.stringify(title)}));
				if (!item) return null;
				item.querySelector('button').click();
				return true;
			`),
		30000,
		250
	);
}

const scenarios = {
	// English for each line arrives from Termux and is revealed on tap. Plumbing only: run
	// translate.py with TRANSLATE_STUB=1 on the fixture-media job (make-fixtures.sh), so each line
	// reads "EN: <the Chinese>", and the reader service on 127.0.0.1:8765.
	async translate() {
		const tab = await openTab('about:blank');
		try {
			await importFromTermux(tab, 'Test clip, 45 s');
			await until(
				'the document to open',
				() => tab.evaluate(`return !!document.querySelector('.lines p');`),
				30000
			);
			const buttons = await until(
				'English to arrive',
				() => tab.evaluate(`return document.querySelectorAll('.lines .reveal').length || null;`),
				30000,
				500
			);
			const hiddenAtFirst = await tab.evaluate(
				`return document.querySelectorAll('.lines .english').length;`
			);
			await tab.evaluate(`document.querySelector('.lines .reveal').click(); return true;`);
			// Every line offers English from the start now (quick English, ADR-0023), so the button
			// is no sign Termux's has arrived: wait for Termux's own text, which replaces the quick one.
			const shown = await until(
				'Termux’s English to show on tap',
				() =>
					tab.evaluate(`
						const line = document.querySelector('.lines p');
						const english = line.querySelector('.english')?.textContent;
						return english?.startsWith('EN: ') ? { chinese: line.querySelector('.token')?.textContent, english } : null;
					`),
				30000,
				500
			).catch(async (error) => ({
				error: error.message,
				pressed: await tab.evaluate(
					`return document.querySelector('.lines .reveal').getAttribute('aria-pressed');`
				)
			}));
			return {
				pass: hiddenAtFirst === 0 && buttons > 10 && /^EN: /.test(shown.english ?? ''),
				buttons,
				hiddenAtFirst,
				...shown
			};
		} finally {
			await tab.close();
		}
	},

	// Anki words (spec 006), plumbing only: the Diagnostics picker takes the fixture export, the
	// preview counts it, Import applies it, and a word in the fixture video shows its Anki level.
	async anki() {
		const { resolve: absolute } = await import('node:path');
		const tab = await openTab('about:blank');
		try {
			await importFromTermux(tab, 'Test clip, 45 s');
			const video = await until(
				'the video document',
				() =>
					tab.evaluate(`return location.pathname.includes('/read/') ? location.pathname : null;`),
				30000
			);
			await tab.goto('/diagnostics');
			await until('the Anki picker', () =>
				tab.evaluate(`return !!document.querySelector('input[aria-label="Anki export"]');`)
			);
			const { root } = await tab.send('DOM.getDocument');
			const { nodeId } = await tab.send('DOM.querySelector', {
				nodeId: root.nodeId,
				selector: 'input[aria-label="Anki export"]'
			});
			await tab.send('DOM.setFileInputFiles', {
				nodeId,
				files: [absolute('tests/fixtures/anki/anki-words.json')]
			});
			const preview = await until(
				'the preview',
				() =>
					tab.evaluate(
						`return [...document.querySelectorAll('dd p')].find((p) => p.textContent.includes('This sets'))?.textContent.replace(/\\s+/g, ' ') ?? null;`
					),
				30000
			).catch(async (error) => {
				const note = await tab.evaluate(
					`return { note: document.querySelector('[role=status]')?.textContent ?? null, files: document.querySelector('input[aria-label="Anki export"]').files.length };`
				);
				throw new Error(`${error.message}; ${JSON.stringify(note)}`);
			});
			await tab.evaluate(
				`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Import').click(); return true;`
			);
			const done = await until(
				'the import to finish',
				() =>
					tab.evaluate(
						`return [...document.querySelectorAll('[role=status]')].map((n) => n.textContent).find((t) => t.startsWith('Imported')) ?? null;`
					),
				30000
			).catch(async (error) => {
				const notes = await tab.evaluate(
					`return [...document.querySelectorAll('[role=status], [role=alert], .notices *')].map((n) => n.textContent.trim().slice(0, 120)).filter(Boolean);`
				);
				throw new Error(`${error.message}; ${JSON.stringify(notes)}`);
			});
			await tab.goto(video.replace(BASE, ''));
			const shaded = await until(
				'关税 in its Anki level',
				() =>
					tab.evaluate(
						`return [...document.querySelectorAll('.lines .token.state-anki-mature')].map((t) => t.textContent).join(' ') || null;`
					),
				15000,
				250
			).catch(async (error) => {
				const seen = await tab.evaluate(
					`return { at: location.pathname, tokens: document.querySelectorAll('.token').length, 关税: [...document.querySelectorAll('.token')].filter((t) => t.textContent === '关税').map((t) => t.className + ' in ' + (t.closest('[class]')?.parentElement?.className ?? '')) };`
				);
				throw new Error(`${error.message}; ${JSON.stringify(seen)}`);
			});
			return {
				pass:
					/This sets 5 words/.test(preview) && /5 words set/.test(done) && shaded.includes('关税'),
				preview,
				done,
				shaded
			};
		} finally {
			await tab.close();
		}
	},

	// The Language Reactor layout: on a phone-sized screen the video fills it, with the current line
	// on it and its English blurred until tapped. Saves stage-blurred.png and stage-shown.png in the
	// working directory, because a layout is checked by looking at it.
	async stage() {
		const { writeFileSync } = await import('node:fs');
		const tab = await openTab('about:blank');
		const shot = async (name) => {
			const { data } = await tab.send('Page.captureScreenshot', { format: 'png' });
			writeFileSync(name, Buffer.from(data, 'base64'));
		};
		try {
			await tab.send('Emulation.setDeviceMetricsOverride', {
				width: 412,
				height: 915,
				deviceScaleFactor: 2,
				mobile: true
			});
			await importFromTermux(tab, 'Test clip, 45 s');
			await until(
				'the video to be playable',
				() => tab.evaluate(`return document.querySelector('video')?.readyState >= 2 || null;`),
				30000,
				250
			);
			await tab.evaluate(`
				const video = document.querySelector('video');
				video.muted = true;
				video.currentTime = 5;
				await video.play();
				await new Promise((r) => setTimeout(r, 700));
				video.pause();
				return true;
			`);
			const before = await until(
				'the current line on the video',
				() =>
					tab.evaluate(`
						const line = document.querySelector('.media.stage .subtitles .chinese');
						const english = document.querySelector('.media.stage .english-line');
						return line && english ? { chinese: line.textContent, blurred: english.classList.contains('blurred'), listHidden: getComputedStyle(document.querySelector('.lines')).display === 'none' } : null;
					`),
				10000,
				250
			);
			await shot('stage-blurred.png');
			await tab.evaluate(`document.querySelector('.english-line').click(); return true;`);
			await new Promise((r) => setTimeout(r, 400));
			const after = await tab.evaluate(
				`return !document.querySelector('.english-line').classList.contains('blurred');`
			);
			await shot('stage-shown.png');
			return {
				pass: before.blurred && before.listHidden && after,
				...before,
				unblurredOnTap: after
			};
		} finally {
			await tab.close();
		}
	},

	// A share shows up while it is still downloading, and a tap on it opens it once it is done.
	// DOWNLOADS is the served fixtures' downloads folder (make-fixtures.sh); this adds a job there
	// with only a progress file, then gives it fixture-media's finished bundle.
	async downloading() {
		const { cpSync, mkdirSync, rmSync, writeFileSync } = await import('node:fs');
		const downloads = process.env.DOWNLOADS;
		if (!downloads) throw new Error('set DOWNLOADS to the served downloads folder');
		const job = `${downloads}/99999999-downloading`;
		rmSync(job, { recursive: true, force: true });
		mkdirSync(job);
		writeFileSync(
			`${job}/progress.json`,
			JSON.stringify({
				stage: 'downloading',
				title: 'Still downloading',
				part: 'video',
				percent: 40
			})
		);
		const tab = await openTab(`${appOrigin}${BASE}/`);
		try {
			const bar = await until(
				'the download with its bar',
				() =>
					tab.evaluate(`
						const item = [...document.querySelectorAll('.fresh li')].find((li) => li.textContent.includes('Still downloading'));
						const bar = item?.querySelector('progress');
						return bar ? { value: bar.value, label: item.querySelector('.progress-bar span')?.textContent } : null;
					`),
				20000,
				250
			);
			await tab.evaluate(`
				[...document.querySelectorAll('.fresh li')].find((li) => li.textContent.includes('Still downloading')).querySelector('button').click();
				return true;
			`);
			const waiting = await tab.evaluate(
				`return [...document.querySelectorAll('.fresh li button')].some((b) => b.textContent.includes('Opens when ready'));`
			);
			for (const file of ['bundle.tar', 'meta.json'])
				cpSync(`${downloads}/fixture-media/${file}`, `${job}/${file}`);
			rmSync(`${job}/progress.json`);
			const opened = await until(
				'the video to open by itself',
				() =>
					tab.evaluate(`return location.pathname.includes('/read/') ? location.pathname : null;`),
				20000,
				250
			);
			return { pass: bar.value === 0.4 && waiting && !!opened, bar, waiting, opened };
		} finally {
			await tab.close();
			rmSync(job, { recursive: true, force: true });
		}
	},

	// A new version is offered: load the build being served, let its worker take control, then swap
	// in another build (UPDATE_TO, a second `npm run build` copied aside) and reload. The installed
	// app on the phone once showed no offer with a newer worker waiting.
	async update() {
		const { cpSync, readFileSync } = await import('node:fs');
		if (!process.env.UPDATE_TO) throw new Error('set UPDATE_TO to a second build directory');
		const tab = await openTab(`${appOrigin}${BASE}/`);
		try {
			await until(
				'the first worker to control the page',
				() => tab.evaluate(`return !!navigator.serviceWorker.controller;`),
				30000
			);
			const before = await tab.evaluate(
				`return (await (await fetch('${BASE}/_app/version.json', { cache: 'no-store' })).json()).version;`
			);
			cpSync(process.env.UPDATE_TO, 'build', { recursive: true });
			const to = JSON.parse(
				readFileSync(`${process.env.UPDATE_TO}/_app/version.json`, 'utf8')
			).version;
			await tab.evaluate(`location.reload(); return true;`);
			// Either outcome is right, depending on which build the reload got. An older page is offered
			// the new version; a page that is already the new build (an online start fetches it from the
			// network) has the waiting worker activated quietly, and nothing is left waiting.
			const outcome = await until(
				'an offer, or the waiting worker activated',
				() =>
					tab.evaluate(`
						if (document.body.innerText.includes('A new version is ready')) return 'offered';
						const r = await navigator.serviceWorker.getRegistration();
						const ask = (w) => new Promise((done) => { const c = new MessageChannel(); c.port1.onmessage = (e) => done(e.data); w.postMessage({ type: 'which-version' }, [c.port2]); setTimeout(() => done(null), 1000); });
						return !r.waiting && r.active && (await ask(r.active)) === '${to}' ? 'activated quietly' : null;
					`),
				30000,
				500
			);
			return { pass: !!outcome, outcome, before, to };
		} finally {
			await tab.close();
		}
	},

	// Quick English (ADR-0023): with no English from Termux at all, tapping a line's EN still shows
	// English, from opus-mt running in the browser. Serve a fixture-media job that has no
	// media.en.vtt (make-fixtures.sh, without running translate.py). The first run downloads the
	// model (~115 MB), so it is slow once.
	async quick() {
		const tab = await openTab('about:blank');
		try {
			await importFromTermux(tab, 'Test clip, 45 s');
			await until(
				'the document to open',
				() => tab.evaluate(`return !!document.querySelector('.lines .reveal');`),
				30000
			);
			const started = Date.now();
			await tab.evaluate(`document.querySelector('.lines .reveal').click(); return true;`);
			const shown = await until(
				'quick English on the first line',
				() =>
					tab.evaluate(`
						const english = document.querySelector('.lines p .english');
						return english && !english.classList.contains('pending')
							? { text: english.textContent, quick: english.classList.contains('quick') }
							: null;
					`),
				120000,
				1000
			).catch(async (error) => {
				// What Reader told the reader is the first thing to know when this times out.
				const status = await tab.evaluate(
					`return document.querySelector('.quick-status')?.textContent ?? 'no status line';`
				);
				const cached = await tab.evaluate(`
					const cache = await caches.open('language-reader-model-v1');
					return (await cache.keys()).map((r) => r.url.split('/').slice(-2).join('/'));
				`);
				throw new Error(
					`${error.message}; Reader said: ${status}; in the model cache: ${JSON.stringify(cached)}`
				);
			});
			const seconds = Math.round((Date.now() - started) / 1000);
			const later = await until(
				'more lines translated in the background',
				() =>
					tab.evaluate(`
						document.querySelector('.all-english input').click();
						const n = document.querySelectorAll('.lines .english.quick').length;
						return n >= 5 ? n : null;
					`),
				60000,
				1000
			);
			return {
				pass: shown.quick && /[a-z]/i.test(shown.text) && !/^EN: /.test(shown.text) && later >= 5,
				...shown,
				secondsToFirstLine: seconds,
				quickLinesAfter: later
			};
		} finally {
			await tab.close();
		}
	},

	// The word sheet fits a phone in full screen, which is landscape and about 384 px tall: its top
	// (the word and its meaning) was cut off. Screenshots go to sheet-*.png in the working directory.
	async sheet() {
		const tab = await openTab('about:blank');
		const { writeFileSync } = await import('node:fs');
		try {
			await tab.goto('/add');
			await until('the paste box', () =>
				tab.evaluate('return !!document.querySelector("textarea");')
			);
			await tab.evaluate(`
				const box = document.querySelector('textarea');
				box.value = '我们学习中文。你是哪国人？';
				box.dispatchEvent(new Event('input', { bubbles: true }));
				return true;`);
			await until('Save to be enabled', () =>
				tab.evaluate(`return ${SAVE_BUTTON} && !${SAVE_BUTTON}.disabled;`)
			);
			await tab.evaluate(`${SAVE_BUTTON}.click(); return true;`);
			const link = await until('the saved document', () => tab.evaluate(`return ${READ_LINK};`));
			await tab.evaluate(`location.href = ${JSON.stringify(link)}; return true;`);
			const result = {};
			for (const [name, width, height] of [
				['landscape', 853, 384],
				['portrait', 384, 853]
			]) {
				await tab.send('Emulation.setDeviceMetricsOverride', {
					width,
					height,
					deviceScaleFactor: 2.8,
					mobile: true
				});
				await until('a word', () =>
					tab.evaluate(
						`const b = document.querySelector('.reading button.token'); if (!b) return null; b.click(); return true;`
					)
				);
				const box = await until('the sheet with its meaning', () =>
					tab.evaluate(`
						const sheet = document.querySelector('.sheet');
						if (!sheet || /Looking up/.test(sheet.textContent)) return null;
						const word = sheet.querySelector('.word').getBoundingClientRect();
						return { top: sheet.getBoundingClientRect().top, height: sheet.getBoundingClientRect().height, wordTop: word.top, scroll: sheet.scrollHeight > sheet.clientHeight };`)
				);
				const shot = await tab.send('Page.captureScreenshot', { format: 'png' });
				writeFileSync(`sheet-${name}.png`, Buffer.from(shot.data, 'base64'));
				result[name] = box;
				await tab.evaluate(
					`document.querySelector('.sheet button[aria-label="Cancel"]').click(); return true;`
				);
				await until('the sheet to close', () =>
					tab.evaluate(`return !document.querySelector('.sheet') || null;`)
				);
			}
			return {
				pass: Object.values(result).every((box) => box.top >= 0 && box.wordTop >= 0),
				...result
			};
		} finally {
			await tab.close();
		}
	},

	// Correcting the segmentation (spec 004), plumbing only: join two words from the word sheet,
	// split them back, be refused across punctuation, then undo from More. Words are found by their
	// offsets, not their text, because each button also carries its pinyin.
	// How long a join takes on a long document (the fixture carries a 44 min video's subtitles,
	// 18,629 characters): the reader found corrections slow on such a document.
	async correctlong() {
		const tab = await openTab('about:blank');
		const count = `return document.querySelectorAll('.lines button.token').length;`;
		try {
			await importFromTermux(tab, 'Test clip, 45 s');
			await until(
				'the long document',
				async () => ((await tab.evaluate(count)) > 1000 ? true : null),
				120000,
				250
			);
			// Let the page settle (quick English, the first memory read) before timing.
			await new Promise((resolve) => setTimeout(resolve, 5000));
			const before = await tab.evaluate(count);
			await tab.evaluate(
				`document.querySelectorAll('.lines button.token')[30].click(); return true;`
			);
			await until('the join button', () =>
				tab.evaluate(
					`const b = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? '').startsWith('Join with next')); if (!b || b.disabled) return null; b.click(); return true;`
				)
			);
			const t0 = Date.now();
			await until(
				'the joined word',
				async () => ((await tab.evaluate(count)) < before ? true : null),
				60000,
				20
			);
			const joinMs = Date.now() - t0;
			return { pass: true, joinMs, words: before };
		} finally {
			await tab.close();
		}
	},

	async corrections() {
		const tab = await openTab('about:blank');
		const spans = () =>
			tab.evaluate(
				`return [...document.querySelectorAll('.reading [data-start]')].map((b) => [+b.dataset.start, +b.dataset.end]);`
			);
		const tap = (start) =>
			until(`the word at ${start}`, () =>
				tab.evaluate(
					`const b = document.querySelector('.reading [data-start="${start}"]'); if (!b) return null; b.click(); return true;`
				)
			);
		const press = (label) =>
			until(`the ${label} button`, () =>
				tab.evaluate(
					`const b = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? b.textContent.trim()).startsWith(${JSON.stringify(label)})); if (!b) return null; b.click(); return true;`
				)
			);
		try {
			await tab.send('Storage.clearDataForOrigin', { origin: appOrigin, storageTypes: 'all' });
			await tab.goto('/add');
			await until('the paste box', () =>
				tab.evaluate('return !!document.querySelector("textarea");')
			);
			await tab.evaluate(`
				const box = document.querySelector('textarea');
				box.value = '我们学习中文。你是哪国人？';
				box.dispatchEvent(new Event('input', { bubbles: true }));
				return true;`);
			await until('Save to be enabled', () =>
				tab.evaluate(`return ${SAVE_BUTTON} && !${SAVE_BUTTON}.disabled;`)
			);
			await tab.evaluate(`${SAVE_BUTTON}.click(); return true;`);
			const link = await until('the saved document', () => tab.evaluate(`return ${READ_LINK};`));
			await tab.evaluate(`location.href = ${JSON.stringify(link)}; return true;`);

			const before = await until('words', async () =>
				(await spans()).length > 2 ? spans() : null
			);
			const [a, b] = before; // 我们 and 学习, or however the analyzer cut them: adjacent words
			await tap(a[0]);
			await press('Join with next');
			const t0 = Date.now();
			await until('the joined word', async () =>
				(await spans()).some(([s, e]) => s === a[0] && e === b[1]) ? true : null
			);
			const joinMs = Date.now() - t0;

			await tap(a[0]);
			const cut = a[1] - a[0];
			await until('the split option', () =>
				tab.evaluate(
					`const bs = [...document.querySelectorAll('.sheet button')].filter((b) => (b.getAttribute('aria-label') ?? '').startsWith('Split')); const b = bs[${cut - 1}]; if (!b) return null; b.click(); return true;`
				)
			);
			const splitBack = await until('the split to show', async () =>
				(await spans()).some(([s, e]) => s === a[0] && e === a[1]) ? true : null
			);

			// The word just before 。 cannot join what follows it.
			const last = (await spans()).find(([, e]) => e === 6);
			await tap(last[0]);
			await press('Join with next');
			const refusal = await until('the refusal', () =>
				tab.evaluate(`return document.querySelector('.sheet [role="alert"]')?.textContent ?? null;`)
			);
			await press('Cancel');

			await tap(a[0]);
			await press('Join with next');
			await until('joined again', async () =>
				(await spans()).some(([s, e]) => s === a[0] && e === b[1]) ? true : null
			);
			await tab.goto('/diagnostics');
			const listed = await until('the corrections list', () =>
				tab.evaluate(
					`const dd = [...document.querySelectorAll('dt')].find((d) => d.textContent === 'Corrections')?.nextElementSibling; return dd && dd.querySelector('button') ? dd.textContent : null;`
				)
			);
			// The newest correction is first: the join just made.
			await tab.evaluate(
				`[...document.querySelectorAll('dt')].find((d) => d.textContent === 'Corrections').nextElementSibling.querySelector('button').click(); return true;`
			);
			await until('the undo note', () =>
				tab.evaluate(`return /back to how the segmenter/.test(document.body.textContent) || null;`)
			);
			await tab.goto(link.replace(BASE, ''));
			const after = await until('words again', async () =>
				(await spans()).length > 2 ? spans() : null
			);
			const restored = JSON.stringify(after) === JSON.stringify(before);

			return {
				pass: joinMs < 1000 && splitBack && /boundary/.test(refusal) && restored,
				joinMs,
				listed: listed.trim().slice(0, 80),
				refusal,
				restored
			};
		} finally {
			await tab.close();
		}
	},

	// The reader's work survives the site's storage being wiped (spec 005): mark two words, let the
	// copy reach the reader service, clear everything the origin stores, and restore. Needs
	// scripts/termux/reader-service.py on 127.0.0.1:8765, reachable from the browser (adb reverse
	// on the emulator), and preferably a fresh --root so "latest" is this run's copy.
	async wipe() {
		const service = valueOf('--service') ?? 'http://127.0.0.1:8765';
		const tab = await openTab('about:blank');
		const words = async () =>
			tab.evaluate(
				`return [...new Set([...document.querySelectorAll('.reading .token.state-known')].map((b) => b.textContent))];`
			);
		try {
			// Start from nothing, so the library holds only this run's document: with others
			// present, "the first document" after a restore is not necessarily the one marked.
			await tab.send('Storage.clearDataForOrigin', { origin: appOrigin, storageTypes: 'all' });
			await tab.goto('/');
			await tab.evaluate(
				`localStorage.setItem('reader.copyDelays', JSON.stringify({ quiet: 500, every: 3000 })); return true;`
			);
			await tab.goto('/add');
			await until('the paste box', () =>
				tab.evaluate('return !!document.querySelector("textarea");')
			);
			await tab.evaluate(
				`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Load sample text')).click(); return true;`
			);
			await until('Save to be enabled', () =>
				tab.evaluate(`return ${SAVE_BUTTON} && !${SAVE_BUTTON}.disabled;`)
			);
			await tab.evaluate(`${SAVE_BUTTON}.click(); return true;`);
			const link = await until('the saved document', () => tab.evaluate(`return ${READ_LINK};`));
			await tab.evaluate(`location.href = ${JSON.stringify(link)}; return true;`);
			for (const index of [0, 2]) {
				await until(`word ${index} to mark`, () =>
					tab.evaluate(`
						const word = [...document.querySelectorAll('.reading button.token')].filter((b) => !b.className.includes('state-known'))[${index === 0 ? 0 : 1}];
						if (!word) return null;
						word.click();
						return true;
					`)
				);
				await until('the Known choice', () =>
					tab.evaluate(`
						const choice = [...document.querySelectorAll('.choice')].find((b) => b.textContent.includes('Known'));
						if (!choice) return null;
						choice.click();
						return true;
					`)
				);
				await until('the menu to close', () =>
					tab.evaluate(`return !document.querySelector('.choices');`)
				);
			}
			const marked = await until('two marked words', async () => {
				const list = await words();
				return list.length >= 2 ? list : null;
			});

			const copied = await until(
				'the copy to reach the service with both marks',
				async () => {
					const response = await fetch(`${service}/backup/latest`).catch(() => null);
					if (!response?.ok) return null;
					const copy = await response.json();
					// Every word shown as known, not merely two: an older copy from an earlier run would
					// satisfy "two", and the restore would then rightly bring back that older state.
					const known = new Set(
						copy.states.filter((s) => s.state === 'known').map((s) => s.surface)
					);
					return marked.every((word) => known.has(word)) ? copy : null;
				},
				30000,
				500
			);

			// Leave the page first: the open database holds the files a wipe must remove.
			await tab.send('Page.navigate', { url: 'about:blank' });
			await until('the page to be gone', () =>
				tab.evaluate(`return location.href === 'about:blank';`)
			);
			await tab.send('Storage.clearDataForOrigin', { origin: appOrigin, storageTypes: 'all' });

			await tab.goto('/');
			await until(
				'the restore offer',
				() =>
					tab.evaluate(
						`return [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Restore');`
					),
				30000
			);
			const emptyBeforeRestore = await tab.evaluate(`return ${READ_LINKS};`);
			await tab.evaluate(
				`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Restore').click(); return true;`
			);
			// A restored text is listed under Texts: wait for the restore to finish, then look there.
			await until(
				'the restore to finish',
				() =>
					tab.evaluate(
						`return ![...document.querySelectorAll('button')].some((b) => /^Restor/.test(b.textContent.trim()));`
					),
				30000
			);
			await tab.goto('/texts');
			const restoredLink = await until(
				'the restored document',
				() => tab.evaluate(`return ${READ_LINK};`),
				30000
			);
			await tab.evaluate(`location.href = ${JSON.stringify(restoredLink)}; return true;`);
			const restored = await until(
				'the marks to be back',
				async () => {
					const list = await words();
					return list.length >= 2 ? list : null;
				},
				30000
			);
			return {
				pass:
					emptyBeforeRestore === 0 &&
					restored.length === marked.length &&
					restored.every((w) => marked.includes(w)),
				marked,
				copiedStates: copied.states.length,
				emptyBeforeRestore,
				restored
			};
		} finally {
			await tab.close();
		}
	},

	// A video without subtitles, transcribed by Reader itself (spec 008): readable as lines arrive,
	// and an ordinary document once the transcript is done. Needs make-fixtures.sh's fixture-live
	// served by the reader service on 127.0.0.1:8765. Downloads the speech model (239 MB) from Hugging
	// Face into the fresh profile, so it is slow, like `model`.
	async live() {
		const tab = await openTab('about:blank');
		try {
			await importFromTermux(tab, 'Test clip without subtitles');
			await until(
				'the live page',
				() => tab.evaluate(`return location.pathname.includes('/live/');`),
				30000
			);
			// What the page says before there is anything to read: a bar or the offer, not a blank.
			const waitingLabel = await until(
				'something to show before the first lines',
				() =>
					tab.evaluate(`return document.querySelector('.progress')?.textContent?.trim() || null;`),
				10000,
				100
			).catch(() => null);
			await until(
				'the offer to download the speech model',
				() =>
					tab.evaluate(`
						const button = [...document.querySelectorAll('.speech-model button')].find((b) => b.textContent.includes('Download'));
						if (!button) return null;
						button.click();
						return true;
					`),
				20000,
				250
			);
			// The download and the calibration are the device's, not the page's: timed from when both end.
			await until(
				'the model downloaded and calibrated',
				() => tab.evaluate(`return document.querySelector('.speech-model') ? null : true;`),
				900000,
				1000
			);
			const ready = Date.now();
			const firstLines = await until(
				'the first transcribed lines',
				() => tab.evaluate(`return document.querySelectorAll('.lines p').length || null;`),
				60000,
				250
			);
			const secondsToFirstLines = (Date.now() - ready) / 1000;
			const word = await tab.evaluate(`
				const button = document.querySelector('.lines button.token');
				button.click();
				return button.textContent;
			`);
			const meaning = await until('a meaning for the tapped word', () =>
				tab.evaluate(`
					const sheet = document.querySelector('.meanings');
					return sheet && !sheet.textContent.includes('Looking up') ? sheet.innerText.slice(0, 80) : null;
				`)
			);
			const markingHidden = await tab.evaluate(`return !document.querySelector('.choices');`);
			await tab.evaluate(`document.querySelector('.cancel')?.click(); return true;`);
			const stored = await until(
				'the finished transcript to become a stored document',
				() =>
					tab.evaluate(`
						const video = document.querySelector('video');
						const lines = document.querySelectorAll('.lines p').length;
						if (!location.pathname.includes('/read/') || !video || !(video.duration > 0) || !lines) return null;
						return { url: location.pathname + location.search, lines };
					`),
				180000,
				500
			);
			const method = await tab
				.evaluate(
					`
				const id = location.pathname.split('/').filter(Boolean).pop();
				const media = await (await navigator.storage.getDirectory()).getDirectoryHandle('media');
				const file = await (await (await media.getDirectoryHandle(id)).getFileHandle('media.zh.method.json')).getFile();
				return JSON.parse(await file.text());
			`
				)
				.catch((error) => ({ error: String(error) }));
			const diagnostics = await tab.evaluate(`
				return { isolated: self.crossOriginIsolated, cores: navigator.hardwareConcurrency };
			`);
			return {
				pass:
					secondsToFirstLines < 20 &&
					!!meaning &&
					markingHidden &&
					stored.lines >= firstLines &&
					method?.model === 'sense-voice-small-int8' &&
					!!waitingLabel,
				waitingLabel,
				secondsToFirstLines,
				firstLines,
				word,
				meaning,
				markingHidden,
				stored,
				method,
				diagnostics
			};
		} finally {
			await tab.close();
		}
	},

	// Tapping a word shows its pinyin and meaning, and links its sentence to a translator. Opens
	// the first document in the library, so run after anything that saved one (media, words).
	async lookup() {
		const tab = await openTab('about:blank');
		try {
			await tab.goto('/texts');
			const link = await until('a document in the library', () =>
				tab.evaluate(`return ${READ_LINK};`)
			);
			await tab.evaluate(`location.href = ${JSON.stringify(link)}; return true;`);
			const word = await until('a word to tap', () =>
				tab.evaluate(`
					const button = [...document.querySelectorAll('.reading button.token')].find((b) => b.textContent.length > 1);
					if (!button) return null;
					button.click();
					const plain = button.cloneNode(true); plain.querySelectorAll('rt').forEach((rt) => rt.remove()); return plain.textContent;
				`)
			);
			const started = Date.now();
			const shown = await until(
				'the meaning to appear',
				() =>
					tab.evaluate(`
						const sheet = document.querySelector('.meanings');
						if (!sheet || sheet.textContent.includes('Looking up')) return null;
						return {
							meaning: sheet.innerText.slice(0, 200),
							translate: document.querySelector('.sheet a[aria-label="Translate sentence"]')?.href ?? null
						};
					`),
				30000
			);
			const sentence =
				shown.translate && decodeURIComponent(new URL(shown.translate).searchParams.get('text'));
			return {
				pass:
					!!shown.translate &&
					sentence.includes(word) &&
					/[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/.test(shown.meaning),
				word,
				secondsToMeaning: (Date.now() - started) / 1000,
				meaning: shown.meaning,
				sentence
			};
		} finally {
			await tab.close();
		}
	},

	// Spec 007: what happens on the stage is recorded as encounters, and the attention question is
	// asked over the next page after leaving. Needs the fixture-media job served, as for `media`.
	async encounters() {
		const tab = await openTab('about:blank');
		try {
			await importFromTermux(tab, 'Test clip, 45 s');
			await until(
				'the video to be playable',
				() => tab.evaluate(`return document.querySelector('video')?.readyState >= 2 || null;`),
				60000,
				250
			);
			// Play 2 s → 34 s at double speed: past the 30 s that makes the question worth asking.
			await tab.evaluate(`
				const video = document.querySelector('video');
				video.muted = true;
				video.currentTime = 2;
				video.playbackRate = 2;
				await video.play();
				await new Promise((r) => { const t = setInterval(() => { if (video.currentTime >= 34) { clearInterval(t); r(); } }, 100); });
				return true;
			`);
			const tapWord = (then) =>
				tab.evaluate(`
					const word = document.querySelector('.media.stage .subtitles button.token');
					if (!word) return null;
					word.click();
					await new Promise((r) => setTimeout(r, 300));
					const button = [...document.querySelectorAll('.sheet button')].find((b) => (b.getAttribute('aria-label') ?? b.textContent.trim()) === ${JSON.stringify(then)});
					if (!button) return null;
					button.click();
					const plain = word.cloneNode(true); plain.querySelectorAll('rt').forEach((rt) => rt.remove()); return plain.textContent;
				`);
			const checked = await until('a word checked', () => tapWord('I knew it'));
			const looked = await until('a word looked up', () => tapWord('Cancel'));
			// US2: the word now has a memory, so it is coloured by recall, and its sheet says so.
			const coloured = await until('the looked-up word coloured by recall', () =>
				tab.evaluate(`
					const word = document.querySelector('.media.stage .subtitles button.token');
					// Just looked up: still being learned, so fragile (colourBand).
					if (!word || !/recall-4/.test(word.className)) return null;
					word.click();
					await new Promise((r) => setTimeout(r, 300));
					const said = [...document.querySelectorAll('.sheet .memory')].map((p) => p.textContent).join(' | ');
					[...document.querySelectorAll('.sheet button')].find((b) => b.textContent.trim() === 'Cancel').click();
					return { className: word.className, said };
				`)
			);
			await tab.evaluate(`
				document.querySelector('button[aria-label^="Replay"]').click();
				await new Promise((r) => setTimeout(r, 1200));
				const video = document.querySelector('video');
				video.currentTime = 40;
				await new Promise((r) => setTimeout(r, 800));
				video.pause();
				document.querySelector('.back-to-videos').click();
				return true;
			`);
			const asked = await until('the attention question', () =>
				tab.evaluate(`
					const choice = [...document.querySelectorAll('.sheet .choice')].find((b) => b.textContent.startsWith('Some'));
					if (!choice) return null;
					choice.click();
					return true;
				`)
			);
			await until('leaving for the library', () =>
				tab.evaluate(`return !location.pathname.includes('/read/') || null;`)
			);
			await tab.goto('/diagnostics');
			const recorded = await until('the session on Diagnostics', () =>
				tab.evaluate(`
					const sitting = document.querySelector('.sitting');
					if (!sitting) return null;
					return [...sitting.querySelectorAll('.encounters li')].map((li) => li.textContent.replace(/\\s+/g, ' ').trim());
				`)
			);
			const kinds = recorded.map((line) => line.split(/[ ·]/)[0]);
			const want = ['played', 'check', 'lookup', 'replay', 'seek', 'attention'];
			return {
				pass:
					asked &&
					want.every((kind) => kinds.includes(kind)) &&
					recorded.some((line) => line.startsWith('check') && line.includes(checked)) &&
					recorded.some((line) => line.startsWith('lookup') && line.includes('2×')) &&
					recorded.some((line) => line.includes('"answer":"some"')) &&
					recorded.some((line) => /^seek.*"fromMs":3\d{4},"toMs":40\d{3}/.test(line)) &&
					/^Reading: \d+% today/.test(coloured.said),
				coloured,
				checked,
				looked,
				recorded
			};
		} finally {
			await tab.close();
		}
	},

	// Spec 007 US3: a word looked up on the stage becomes a card, shown in its sentence; Again brings
	// it back in the same session, Easy finishes it. Needs the fixture-media job served.
	async cards() {
		const tab = await openTab('about:blank');
		try {
			await importFromTermux(tab, 'Test clip, 45 s');
			await until(
				'the video to be playable',
				() => tab.evaluate(`return document.querySelector('video')?.readyState >= 2 || null;`),
				60000,
				250
			);
			await tab.evaluate(
				`const v = document.querySelector('video'); v.muted = true; v.currentTime = 10; v.play(); return true;`
			);
			await new Promise((r) => setTimeout(r, 1500));
			const word = await until('a word looked up', () =>
				tab.evaluate(`
					const word = document.querySelector('.media.stage .subtitles button.token');
					if (!word) return null;
					word.click();
					await new Promise((r) => setTimeout(r, 300));
					[...document.querySelectorAll('.sheet button')].find((b) => b.textContent.trim() === 'Cancel').click();
					const plain = word.cloneNode(true); plain.querySelectorAll('rt').forEach((rt) => rt.remove()); return plain.textContent;
				`)
			);
			await tab.evaluate(`document.querySelector('.back-to-videos').click(); return true;`);
			await until('the library', () =>
				tab.evaluate(`return !location.pathname.includes('/read/') || null;`)
			);
			await tab.evaluate(`
				const skip = [...document.querySelectorAll('.sheet button')].find((b) => b.textContent.trim() === 'Skip');
				skip?.click();
				[...document.querySelectorAll('nav.tabs a')].find((a) => a.textContent.includes('Cards')).click();
				return true;
			`);
			const card = await until('a card', () =>
				tab.evaluate(`
					const mark = document.querySelector('.card .sentence mark');
					const plain = (el) => { const c = el.cloneNode(true); c.querySelectorAll('rt').forEach((rt) => rt.remove()); return c.textContent.trim(); };
					// The target word hides its pinyin until the reveal; its context shows it.
					return mark ? { counts: document.querySelector('.subtitle')?.textContent.trim(), word: mark.textContent, wordPinyin: mark.querySelectorAll('rt').length, contextPinyin: mark.parentElement.querySelectorAll('rt').length, sentence: plain(mark.parentElement) } : null;
				`)
			);
			const started = Date.now();
			const shown = await until('the answer', () =>
				tab.evaluate(`
					document.querySelector('.card .reveal')?.click();
					const answer = document.querySelector('.card .answer');
					if (!answer || answer.textContent.includes('Looking up')) return null;
					return answer.textContent.slice(0, 120);
				`)
			);
			const grade = (label) =>
				tab.evaluate(`
					[...document.querySelectorAll('.card .grade')].find((b) => b.textContent.trim() === ${JSON.stringify(label)}).click();
					return true;
				`);
			await grade('Again');
			const back = await until('the card again', () =>
				tab.evaluate(`
					const mark = document.querySelector('.card .sentence mark');
					return mark && !document.querySelector('.card .grade') ? mark.textContent : null;
				`)
			);
			const secondsToNext = (Date.now() - started) / 1000;
			await tab.evaluate(`document.querySelector('.card .reveal').click(); return true;`);
			await until('grades', () =>
				tab.evaluate(`return document.querySelector('.card .grade') ? true : null;`)
			);
			// Easy, not Good: Good leaves a card answered Again in learning, due again within the
			// 20-minute learn-ahead, so with nothing else to review it would simply come back.
			await grade('Easy');
			const done = await until('done', () =>
				tab.evaluate(`return document.querySelector('.empty')?.textContent.trim() || null;`)
			);
			return {
				pass:
					card.word === word &&
					card.wordPinyin === 0 &&
					card.contextPinyin > 0 &&
					back === word &&
					/pinyin|[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/.test(shown) &&
					done.startsWith('Done'),
				word,
				card,
				shown,
				back,
				secondsToNext,
				done
			};
		} finally {
			await tab.close();
		}
	},

	// A Termux job with subtitles, imported from New from Termux and played. Needs make-fixtures.sh's
	// fixture-media job served by reader-service.py on 127.0.0.1:8765.
	// The library's extras: a picture taken from the video, and the shares of known, learning and
	// new words. English titles are not checked here: they need quick English's model, which a fresh
	// profile does not have and the library never downloads.
	async library() {
		const tab = await openTab('about:blank');
		try {
			await importFromTermux(tab, 'Test clip, 45 s');
			await until(
				'the imported document to open',
				() =>
					tab.evaluate(
						`return location.pathname.includes('/read/') && document.querySelector('.player')?.duration > 0 || null;`
					),
				120000,
				250
			);
			// Seven seconds played, from the sixth line, past the recorder's 5 s flush: the library shows how
			// far that got.
			await tab.evaluate(`
				const player = document.querySelector('.player');
				player.muted = true;
				document.querySelectorAll('.seek')[5].click();
				return true;
			`);
			await new Promise((resolve) => setTimeout(resolve, 7000));
			await tab.goto('/');
			const shown = await until(
				'a picture and shares in the library',
				() =>
					tab.evaluate(`
						const picture = document.querySelector('.library img.picture');
						const meta = document.querySelector('.library .meta')?.textContent.replace(/\\s+/g, ' ').trim();
						const watched = document.querySelector('.library .watched')?.style.width;
						if (!picture?.naturalWidth || !meta?.includes('known') || !watched) return null;
						return { width: picture.naturalWidth, height: picture.naturalHeight, meta, watched };
					`),
				30000,
				250
			);
			return { pass: shown.width === 320 && /\d+% new/.test(shown.meta), ...shown };
		} finally {
			await tab.close();
		}
	},

	// "Stop after each line" on: a line stops at its end, and "next line" plays the next one rather
	// than stopping again at once (it did: the stop measured against the line before).
	async autostop() {
		const tab = await openTab('about:blank');
		try {
			await importFromTermux(tab, 'Test clip, 45 s');
			await until(
				'the imported document to open',
				() =>
					tab.evaluate(
						`return (location.pathname.includes('/read/') && document.querySelector('.player')?.duration > 0) || null;`
					),
				120000,
				250
			);
			await tab.evaluate(
				`localStorage.setItem('reader.pauseEachLine', 'true'); location.reload(); return true;`
			);
			await until('the player again', () =>
				tab.evaluate(`return document.querySelector('.player')?.duration > 0 || null;`)
			);
			await tab.evaluate(`
				const player = document.querySelector('.player');
				player.muted = true;
				document.querySelectorAll('.seek')[3].click();
				return true;
			`);
			const stopped = await until(
				'line 3 to stop at its end',
				() =>
					tab.evaluate(`
						const player = document.querySelector('.player');
						return player.paused && player.currentTime > 0 ? player.currentTime : null;
					`),
				20000,
				100
			);
			await tab.evaluate(
				`document.querySelector('[aria-label="Next line"]').click(); return true;`
			);
			await new Promise((resolve) => setTimeout(resolve, 600));
			const after = await tab.evaluate(`
				const player = document.querySelector('.player');
				return { paused: player.paused, time: player.currentTime };
			`);
			// And the line it went on to stops at its own end.
			const next = await until(
				'the next line to stop at its end',
				() =>
					tab.evaluate(`
						const player = document.querySelector('.player');
						return player.paused ? player.currentTime : null;
					`),
				20000,
				100
			);
			return {
				pass: !after.paused && after.time > stopped && next > after.time,
				stopped,
				...after,
				next
			};
		} finally {
			await tab.close();
		}
	},

	// A clause the subtitles cut over two lines is shown as one line with one English, once Termux's
	// English cue spans both. Needs fixture-media's media.en.vtt made by translate.py with
	// TRANSLATE_STUB=1 and every two lines one clause (see the commit that added this).
	async clauses() {
		const tab = await openTab('about:blank');
		try {
			await importFromTermux(tab, 'Test clip, 45 s');
			const shown = await until(
				'the first line to show two lines as one, with its English',
				() =>
					tab.evaluate(`
						const box = document.querySelector('.all-english input');
						if (box && !box.checked) box.click();
						const first = document.querySelector('#line-0');
						const english = first?.querySelector('.english')?.textContent;
						if (!english?.startsWith('EN: ')) return null;
						const chinese = [...first.querySelectorAll('.token')].map((t) => t.textContent).join('').replace(/[^\\u4e00-\\u9fff]/g, '');
						return { chinese, english, shown: document.querySelectorAll('.lines p').length };
					`),
				60000,
				250
			);
			return {
				pass: shown.english === 'EN: ' + shown.chinese && [...shown.chinese].length > 3,
				...shown
			};
		} finally {
			await tab.close();
		}
	},

	async media() {
		const tab = await openTab('about:blank');
		try {
			await importFromTermux(tab, 'Test clip, 45 s');
			// A share imports by itself; nothing to press.
			const started = Date.now();
			const opened = await until(
				'the imported document to open with its player',
				() =>
					tab.evaluate(`
						const player = document.querySelector('.player');
						if (!location.pathname.includes('/read/') || !player || !(player.duration > 0)) return null;
						return { lines: document.querySelectorAll('.lines p').length, duration: player.duration, title: document.querySelector('h1')?.textContent };
					`),
				120000,
				250
			);
			const secondsToOpen = (Date.now() - started) / 1000;
			const followed = await until('the current line to follow a seek', () =>
				tab.evaluate(`
					const player = document.querySelector('.player');
					player.muted = true;
					if (player.paused) document.querySelectorAll('.seek')[5].click();
					const current = document.querySelector('.lines p.current');
					return current ? { current: current.id, time: player.currentTime } : null;
				`)
			);
			return {
				pass: opened.lines > 10 && followed.current === 'line-5',
				secondsToOpen,
				...opened,
				...followed
			};
		} finally {
			await tab.close();
		}
	},

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

	// SC-004 with the model on the device: a 5,000-character document must appear within 3 seconds.
	//
	// Only meaningful once the model has been downloaded, which is why run.mjs warms this with the
	// `model` scenario. Without it `activeAnalyzer()` is the dictionary anyway and the check would
	// pass while proving nothing -- the thing being tested is that import uses the fast fallback
	// *even when the slow model is available* (research.md R18).
	async bigimport() {
		const tab = await openTab('about:blank');
		try {
			await tab.goto('/diagnostics');
			const hasModel = await until('the diagnostics page to say which analyzer is in use', () =>
				tab.evaluate(
					`return [...document.querySelectorAll('dd')].map((d) => d.textContent).find((t) => /bert-ws|cedict/.test(t)) || null`
				)
			);
			// Reported rather than required. With the model on the device this is the strong check —
			// that import stays fast even when a slow analyzer is available. Without it, it still
			// establishes that importing and opening 4,999 characters is fast end to end in a real
			// browser, which is worth having on its own. What it cannot establish without the model
			// is the *absence of a branch* at import; that is guaranteed by there being no code path
			// there that consults the model, and by the unit tests around
			// `needsImmediateRederivation`. Say which one ran, in the result, rather than let a
			// green line be read as the stronger claim.
			const modelPresent = /bert-ws/.test(hasModel);

			await tab.goto('/add');
			await until('the paste box', () =>
				tab.evaluate('return !!document.querySelector("main textarea")')
			);

			// 4,999 code points: one under the limit, and the size the reader actually reported.
			const typed = await tab.evaluate(`
				const filler = '我读的时候词与词之间是分开的，而是我自己在脑子里分开的。看到一句话，我会先找出我认识的词。';
				let text = '';
				while ([...text].length < 4999) text += filler;
				text = [...text].slice(0, 4999).join('');
				const box = document.querySelector('main textarea');
				box.value = text;
				box.dispatchEvent(new Event('input', { bubbles: true }));
				return [...text].length;
			`);

			const before = await tab.evaluate(`return ${READ_LINKS}`);
			const startedSaving = Date.now();
			const clicked = await tab.evaluate(`
				const b = ${SAVE_BUTTON};
				if (!b || b.disabled) return false;
				b.click();
				return true;
			`);
			if (!clicked) return { pass: false, error: 'the Save button was missing or disabled', typed };

			await until(
				'the document to be saved',
				async () => ((await tab.evaluate(`return ${READ_LINKS}`)) > before ? true : null),
				60000,
				50
			);
			const importMs = Date.now() - startedSaving;

			// And opening it, which is the other half: showing a document that is now out of date
			// under the model must not pay for the upgrade either.
			const link = await tab.evaluate(`return ${READ_LINK}`);
			const startedOpening = Date.now();
			await tab.send('Page.navigate', { url: `${appOrigin}${link}` });
			const words = await until(
				'the reader to render words',
				async () => {
					const n = await tab.evaluate(
						'return document.querySelectorAll(".reading button.token").length'
					);
					return n > 0 ? n : null;
				},
				60000,
				50
			);
			const openMs = Date.now() - startedOpening;

			return {
				pass: importMs < 3000 && openMs < 3000,
				modelPresent,
				analyzerInUse: hasModel.trim().slice(0, 60),
				typed,
				importMs,
				openMs,
				words,
				budgetMs: 3000,
				note: modelPresent
					? 'the strong check: the model was on the device and import still used the fallback. The background sweep may be upgrading at the same time, which is realistic.'
					: 'WEAKER: the model was not on the device, so this measures the dictionary path only. Run the `model` scenario first (or drop --no-warm) for the check that matters.'
			};
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
			await tab.goto('/add');
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
			// Spec 008: the worker supplies cross-origin isolation, so a load it serves is isolated.
			// The first load is not (nothing reloads it, per firstload); the next one is.
			await tab.goto('/');
			const isolated = await until('cross-origin isolated once served by the worker', () =>
				tab.evaluate('return self.crossOriginIsolated === true || null')
			);
			return {
				pass: !!controlled && manifest.ok && manifest.icons > 0 && isolated === true,
				controlled,
				isolated,
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
			await tab.goto('/texts');
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
	// A first visit must not reload itself. Found while chasing `readonly`, which kept failing
	// because the reload landed on the click it was making (T093).
	async firstload() {
		const tab = await openTab('about:blank');
		try {
			await tab.goto('/add');
			await until('the paste box to render', () =>
				tab.evaluate('return !!document.querySelector("textarea");')
			);

			// A value on `window` survives anything except a new document. Cheaper and more direct
			// than watching navigation events, and it cannot be confused by SPA routing.
			await tab.evaluate('window.__stillHere = true; return true;');

			const deadline = Date.now() + 20000;
			let reloadedAfterMs = null;
			const started = Date.now();
			while (Date.now() < deadline) {
				const state = await tab.evaluate(`
					return {
						stillHere: window.__stillHere === true,
						controlled: !!navigator.serviceWorker.controller,
						navigation: performance.getEntriesByType('navigation')[0]?.type ?? null
					};
				`);
				if (!state.stillHere) {
					reloadedAfterMs = Date.now() - started;
					return {
						pass: false,
						error: 'the page reloaded itself on a first visit',
						reloadedAfterMs,
						navigation: state.navigation,
						controlled: state.controlled,
						note: 'anything the reader had typed at that moment is gone'
					};
				}
				if (state.controlled) {
					// Controlled without having reloaded: give it a moment to prove it stays put,
					// because the reload would happen on the controllerchange we just saw.
					await new Promise((resolve) => setTimeout(resolve, 1500));
					const after = await tab.evaluate('return window.__stillHere === true;');
					return {
						pass: after,
						controlled: true,
						waitedForControlMs: Date.now() - started,
						note: after
							? 'the worker took control and the page stayed put'
							: 'the page reloaded just after the worker took control'
					};
				}
				await new Promise((resolve) => setTimeout(resolve, 200));
			}

			return { pass: false, error: 'the worker never took control within 20 s' };
		} finally {
			await tab.close();
		}
	},

	async readonly() {
		const first = await openTab('about:blank');
		const second = await openTab('about:blank');
		const console_ = [];
		try {
			await first.send('Runtime.enable');
			await first.send('Log.enable');
			first.onEvent((method, params) => {
				if (method === 'Runtime.exceptionThrown')
					console_.push(
						'EXC: ' +
							(params.exceptionDetails.exception?.description ?? params.exceptionDetails.text)
					);
				if (method === 'Log.entryAdded' && params.entry.level === 'error')
					console_.push('ERR: ' + params.entry.text);
			});

			await first.goto('/add');
			await until('first copy ready', () =>
				first.evaluate(`return ${SAVE_BUTTON} ? true : false;`)
			);

			await second.goto('/texts');
			// Wait for the foreground copy to have actually TOUCHED storage, not merely rendered.
			// `session()` is lazy, so a copy that has only painted its controls has not yet asked
			// for the lease — and attempting the save before then would test nothing but a race.
			// "Opening your library…" disappearing is the observable end of that acquisition.
			await until('foreground copy to have acquired storage', () =>
				second.evaluate(
					'return !document.body.innerText.includes("Opening your library") && !!document.querySelector("main h1");'
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
			//
			// And when NEITHER happens, say what was on the page instead of timing out with
			// nothing. This scenario spent a whole debugging session reporting `last: null`, which
			// is the least informative thing it could have said: the page had been read
			// successfully every time and simply showed neither outcome, and none of the three
			// candidate explanations could be told apart from outside.
			const readState = () =>
				first.evaluate(`
					const refusal = document.body.innerText.match(/cannot save right now|will not let the app store/i);
					return {
						refusal: refusal ? refusal[0] : null,
						documents: ${READ_LINKS},
						visibility: document.visibilityState,
						saveDisabled: ${SAVE_BUTTON}?.disabled ?? null,
						saveLabel: ${SAVE_BUTTON}?.textContent?.trim() ?? null,
						text: document.body.innerText.replace(/[\\s]+/g, ' ').slice(0, 500)
					};
				`);

			// Either it refused, or a NEW document appeared. Counting from a baseline taken just
			// before the click, because earlier scenarios already saved documents and "a /read/
			// link exists" was therefore true before this scenario began.
			const settled = (state) => state.refusal || state.documents > before;

			let outcome = await readState();
			const deadline = Date.now() + 15000;
			while (!settled(outcome) && Date.now() < deadline) {
				await new Promise((resolve) => setTimeout(resolve, 200));
				outcome = await readState();
			}

			if (!settled(outcome)) {
				// Ask the copy that CAN read storage whether anything was written. The background
				// copy's own library list is not evidence either way: it renders nothing at all
				// while its `loading` flag is set, so a save that succeeded and a save that never
				// happened look identical from there. This is the measurement that separates them.
				await second.goto('/');
				const foregroundDocuments = await until(
					'the foreground copy to list its library',
					() =>
						second
							.evaluate(
								`return document.body.innerText.includes("Opening your library") ? null : ${READ_LINKS};`
							)
							.then((count) => (count === null ? null : { count })),
					20000
				);

				return {
					pass: false,
					error: 'the background copy neither refused nor accepted within 15 s',
					observed: outcome,
					documentsBefore: before,
					documentsInStorage: foregroundDocuments.count,
					foregroundVisibility: await second.evaluate('return document.visibilityState'),
					console: console_
				};
			}

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
					: 'the background copy accepted the change — check whether headless reports both tabs visible, which would mean it legitimately held the lease',
				console: console_.slice(0, 8)
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
