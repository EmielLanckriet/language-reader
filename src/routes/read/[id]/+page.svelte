<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { session } from '$lib/storage/session';
	import { codePointsOf } from '$lib/domain/offsets';
	import StateMenu from '$lib/ui/StateMenu.svelte';
	import ErrorNotice from '$lib/ui/ErrorNotice.svelte';
	import { recordDiagnostic, describeError } from '$lib/diagnostics/log';
	import type { StoredDocument } from '$lib/storage/repository';
	import type { LexemeId, Token, WordState } from '$lib/domain/types';

	let document = $state<StoredDocument | null>(null);
	let states = $state<Map<LexemeId, WordState>>(new Map());
	let loading = $state(true);
	let problem = $state<unknown>(null);
	let chosen = $state<Token | null>(null);

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
			const loaded = repository.getDocument(id);
			document = loaded;
			states = repository.getStates(lexemesIn(loaded));
		} catch (error) {
			problem = error;
			await record(error);
		} finally {
			loading = false;
		}
	}

	function lexemesIn(loaded: StoredDocument): LexemeId[] {
		return loaded.tokens
			.map((token) => token.lexemeId)
			.filter((id): id is LexemeId => id !== undefined);
	}

	async function choose(state: string) {
		const token = chosen;
		if (token?.lexemeId === undefined || !document) return;
		chosen = null;
		try {
			const { repository } = await session();
			// The occurrence is recorded alongside the judgment: which document, and where in it.
			// Unused in this slice, and irrecoverable if not written at the time — same-reading
			// homographs are told apart by context and by nothing else.
			repository.assertState(token.lexemeId, state, {
				documentId: document.id,
				fromOffset: token.start,
				toOffset: token.end
			});
			states = repository.getStates(lexemesIn(document));
		} catch (error) {
			problem = error;
			await record(error);
		}
	}

	/** Failures go to the on-device record as well as to the screen (FR-021). */
	async function record(error: unknown) {
		try {
			const { db } = await session();
			recordDiagnostic(db, 'storage', describeError(error));
		} catch {
			// The database is the thing that failed. Nothing further to try.
		}
	}

	function textOf(token: Token): string {
		return characters.slice(token.start, token.end).join('');
	}

	/** The state name, or null where the reader has never judged this word (FR-006b). */
	function stateOf(token: Token): string | null {
		if (token.lexemeId === undefined) return null;
		return states.get(token.lexemeId)?.state ?? null;
	}
</script>

<a class="back" href={resolve('/')}>← Library</a>

{#if loading}
	<p class="loading">Opening…</p>
{:else if problem}
	<ErrorNotice error={problem} onretry={() => load(Number(page.params.id))} />
{:else if document}
	<h1>{document.title}</h1>
	<p class="subtitle">Segmented by {document.analyzer} v{document.analyzerVersion}</p>

	<!-- No whitespace between tokens: this is Chinese, and the browser would render any gap the
	     markup contains. The awkward tag placement is load-bearing, not a formatting accident. -->
	<div class="reading" lang={document.language}>
		{#each document.tokens as token (token.start)}{#if token.isWord}<button
					class="token state-{stateOf(token) ?? 'none'}"
					onclick={() => (chosen = token)}>{textOf(token)}</button
				>{:else}<span class="token">{textOf(token)}</span>{/if}{/each}
	</div>

	{#if chosen}
		<StateMenu
			word={textOf(chosen)}
			current={stateOf(chosen)}
			onchoose={choose}
			onclose={() => (chosen = null)}
		/>
	{/if}
{/if}
