<script lang="ts">
	import { resolve } from '$app/paths';
	import { session } from '$lib/storage/session';
	import { pasteSource } from '$lib/content/paste';
	import { fallbackAnalyzer } from '$lib/analyzer/active';
	import { resolveTokens, stampOf } from '$lib/analyzer/resolve';
	import { RejectedInput } from '$lib/content/types';
	import ErrorNotice from '$lib/ui/ErrorNotice.svelte';
	import { describeError } from '$lib/diagnostics/describe';
	import { MAXIMUM_CHARACTERS } from '$lib/content/paste';
	import { codePointLength } from '$lib/domain/offsets';
	import type { DocumentSummary } from '$lib/storage/repository';
	import { latest, restore } from '$lib/backup/destination';
	import { downloadState, importJob, newFromTermux, type TermuxJob } from '$lib/media/termux';
	import Progress from '$lib/ui/Progress.svelte';
	import { goto } from '$app/navigation';

	let documents = $state<DocumentSummary[]>([]);
	let pasted = $state('');
	let loading = $state(true);
	let saving = $state(false);
	let problem = $state<unknown>(null);

	// Counted in characters, matching the limit the content source enforces (FR-020). Shown live
	// so the reader can see they are over the limit before pressing anything.
	const length = $derived(codePointLength(pasted));

	// Re-read whenever this copy gets the storage back, not only on mount.
	//
	// Without this, a copy that had the lease taken while it was in the background shows whatever
	// was true when it last looked — so switching between two windows leaves the older one quietly
	// out of date, and a document saved in the other one is simply missing. Reading again on
	// `holding` costs one query and removes a whole class of "where did it go?".
	$effect(() => {
		let seen: string | undefined;
		let stop = () => {};
		void session().then(({ repository }) => {
			stop = repository.watch((state) => {
				if (state.kind !== 'holding' || seen === 'holding') {
					seen = state.kind;
					return;
				}
				seen = state.kind;
				void load();
			});
		});
		return () => stop();
	});

	async function load() {
		try {
			const { repository } = await session();

			// This waits for the storage lease rather than resolving empty without it. Every return
			// to the foreground passes through acquiring, and a library that briefly showed nothing
			// on each of them would be indistinguishable from having lost everything.
			documents = await repository.listDocuments();
		} catch (error) {
			problem = error;
			await record('storage', error);
		} finally {
			loading = false;
		}
	}

	// New videos waiting in Termux (ADR-0022): looked for on load and whenever the app comes back.
	let fresh = $state<TermuxJob[]>([]);
	let opening = $state<string | null>(null);
	let openProblem = $state<string | null>(null);

	/** A download the reader tapped before it finished: opened the moment it is ready. */
	let waitingFor = $state<string | null>(null);

	// Every few seconds while visible, so a share shows up here within moments, with its progress.
	$effect(() => {
		const look = async () => {
			if (document.visibilityState !== 'visible') return;
			const jobs = await newFromTermux();
			fresh = jobs === 'unreachable' ? [] : jobs;
			const wanted = fresh.find((job) => job.job === waitingFor && job.ready !== false);
			if (wanted && opening === null) {
				waitingFor = null;
				void openJob(wanted);
			}
		};
		void look();
		const timer = setInterval(() => void look(), 2000);
		const onVisible = () => void look();
		document.addEventListener('visibilitychange', onVisible);
		return () => {
			clearInterval(timer);
			document.removeEventListener('visibilitychange', onVisible);
		};
	});

	async function openJob(job: TermuxJob) {
		opening = job.job;
		openProblem = null;
		try {
			const imported = await importJob(job);
			await goto(
				'pending' in imported
					? resolve('/live/[job]', { job: imported.pending })
					: resolve('/read/[id]', { id: String(imported.documentId) })
			);
		} catch (error) {
			openProblem = error instanceof Error ? error.message : String(error);
		} finally {
			opening = null;
		}
	}

	let found = $state<Awaited<ReturnType<typeof latest>> | null>(null);
	let restoring = $state(false);
	let restoreProblem = $state<string | null>(null);

	// Only asked for an empty library: that is when a copy is the thing the reader wants to see.
	$effect(() => {
		if (!loading && documents.length === 0 && found === null)
			void latest().then((f) => (found = f));
	});

	async function restoreFound() {
		if (!found || typeof found === 'string') return;
		restoring = true;
		restoreProblem = null;
		try {
			restoreProblem = await restore(found.text);
			if (!restoreProblem) documents = await (await session()).repository.listDocuments();
		} catch (error) {
			restoreProblem = error instanceof Error ? error.message : String(error);
		} finally {
			restoring = false;
		}
	}

	async function save() {
		problem = null;
		saving = true;
		try {
			const { repository } = await session();
			const document = await pasteSource.ingest(pasted);
			// **The fallback, deliberately, even when the model is on the device.**
			//
			// The model costs about 4 s per 1,000 characters (research.md R18), so importing five
			// thousand characters with it took over thirty seconds on the reader's phone against
			// SC-004's three, and — in their words — "doesn't even really work". The dictionary
			// segments the same document in 26 ms.
			//
			// The document is therefore saved stamped with the fallback, which makes it immediately
			// out of date under the model. That is not a defect being tolerated; it is the existing
			// staleness machinery being used for what it is for. The background sweep re-derives it
			// (FR-016), and T048 confirmed on a real device that re-derivation preserves the marks
			// made in the meantime — marks live on lexemes, which `replaceTokens` reuses rather
			// than deletes.
			//
			// The reader consequently reads dictionary words first and better words shortly after.
			// That trade was put to them explicitly and chosen. What it costs, and the incremental
			// version that would upgrade the first page first, are recorded in
			// docs/anticipated-changes.md.
			const analyzer = fallbackAnalyzer;
			const analyzed = await analyzer.analyze(document.rawContent);
			const tokens = resolveTokens(document.rawContent, analyzed, analyzer);
			await repository.saveDocument(document, tokens, stampOf(analyzer));
			pasted = '';
			documents = await repository.listDocuments();
		} catch (error) {
			// A refused paste and a broken database are different problems and read differently
			// (FR-018, FR-022). Collapsing them into "something went wrong" is what this avoids,
			// and ErrorNotice is what tells them apart.
			problem = error;
			if (!(error instanceof RejectedInput)) await record('storage', error);
		} finally {
			saving = false;
		}
	}

	/** Failures go to the on-device record as well as to the screen (FR-021). */
	async function record(kind: 'storage' | 'unexpected', error: unknown) {
		try {
			const { repository } = await session();
			await repository.recordDiagnostic(kind, describeError(error));
		} catch {
			// The database is the thing that failed. Nothing further to try.
		}
	}

	/** See the control above. Short enough to read at a glance on a phone. */
	const SAMPLE_TEXT =
		'朋友很好。我在中国学习中文。他骑自行车去上班。三个人在那里等着。玛丽亚是我的朋友。圆周率大约是3.14。';
