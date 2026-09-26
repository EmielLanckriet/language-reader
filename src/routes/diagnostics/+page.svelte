<script lang="ts">
	import { resolve } from '$app/paths';
	import { safeguards, type Safeguards } from '$lib/backup/safeguards';
	import { latest, restore } from '$lib/backup/destination';

	let guards = $state<Safeguards | null>(null);
	let restoring = $state(false);
	let restoreNote = $state<string | null>(null);
	$effect(() => {
		void safeguards().then((found) => (guards = found));
	});

	/** Available at any time (FR-012); the repository refuses a library that already has marks. */
	// Anki words (spec 006): pick the laptop's export, see what it will do, then import or undo.
	let ankiFile = $state<AnkiExport | null>(null);
	let ankiPreview = $state<AnkiResult | null>(null);
	let ankiNote = $state<string | null>(null);
	let ankiBusy = $state(false);
	let ankiImportsList = $state<{ id: string; words: number }[]>([]);

	/**
	 * Picking a file hides the app behind the system picker, and coming back replaces the storage
	 * worker, which rejects a call made at that moment with "Reconnecting…" (seen in the anki
	 * scenario). Preview, import and undo can all be repeated safely: a second import finds nothing
	 * left to change, a second undo nothing left to revert.
	 */
	async function retrying<T>(work: () => Promise<T>): Promise<T> {
		for (let attempt = 1; ; attempt++) {
			try {
				return await work();
			} catch (error) {
				const reconnecting = error instanceof Error && error.message.startsWith('Reconnecting');
				if (!reconnecting || attempt === 5) throw error;
				await new Promise((settle) => setTimeout(settle, 1000));
			}
		}
	}

	async function refreshAnkiImports() {
		ankiImportsList = await retrying(async () => (await session()).repository.ankiImports());
	}

	async function pickAnki(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		ankiNote = null;
		ankiPreview = null;
		try {
			const file = parseAnkiExport(await input.files![0].text());
			ankiPreview = await retrying(async () => (await session()).repository.previewAnki(file));
			ankiFile = file;
		} catch (error) {
			ankiFile = null;
			ankiNote = error instanceof Error ? error.message : String(error);
		}
	}

	function levelCounts(file: AnkiExport): string {
		return ANKI_LEVELS.map(
			(level) =>
				`${file.words.filter((word) => word.level === level.name).length} ${level.label.replace('Anki: ', '')}`
		).join(', ');
	}

	async function importAnki() {
		if (!ankiFile) return;
		ankiBusy = true;
		try {
			// A plain copy: $state's proxy cannot be posted to the storage worker.
			const file = $state.snapshot(ankiFile) as AnkiExport;
			const done = await retrying(async () => (await session()).repository.importAnki(file));
			ankiNote = `Imported: ${done.set} words set, ${done.unchanged} already as Anki has them, ${done.keptOwn.length} kept as you marked them.`;
			ankiFile = null;
			ankiPreview = null;
			await refreshAnkiImports();
		} catch (error) {
			ankiNote = error instanceof Error ? error.message : String(error);
		} finally {
			ankiBusy = false;
		}
	}

	async function undoAnki(id: string) {
		if (!confirm('Undo this Anki import? Your own marks are not touched.')) return;
		ankiBusy = true;
		try {
			const changed = await retrying(async () => (await session()).repository.undoAnkiImport(id));
			ankiNote = `Undone: ${changed} words back to what they were before.`;
			await refreshAnkiImports();
		} catch (error) {
			ankiNote = error instanceof Error ? error.message : String(error);
		} finally {
			ankiBusy = false;
		}
	}

	$effect(() => {
		void refreshAnkiImports().catch(() => {});
	});

	async function restoreLatest() {
		restoring = true;
		restoreNote = null;
		try {
			const found = await latest();
			if (found === 'unreachable') restoreNote = "Termux's reader service isn't running.";
			else if (found === 'none') restoreNote = 'Termux has no copy yet.';
			else restoreNote = (await restore(found.text)) ?? 'Restored.';
		} catch (error) {
			restoreNote = error instanceof Error ? error.message : String(error);
		} finally {
			restoring = false;
		}
	}
	import { session } from '$lib/storage/session';
	import { parseAnkiExport, type AnkiExport } from '$lib/domain/anki';
	import { ANKI_LEVELS } from '$lib/domain/state';
	import type { AnkiResult } from '$lib/storage/client';
	import { explain, type Availability } from '$lib/storage/availability';
	import type { Diagnostic } from '$lib/diagnostics/describe';
	import { runningVersion, describeVersion } from '$lib/ui/version';
	import { activeAnalyzer } from '$lib/analyzer/active';
	import { sliceByCodePoints } from '$lib/domain/offsets';
	import {
		modelIsStored,
		downloadModel,
		discardModel,
		type DownloadProgress
	} from '$lib/analyzer/model-store';

	/**
	 * FR-021: the reader must be able to retrieve and read the failure record **without developer
	 * tools**. On Android there are none to hand, and with no server there is nowhere else the
	 * information exists — so this page is the whole of it.
	 */
	let entries = $state<Diagnostic[]>([]);
	let availability = $state<Availability>({ kind: 'acquiring', remembering: false });
	let persistence = $state('');
	let loading = $state(true);

	/**
	 * How much of the library is still on a superseded analyzer (FR-022).
	 *
	 * The catch-up sweep is deliberately silent — it is the application tidying up after itself,
	 * not something to interrupt anyone about. Silent is not the same as invisible, though, so the
	 * one number that says whether it is working belongs here, where slice 1 put everything else
	 * that happens without being seen.
	 */
	let stale = $state<number | null>(null);

	/**
	 * How this device actually splits a short, fixed sentence.
	 *
	 * The version above is a fingerprint — it says *that* two devices differ, never *how*. This
	 * says how, in the one form nobody has to interpret: the words themselves. It exists because
	 * word splitting is done by the browser's own text engine, and there is no guarantee the engine
	 * on a phone carries the same Chinese dictionary as the one on a laptop. If this line comes back
	 * as single characters, the engine on this device is not splitting Chinese into words at all,
	 * and that is a fact about the device rather than a fault in the reader.
	 */
	// Chosen to *discriminate*, which the previous sentence did not: both analyzers agreed on it, so
	// the line could not show which one was running. 你是哪国人 is the case the dictionary cannot
	// get right — it reads 哪 · 国人, because 国人 is a word, just not this word.
	const PROBE_SENTENCE = '你是哪国人？朋友很好。';
	let probe = $state<string>('');
	let analyzerName = $state('');
	let analyzerVersion = $state('');

	/**
	 * The contextual segmenter: about 100 MB, downloaded once, kept on the device (ADR-0015).
	 *
	 * Offered rather than fetched. It is more than fifty times the whole application, and the
	 * dictionary already reads well enough that nobody should be made to wait for this before they
	 * can read at all. Shown here, beside what this device actually does with words, because that
	 * is where a reader who has just seen a word split wrongly will be looking.
	 */
	let modelPresent = $state<boolean | null>(null);
	let downloading = $state(false);
	let progress = $state<DownloadProgress | null>(null);
	let modelProblem = $state<string>('');

	async function refreshModelState() {
		modelPresent = await modelIsStored();
	}

	async function getModel() {
		downloading = true;
		modelProblem = '';
		progress = null;
		try {
			await downloadModel((p) => (progress = p));
			await refreshModelState();
			// Every document is now stamped by the previous analyzer, so all of them are stale. The
			// catch-up sweep re-derives them, and anything opened first is re-derived on opening.
			await reload();
		} catch (error) {
			modelProblem = error instanceof Error ? error.message : String(error);
		} finally {
			downloading = false;
			progress = null;
		}
	}

	async function removeModel() {
		await discardModel();
		await refreshModelState();
		await reload();
	}

	async function reload() {
		const analyzer = await activeAnalyzer();
		analyzerName = analyzer.name;
		analyzerVersion = analyzer.version;
		probe = (await analyzer.analyze(PROBE_SENTENCE))
			.map((token) => sliceByCodePoints(PROBE_SENTENCE, token.start, token.end))
			.join(' | ');
	}

	function megabytes(bytes: number): string {
		return (bytes / 1048576).toFixed(0);
	}

	$effect(() => {
		void reload();
		void refreshModelState();
	});

	// Read outside the storage effect on purpose: the version has to be reportable even when the
	// database cannot be opened, which is exactly when someone opens this page.
	const running = runningVersion();

	$effect(() => {
		let stop = () => {};
		void (async () => {
			const s = await session();
			stop = s.repository.watch((state) => (availability = state));
			persistence = s.persistence;
			entries = await s.repository.readDiagnostics();
			const analyzer = await activeAnalyzer();
			stale = (await s.repository.staleDocumentIds(analyzer.name, analyzer.version)).length;
			loading = false;
		})();
		return () => stop();
	});

	const storage = $derived.by(() => {
		switch (availability.kind) {
			case 'holding':
				return 'On this device, in the browser’s private file system. Changes are being saved.';
			case 'acquiring':
				return 'Reconnecting to your library. This happens each time you come back to the app.';
			case 'paused':
				return 'Released, because this window is in the background. It comes back when you do.';
			case 'refused': {
				const why = explain(availability.cause);
				return `${why.headline} ${why.action}${why.detail ? ` (${why.detail})` : ''}`;
			}
		}
	});

	async function clear() {
		const s = await session();
		await s.repository.clearDiagnostics();
		entries = await s.repository.readDiagnostics();
	}
