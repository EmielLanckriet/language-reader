<script lang="ts">
	import { resolve } from '$app/paths';
	import { session } from '$lib/storage/session';
	import { pasteSource } from '$lib/content/paste';
	import { characterSplitter } from '$lib/analyzer/character';
	import { RejectedInput } from '$lib/content/types';
	import { MAXIMUM_CHARACTERS } from '$lib/content/paste';
	import { codePointLength } from '$lib/domain/offsets';
	import type { DocumentSummary } from '$lib/storage/repository';

	let documents = $state<DocumentSummary[]>([]);
	let pasted = $state('');
	let loading = $state(true);
	let saving = $state(false);
	let problem = $state<string | null>(null);
	let warning = $state<string | null>(null);

	// Counted in characters, matching the limit the content source enforces (FR-020). Shown live
	// so the reader can see they are over the limit before pressing anything.
	const length = $derived(codePointLength(pasted));

	$effect(() => {
		void load();
	});

	async function load() {
		try {
			const { repository, durability } = await session();
			documents = repository.listDocuments();
			if (durability === 'memory') {
				warning =
					'This browser would not give the app persistent storage, so anything you save ' +
					'will disappear when you close the tab.';
			}
		} catch (error) {
			problem = `The library could not be opened. ${describe(error)}`;
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
			const tokens = await characterSplitter.analyze(document.rawContent);
			repository.saveDocument(document, tokens, characterSplitter);
			pasted = '';
			documents = repository.listDocuments();
		} catch (error) {
			// A refused paste and a broken database are different problems and read differently
			// (FR-018, FR-022). Collapsing them into "something went wrong" is what this avoids.
			problem =
				error instanceof RejectedInput
					? error.message
					: `It could not be saved. ${describe(error)}`;
		} finally {
			saving = false;
		}
	}

	function describe(error: unknown): string {
		return error instanceof Error ? error.message : String(error);
	}
</script>

<h1>Reader</h1>
<p class="subtitle">Paste Chinese text, then tap words as you read.</p>

{#if warning}
	<p class="notice warning">{warning}</p>
{/if}

<textarea
	bind:value={pasted}
	placeholder="Paste Chinese text here"
	aria-label="Text to save"
	lang="zh"></textarea>

<p class="subtitle">
	{length.toLocaleString()} of {MAXIMUM_CHARACTERS.toLocaleString()} characters
</p>

{#if problem}
	<p class="notice problem" role="alert">{problem}</p>
{/if}

<button onclick={save} disabled={saving || pasted.trim() === ''}>
	{saving ? 'Saving…' : 'Save'}
</button>

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
