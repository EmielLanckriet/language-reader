<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { session } from '$lib/storage/session';
	import { codePointsOf } from '$lib/domain/offsets';
	import type { StoredDocument } from '$lib/storage/repository';

	let document = $state<StoredDocument | null>(null);
	let loading = $state(true);
	let problem = $state<string | null>(null);

	/**
	 * The document's characters, converted once.
	 *
	 * Every token slices this array rather than the string. Slicing a string by code point walks
	 * it from the start each time, so doing it per token would be quadratic — invisible at three
	 * characters and very visible at five thousand, which is the size this slice accepts.
	 */
	const characters = $derived(document ? codePointsOf(document.rawContent) : []);

	$effect(() => {
		void load(Number(page.params.id));
	});

	async function load(id: number) {
		loading = true;
		problem = null;
		try {
			const { repository } = await session();
			document = repository.getDocument(id);
		} catch (error) {
			problem = error instanceof Error ? error.message : String(error);
		} finally {
			loading = false;
		}
	}

	function textOf(token: { start: number; end: number }): string {
		return characters.slice(token.start, token.end).join('');
	}
</script>

<a class="back" href={resolve('/')}>← Library</a>

{#if loading}
	<p class="loading">Opening…</p>
{:else if problem}
	<p class="notice problem" role="alert">{problem}</p>
{:else if document}
	<h1>{document.title}</h1>
	<p class="subtitle">
		Segmented by {document.analyzer} v{document.analyzerVersion}
	</p>

	<div class="reading" lang={document.language}>
		{#each document.tokens as token (token.start)}<span class="token" class:word={token.isWord}
				>{textOf(token)}</span
			>{/each}
	</div>
{/if}