</script>

<a class="back" href={resolve('/')}>← Library</a>

<h1>Diagnostics</h1>
<p class="subtitle">
	Everything that has gone wrong on this device. Nothing here is sent anywhere.
</p>

<h2 class="section">Right now</h2>

<dl class="facts">
	<dt>Safeguards</dt>
	<dd>
		{#if guards}
			Installed: {guards.installed ? 'yes' : 'no (a tab or shortcut)'} · Storage kept: {guards.persisted
				? 'yes'
				: 'no'} · Copy in Termux: {guards.copy === 'current'
				? 'up to date'
				: guards.copy === 'stale'
					? 'behind'
					: 'service not reachable'}
			<br />
			<small>
				Last copy: {guards.lastCopy
					? `${new Date(guards.lastCopy.at).toLocaleString()}, ${Math.round(guards.lastCopy.bytes / 1024)} KB`
					: 'none from this device yet'}
			</small>
			<br />
			<button class="secondary" onclick={restoreLatest} disabled={restoring}>
				{restoring ? 'Restoring…' : 'Restore the latest copy'}
			</button>
			{#if restoreNote}<small role="status">{restoreNote}</small>{/if}
		{:else}
			…
		{/if}
	</dd>
	<dt>Anki words</dt>
	<dd>
		Bring in the words you study in Anki, at Anki's own level for each. On the laptop, run
		<code>python3 scripts/anki/export_words.py --push</code>, then pick the file here.
		<br />
		<input
			type="file"
			accept=".json,application/json"
			aria-label="Anki export"
			onchange={pickAnki}
		/>
		{#if ankiFile && ankiPreview}
			<p>
				<strong>{ankiFile.profile}</strong>, last changed {new Date(
					ankiFile.collectionModified
				).toLocaleString()}: {levelCounts(ankiFile)}.
				<br />
				This sets {ankiPreview.set} words, leaves {ankiPreview.unchanged} already as Anki has them, and
				keeps {ankiPreview.keptOwn.length} you marked yourself.
			</p>
			<button onclick={importAnki} disabled={ankiBusy}>{ankiBusy ? 'Importing…' : 'Import'}</button>
		{/if}
		{#each ankiImportsList as entry (entry.id)}
			<p>
				<small>Import of {new Date(entry.id).toLocaleString()}: {entry.words} words</small>
				<button class="secondary" onclick={() => undoAnki(entry.id)} disabled={ankiBusy}>
					Undo this import
				</button>
			</p>
		{/each}
		{#if ankiNote}<small role="status">{ankiNote}</small>{/if}
	</dd>
	<dt>Version</dt>
	<dd>
		<!--
			FR-010 asks the reader to decide when to move to a new version, on the stated grounds
			that knowing when one landed is worth a tap. That only pays off if it is still knowable
			afterwards — a notice missed is a notice gone. Recorded when a new build is first seen.
		-->
		{describeVersion(running)}{running.since
			? `, running here since ${running.since.toLocaleString()}`
			: ''}
	</dd>
	<dt>Storage</dt>
	<dd>{storage}</dd>
	<dt>Word splitting on this device</dt>
	<dd>
		<code class="probe">{probe || '…'}</code>
		<br />
		<small>
			“朋友” should be one piece, and “哪国人” should read 哪 · 国 · 人 rather than 哪 · 国人. The
			first tells you words are being found at all; the second tells you whether the sentence is
			being read for context, which only the downloadable segmenter does.
		</small>
	</dd>
	<dt>Better word splitting</dt>
	<dd>
		{#if modelPresent === null}
			…
		{:else if modelPresent}
			Downloaded and in use. It reads whole sentences, so it gets words right that a dictionary
			cannot — “你是哪国人” as 你 · 是 · 哪 · 国 · 人 rather than 哪 · 国人.
			<br />
			<button class="secondary" onclick={removeModel} disabled={downloading}>
				Remove it and go back to the dictionary
			</button>
		{:else}
			<!--
				The honest pitch and the honest price, together. A dictionary cannot resolve a
				boundary that depends on context, and measurement rather than intuition says so:
				“你是哪国人” comes out as 哪 · 国人 under dictionary matching and under frequency
				weighting alike, because 国人 really is a word — just not this word.
			-->
			Words are split with a dictionary, which cannot tell 国人 from 国 · 人 when only the sentence around
			them decides. A downloadable segmenter reads whole sentences and gets those right. It is
			<strong>about 100 MB</strong> — the segmenter and the code that runs it, fetched together so
			neither is missing when you are offline — downloaded once, kept on this device, and working
			offline afterwards. Reading works without it.
			<br />
			<button class="secondary" onclick={getModel} disabled={downloading}>
				{downloading ? 'Downloading…' : 'Download the sentence-reading segmenter (~100 MB)'}
			</button>
			{#if progress}
				<br />
				<small>
					{megabytes(progress.receivedBytes)} MB
					{progress.totalBytes ? `of ${megabytes(progress.totalBytes)} MB` : 'so far'}
				</small>
			{/if}
		{/if}
		{#if modelProblem}
			<br /><small class="problem">{modelProblem}</small>
		{/if}
	</dd>
	<dt>Word splitting</dt>
	<dd>
		<!--
			The version is a fingerprint of how this device's own text engine behaves, not a number
			anyone chose (ADR-0011). It is shown because it is the only way to tell whether this
			phone splits words the same way the laptop does, and a difference is a fact worth
			recording rather than a fault.
		-->
		{analyzerName || '…'} · {analyzerVersion}
		{#if stale === null}{:else if stale === 0}
			— every document has been split with this version.
		{:else}
			— {stale}
			{stale === 1 ? 'document is' : 'documents are'} still on an older version. They are being brought
			up to date in the background, and any you open are done first.
		{/if}
	</dd>
	<dt>Eviction</dt>
	<dd>
		{persistence === 'granted'
			? 'The browser has promised not to evict it.'
			: 'The browser has not promised to keep it. It may be deleted if the device runs short of space.'}
	</dd>
	<dt>What is safe, and what is not</dt>
	<dd>
		<!--
			FR-018. A permanent line rather than a notice shown once: a first-run notice is dismissed
			reflexively and is then absent exactly when someone wants to check. Nothing interrupts
			the reader with this anywhere else.
		-->
		Text you save is kept and is never thrown away, and the words you mark are kept with it. When word-splitting
		changes — because this app improves it, or because the browser updates its own text engine — your
		documents are split again from the text that was saved, and
		<strong>no mark is lost, altered, or moved</strong>. Marks you made earlier, when this app split
		Chinese one character at a time, are still there: they are marks on those characters, and they
		stay exactly that rather than being reinterpreted.
	</dd>
</dl>

<h2 class="section">What has happened before</h2>
<p class="subtitle">
	A record of past failures, each with the time it happened. These describe moments that have
	already passed — for what is true now, read the two lines above.
</p>

{#if loading}
	<p class="loading">Reading…</p>
{:else if entries.length === 0}
	<p class="empty">Nothing has failed yet.</p>
{:else}
	<ul class="entries">
		{#each entries as entry (entry.id)}
			<li>
				<p class="head">
					<span class="kind">{entry.kind}</span> <span class="at">{entry.at}</span>
				</p>
				<pre>{entry.detail}</pre>
			</li>
		{/each}
	</ul>
	<button class="secondary" onclick={clear}>Clear</button>
{/if}

<style>
	.section {
		font-size: 0.95rem;
		margin: 1.5rem 0 0.5rem;
	}

	.facts {
		border: 1px solid var(--rule);
		border-radius: 8px;
		padding: 0.75rem 1rem;
		margin: 0 0 1.5rem;
	}

	.facts dt {
		font-weight: 600;
		font-size: 0.85rem;
	}

	.facts dd {
		margin: 0 0 0.6rem;
		color: var(--muted);
		font-size: 0.9rem;
	}

	.entries {
		list-style: none;
		padding: 0;
		margin: 0 0 1rem;
	}

	.entries li {
		border-top: 1px solid var(--rule);
		padding: 0.75rem 0;
	}

	.head {
		margin: 0 0 0.35rem;
		font-size: 0.8rem;
	}

	.kind {
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--danger);
		font-weight: 600;
	}

	.at {
		color: var(--muted);
	}

	pre {
		margin: 0;
		white-space: pre-wrap;
		word-break: break-word;
		font-size: 0.8rem;
		color: var(--muted);
	}
</style>