</script>

<h1>Reader</h1>
<p class="subtitle">
	Paste Chinese text, then tap words as you read. Videos shared to Termux appear here; a bundle file
	can also be <a href={resolve('/inbox')}>opened by hand</a>.
</p>

<!--
	A sample to hand, so checking the reader on a phone does not start with typing Chinese into a
	touch keyboard. It fills the box rather than saving directly: the reader still decides what
	enters their library, and nothing writes earned data on their behalf.

	The text is chosen to exercise the cases that actually distinguish segmenters — a plain
	two-character word, a compound that dictionary methods split, a name, a measure-word run, and a
	decimal — so a glance at the result says whether word splitting is working on this device.
-->
<button class="secondary" onclick={() => (pasted = SAMPLE_TEXT)}>Load sample text</button>

<textarea
	bind:value={pasted}
	placeholder="Paste Chinese text here"
	aria-label="Text to save"
	lang="zh"></textarea>

<p class="subtitle">
	{length.toLocaleString()} of {MAXIMUM_CHARACTERS.toLocaleString()} characters
</p>

{#if problem}
	<ErrorNotice error={problem} />
{/if}

<!--
	FR-017, and the open question slice 0 left behind. The control is disabled while there is
	nothing to save, which makes the rejection message it would otherwise show unreachable — so
	slice 0 had a requirement about explaining refused input that no reader could ever see.

	Resolved as: preventing the error is fine, leaving the reader to guess is not. The control says
	why it cannot be used, next to itself, instead of waiting to be pressed so it can complain.
-->
<button onclick={save} disabled={saving || pasted.trim() === ''}>
	{saving ? 'Saving…' : 'Save'}
</button>
{#if !saving && pasted.trim() === ''}
	<p class="subtitle why">Paste some text above and this becomes available.</p>
{:else if length > MAXIMUM_CHARACTERS}
	<p class="subtitle why">
		That is {(length - MAXIMUM_CHARACTERS).toLocaleString()} characters over the limit. Saving will refuse
		it until you shorten it.
	</p>
{/if}

{#if fresh.length > 0}
	<section class="fresh" aria-label="New from Termux">
		<h2>New from Termux</h2>
		{#if openProblem}<p role="alert">{openProblem}</p>{/if}
		<ul class="library">
			{#each fresh as job (job.job)}
				<li>
					{#if job.ready === false}
						<button onclick={() => (waitingFor = job.job)} disabled={waitingFor === job.job}>
							{waitingFor === job.job ? 'Opens when ready' : 'Open'}
						</button>
						{job.title}
						<Progress {...downloadState(job)} />
					{:else}
						<button onclick={() => openJob(job)} disabled={opening !== null}>
							{opening === job.job ? 'Opening…' : 'Open'}
						</button>
						{job.title}
						<small>
							{Math.round(job.bytes / 1e6)} MB{job.transcribing
								? ' · subtitles still being made'
								: ''}
						</small>
					{/if}
				</li>
			{/each}
		</ul>
	</section>
{/if}

{#if loading}
	<p class="loading">Opening your library…</p>
{:else if documents.length === 0}
	{#if found && found !== 'none' && found !== 'unreachable'}
		<!-- An empty library with a copy in Termux is a wipe, not a fresh start (FR-006). -->
		<div class="notice restore">
			<p>
				<strong>Your work can be restored.</strong> Termux holds a copy from
				{new Date(found.createdAt).toLocaleString()}: {found.documents} documents and {found.words}
				marked words.
			</p>
			{#if restoreProblem}<p role="alert">{restoreProblem}</p>{/if}
			<button onclick={restoreFound} disabled={restoring}>
				{restoring ? 'Restoring…' : 'Restore'}
			</button>
		</div>
	{:else if found === 'unreachable'}
		<p class="empty">
			Nothing saved yet. If you had work here before, open Termux once so the app can look for your
			copy, then come back.
		</p>
	{:else}
		<p class="empty">Nothing saved yet.</p>
	{/if}
{:else}
	<ul class="library">
		{#each documents as document (document.id)}
			<li>
				<a href={resolve('/read/[id]', { id: String(document.id) })}>
					{document.title}
					<span class="meta">{document.characterCount.toLocaleString()} characters</span>
				</a>
			</li>
		{/each}
	</ul>
{/if}

<!--
	FR-021 says the reader must be able to reach the failure record without developer tools. Until
	now the only link to it was inside an error notice, so it was reachable exactly when something
	had already gone wrong — and in the installed application, with no address bar, not reachable
	deliberately at all. Getting there meant opening the browser, which takes the storage lease away
	from the installed copy and causes the very contention the page exists to explain.
-->
<footer class="tools">
	<a class="link" href={resolve('/diagnostics')}>Storage and diagnostics</a>
</footer>
