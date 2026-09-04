<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { session } from '$lib/storage/session';
	import { codePointsOf } from '$lib/domain/offsets';
	import StateMenu from '$lib/ui/StateMenu.svelte';
	import ErrorNotice from '$lib/ui/ErrorNotice.svelte';
	import { describeError } from '$lib/diagnostics/describe';
	import type { StoredDocument } from '$lib/storage/repository';
	import type { LexemeId, Token, WordState } from '$lib/domain/types';
	import { activeAnalyzer, fallbackAnalyzer } from '$lib/analyzer/active';
	import { needsImmediateRederivation, rederiveDocument, tokensFor } from '$lib/storage/rederive';
	import { upgradeOf } from '$lib/storage/upgrades';

	let document = $state<StoredDocument | null>(null);
	let states = $state<Map<LexemeId, WordState>>(new Map());
	let loading = $state(true);
	let problem = $state<unknown>(null);
	let chosen = $state<Token | null>(null);

	/** True while a stale document is being brought up to date, which the reader waits for. */
	let resegmenting = $state(false);

	/**
	 * A batch landed while the reader had the word menu open, and the words have not been re-read.
	 *
	 * Held rather than applied, because replacing the tokens under an open menu would move or
	 * remove the word it is about. It is applied the moment the menu closes.
	 */
	let refreshWhenFree = $state(false);

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

	/**
	 * Show the improvement as it arrives (ADR-0016).
	 *
	 * The sweep upgrades a document a batch at a time, and a document being read is exactly the one
	 * worth improving first. Without this the reader would have to close and reopen it to see any of
	 * it, which is what made the upgrade invisible in practice (research.md R20).
	 */
	let shownThrough = -1;

	$effect(() => {
		const advanced = upgradeOf(Number(page.params.id));
		if (!advanced) return;

		// `untrack`, and not decoration: everything below reads state that `showLatestWords` then
		// writes — `document` above all — so without it this effect would retrigger itself for as
		// long as the reader stayed on the page. The only dependency it is meant to have is the
		// progress reported by the sweep.
		untrack(() => {
			if (advanced.through === shownThrough || !document || loading) return;
			shownThrough = advanced.through;
			void showLatestWords();
		});
	});

	async function load(id: number) {
		loading = true;
		problem = null;
		try {
			const { repository } = await session();
			const loaded = await repository.getDocument(id);
			document = await bringUpToDate(repository, loaded);
			states = await repository.getStates(lexemesIn(document));
		} catch (error) {
			problem = error;
			await record(error);
		} finally {
			loading = false;
		}
	}

	/**
	 * Re-derive a document whose stored tokens are too poor to show, before it is shown (FR-015).
	 *
	 * The reader never sees placeholder tokens in something they opened — that guarantee is
	 * unchanged. What changed in slice 2 is that being *out of date* no longer implies being too
	 * poor to show: documents are imported with the fast fallback and upgraded by the background
	 * sweep, so a document showing real dictionary words is shown at once and improved later. See
	 * `needsImmediateRederivation`, and research.md R18 for why paying on open is not an option.
	 *
	 * Note the fallback below: a copy that does not hold storage still segments the text and
	 * displays real words, it just cannot write them down. Refusing to show the document, or
	 * showing it with character-per-token segmentation, would both be worse than showing correct
	 * words and leaving the stamp stale for a copy that can write to fix (FR-019).
	 */
	async function bringUpToDate(
		repository: Awaited<ReturnType<typeof session>>['repository'],
		loaded: StoredDocument
	): Promise<StoredDocument> {
		const analyzer = await activeAnalyzer();
		// Out of date is now the ordinary condition of a document, not a fault: import stamps with
		// the fast fallback and the sweep upgrades afterwards. So the question here is no longer
		// "is this stale" but "are these tokens too poor to show" — paying four seconds per
		// thousand characters to improve words that are already real is not a trade the reader
		// would choose, and paying it on open is what failed SC-004 (research.md R18).
		if (!needsImmediateRederivation(loaded, analyzer)) return loaded;

		// **Repaired with the fallback, not with the analyzer in force.**
		//
		// The obligation is to show real words rather than placeholder ones (FR-015), and the
		// dictionary discharges it in 26 ms where the model takes 27 s. Using the active analyzer
		// here would leave one path that still blocks for half a minute — the one reached by a
		// document written by slice 0's per-character dummy — and there is no reason for the
		// reader to wait for the best possible words when what they need is any real ones.
		//
		// The document is therefore restamped with the fallback and is still out of date under the
		// model, which is exactly the state a freshly imported document is in. The sweep upgrades
		// both by the same path. After this line, **no path on opening a document runs the model.**
		const repairWith = fallbackAnalyzer;

		resegmenting = true;
		try {
			const stored = await rederiveDocument(repository, loaded, repairWith);
			if (stored) {
				return await repository.getDocument(loaded.id);
			}
			return loaded;
		} catch {
			// Could not persist — almost always because another copy holds storage. Show the right
			// words anyway; the document stays stale and the sweep will catch it later.
			//
			// These tokens carry no `lexemeId`, because a lexeme is assigned when tokens are stored
			// and nothing was stored. The words are therefore readable and not markable, which is
			// the honest outcome: a copy that cannot write a token cannot write a judgment either,
			// and slice 1 already tells the reader why through the read-only notice.
			const tokens = await tokensFor(loaded, repairWith);
			return {
				...loaded,
				tokens: tokens.map(({ start, end, isWord }) => ({ start, end, isWord }))
			};
		} finally {
			resegmenting = false;
		}
	}

	/**
	 * Re-read the tokens of the document already on screen.
	 *
	 * Not `load`: nothing here is allowed to blank the page the reader is reading. The document is
	 * replaced in place, marks are re-read for the words that now exist, and the reader's scroll
	 * position is left alone.
	 */
	async function showLatestWords() {
		if (!document) return;
		if (chosen) {
			refreshWhenFree = true;
			return;
		}

		try {
			const { repository } = await session();
			const fresh = await repository.getDocument(document.id);
			document = fresh;
			states = await repository.getStates(lexemesIn(fresh));
			refreshWhenFree = false;
		} catch {
			// The words on screen are still correct words, just not the newest ones, and the next
			// batch will bring another chance. Nothing here is worth interrupting reading for.
		}
	}

	/** The reader has finished with the menu, so a refresh that was waiting for them can happen. */
	function menuClosed() {
		chosen = null;
		if (refreshWhenFree) void showLatestWords();
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
			await repository.assertState(token.lexemeId, state, {
				documentId: document.id,
				fromOffset: token.start,
				toOffset: token.end
			});
			states = await repository.getStates(lexemesIn(document));
		} catch (error) {
			problem = error;
			await record(error);
		}
	}

	/** Failures go to the on-device record as well as to the screen (FR-021). */
	async function record(error: unknown) {
		try {
			const { repository } = await session();
			await repository.recordDiagnostic('storage', describeError(error));
		} catch {
			// The database is the thing that failed. Nothing further to try.
		}
	}

	/** How much of the document the upgrade has reached, for the subtitle. */
	function percentUpgraded(loaded: StoredDocument): number {
		if (!loaded.upgrade) return 100;
		return Math.round((loaded.upgrade.through / characters.length) * 100);
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
	<p class="loading">{resegmenting ? 'Finding the words…' : 'Opening…'}</p>
{:else if problem}
	<ErrorNotice error={problem} onretry={() => load(Number(page.params.id))} />
{:else if document}
	<h1>{document.title}</h1>
	<!-- The version is a fingerprint of the analyzer's own behaviour, not a number anyone chose
	     (ADR-0011), so it reads as opaque and is meant to. It is shown because it is the only way
	     to tell whether this device's ICU segments like the one the comparison was run on. -->
	<p class="subtitle">
		Segmented by {document.analyzer} · {document.analyzerVersion}{#if document.upgrade}<br />
			<!-- Two stamps, because a document mid-upgrade genuinely has two: the words before the
			     boundary came from one analyzer and the words after it from another (ADR-0016). A
			     single stamp here would be describing part of the page and claiming all of it. -->
			Upgrading to {document.upgrade.analyzer} — {percentUpgraded(document)}% done{/if}
	</p>

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
			onclose={menuClosed}
		/>
	{/if}
{/if}
