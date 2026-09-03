<script lang="ts">
	import { resolve } from '$app/paths';
	import { session } from '$lib/storage/session';
	import { pasteSource } from '$lib/content/paste';
	import { activeAnalyzer } from '$lib/analyzer/active';
	import { resolveTokens, stampOf } from '$lib/analyzer/resolve';
	import { RejectedInput } from '$lib/content/types';
	import ErrorNotice from '$lib/ui/ErrorNotice.svelte';
	import { describeError } from '$lib/diagnostics/describe';
	import { MAXIMUM_CHARACTERS } from '$lib/content/paste';
	import { codePointLength } from '$lib/domain/offsets';
	import type { DocumentSummary } from '$lib/storage/repository';

	let documents = $state<DocumentSummary[]>([]);
	let pasted = $state('');
	let loading = $state(true);
	let saving = $state(false);
	let problem = $state<unknown>(null);
	let warning = $state<string | null>(null);

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
			const { repository, persistence } = await session();

			// This waits for the storage lease rather than resolving empty without it. Every return
			// to the foreground passes through acquiring, and a library that briefly showed nothing
			// on each of them would be indistinguishable from having lost everything.
			documents = await repository.listDocuments();

			// Whether this copy can save at all is ReadOnlyNotice's business, in the layout, so it
			// is said once wherever the reader happens to be. What is left here is the quieter
			// point that storage is durable but evictable.
			if (persistence !== 'granted') {
				warning =
					'The browser has not promised to keep your saved reading. It may be deleted if ' +
					'the device runs short of space.';
			}
		} catch (error) {
			problem = error;
			await record('storage', error);
		} finally {
			loading = false;
		}
	}

	async function save() {
		problem = null;
		saving = true;
		try {
			const { repository } = await session();
			const document = await pasteSource.ingest(pasted);
			// Resolved per save rather than held: the reader may have finished downloading the
			// contextual segmenter since the page loaded.
			const analyzer = await activeAnalyzer();
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
<p class="subtitle">Paste Chinese text, then tap words as you read.</p>

{#if warning}
	<p class="notice warning">{warning}</p>
{/if}

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

{#if loading}
	<p class="loading">Opening your library…</p>
{:else if documents.length === 0}
	<p class="empty">Nothing saved yet.</p>
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
