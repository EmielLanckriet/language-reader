<script lang="ts">
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import { session } from '$lib/storage/session';
	import { mediaDocuments } from '$lib/media/store';
	import type { DocumentSummary } from '$lib/storage/repository';
	import ErrorNotice from './ErrorNotice.svelte';
	import { describeError } from '$lib/diagnostics/describe';

	/** Videos or pasted texts: a video is a document with media beside it (ADR-0018). */
	let {
		kind,
		empty,
		onloaded
	}: {
		kind: 'video' | 'text';
		/** Shown when this list is empty; told whether the whole library is. */
		empty: Snippet<[boolean]>;
		onloaded?: (all: number) => void;
	} = $props();

	let documents = $state<DocumentSummary[]>([]);
	let total = $state(0);
	let loading = $state(true);
	let problem = $state<unknown>(null);

	async function load() {
		try {
			const { repository } = await session();
			// Waits for the storage lease rather than resolving empty without it: a library that
			// briefly showed nothing on every return to the foreground would look like a loss.
			const [all, videos] = await Promise.all([repository.listDocuments(), mediaDocuments()]);
			total = all.length;
			documents = all.filter((document) => videos.has(document.id) === (kind === 'video'));
			onloaded?.(total);
		} catch (error) {
			problem = error;
			try {
				await (await session()).repository.recordDiagnostic('storage', describeError(error));
			} catch {
				// The database is the thing that failed.
			}
		} finally {
			loading = false;
		}
	}

	// Read again whenever this copy gets the storage back, not only on mount: a copy that had the
	// lease taken while in the background would otherwise show what was true when it last looked.
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
</script>

{#if problem}
	<ErrorNotice error={problem} />
{/if}
{#if loading}
	<p class="loading">Opening your library…</p>
{:else if documents.length === 0}
	{@render empty(total === 0)}
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
