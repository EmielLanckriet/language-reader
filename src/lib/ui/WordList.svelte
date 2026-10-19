<script lang="ts">
	import { session } from '$lib/storage/session';
	import { lookUpAll } from '$lib/analyzer/lookup';
	import type { FsrsParameters } from '$lib/domain/anki';
	import type { WordDetail, WordListEntry } from '$lib/storage/repository';
	import { COLUMNS, DEFAULT_COLUMNS, matches, sortWords, type Gloss } from './word-list';
	import ErrorNotice from './ErrorNotice.svelte';
	import WordDetailSheet from './WordDetailSheet.svelte';

	// Thousands of words: held as plain data, never as deep $state proxies.
	let words = $state.raw<WordListEntry[] | null>(null);
	let parameters = $state.raw<FsrsParameters | undefined>(undefined);
	let glosses = $state.raw(new Map<number, Gloss>());
	let problem = $state<unknown>(null);
	let query = $state('');
	let now = $state(new Date());

	const COLUMNS_KEY = 'reader.wordColumns';
	function readColumns(): string[] {
		try {
			const stored = JSON.parse(localStorage.getItem(COLUMNS_KEY) ?? 'null');
			if (Array.isArray(stored)) return stored.filter((key) => COLUMNS.some((c) => c.key === key));
		} catch {
			// Unreadable or blocked: the defaults.
		}
		return DEFAULT_COLUMNS;
	}
	let shownKeys = $state(readColumns());
	function toggleColumn(key: string) {
		shownKeys = shownKeys.includes(key) ? shownKeys.filter((k) => k !== key) : [...shownKeys, key];
		try {
			localStorage.setItem(COLUMNS_KEY, JSON.stringify(shownKeys));
		} catch {
			// Not kept: this visit still shows them.
		}
	}
	// In the order of COLUMNS, whatever order they were chosen in.
	const shown = $derived(COLUMNS.filter((column) => shownKeys.includes(column.key)));
	let choosing = $state(false);

	let sortKey = $state('reading-due');
	let descending = $state(false);
	function sortBy(key: string) {
		if (sortKey === key) descending = !descending;
		else {
			sortKey = key;
			descending = false;
		}
	}

	const context = $derived({ now, parameters });
	const sorted = $derived.by(() => {
		if (!words) return [];
		if (sortKey === 'word')
			return [...words].sort(
				(a, b) => (descending ? -1 : 1) * a.form.localeCompare(b.form, 'zh-Hans-u-co-pinyin')
			);
		const column = COLUMNS.find((c) => c.key === sortKey) ?? COLUMNS[0];
		return sortWords(words, column, descending, glosses, context);
	});
	const found = $derived(sorted.filter((word) => matches(word.form, glosses.get(word.id), query)));

	async function load() {
		try {
			const { repository } = await session();
			const list = await repository.wordList();
			now = new Date();
			parameters = list.parameters;
			words = list.words;
			// Characters at once; pinyin and English as the dictionary answers (fast first).
			const parts = await lookUpAll(list.words.map((word) => word.form));
			glosses = new Map(
				list.words.flatMap((word, i): [number, Gloss][] => {
					const entries = parts[i].map((part) => part.entries[0]);
					if (entries.some((entry) => entry === undefined)) return [];
					return [
						[
							word.id,
							{
								pinyin: entries.map((entry) => entry.pinyin).join(' '),
								meaning: entries.map((entry) => entry.meaning).join(' + ')
							}
						]
					];
				})
			);
		} catch (error) {
			problem = error;
		}
	}
	$effect(() => {
		void load();
	});

	// Windowed: only the rows near the screen are built. Every row is ROW pixels tall.
	const ROW = 44;
	const SPARE = 15;
	let body = $state<HTMLElement>();
	let first = $state(0);
	let count = $state(40);
	function measure() {
		if (!body) return;
		const top = body.getBoundingClientRect().top;
		first = Math.max(0, Math.floor(-top / ROW) - SPARE);
		count = Math.ceil(window.innerHeight / ROW) + 2 * SPARE;
	}
	$effect(() => {
		measure();
		window.addEventListener('scroll', measure, { passive: true });
		window.addEventListener('resize', measure);
		return () => {
			window.removeEventListener('scroll', measure);
			window.removeEventListener('resize', measure);
		};
	});
	const visible = $derived(found.slice(first, first + count));
	const template = $derived(`5rem ${shown.map((c) => `${c.width}rem`).join(' ')}`);
	const width = $derived(5 + shown.reduce((sum, c) => sum + c.width, 0) + 1);

	let chosen = $state.raw<WordListEntry | null>(null);
	let detail = $state.raw<Promise<WordDetail> | null>(null);
	async function open(word: WordListEntry) {
		chosen = word;
		detail = session().then(({ repository }) => repository.wordDetail(word.id));
	}
</script>

<section class="words" aria-labelledby="words-heading">
	<h2 id="words-heading">Words</h2>
	{#if problem}
		<ErrorNotice error={problem} />
	{:else if words === null}
		<p class="muted">Reading your words…</p>
	{:else}
		<div class="tools">
			<input
				type="search"
				bind:value={query}
				placeholder="水果, shuiguo or fruit"
				aria-label="Search words"
			/>
			<button class="secondary" aria-expanded={choosing} onclick={() => (choosing = !choosing)}>
				Columns
			</button>
		</div>
		{#if choosing}
			<fieldset class="columns">
				<legend>Show</legend>
				{#each COLUMNS as column (column.key)}
					<label>
						<input
							type="checkbox"
							checked={shownKeys.includes(column.key)}
							onchange={() => toggleColumn(column.key)}
						/>
						{column.label}
					</label>
				{/each}
			</fieldset>
		{/if}
		<p class="muted count">
			{found.length === words.length
				? `${words.length} ${words.length === 1 ? 'word' : 'words'}`
				: `${found.length} of ${words.length} ${words.length === 1 ? 'word' : 'words'}`}
			{#if glosses.size === 0}· looking up pinyin and meanings…{/if}
		</p>

		<div class="table" role="table" aria-label="Words">
			<div
				class="row head"
				role="row"
				style:grid-template-columns={template}
				style:width="{width}rem"
			>
				{#each [{ key: 'word', label: 'Word' }, ...shown] as column (column.key)}
					<button
						class="cell sort"
						role="columnheader"
						aria-sort={sortKey === column.key ? (descending ? 'descending' : 'ascending') : 'none'}
						onclick={() => sortBy(column.key)}
					>
						{column.label}{sortKey === column.key ? (descending ? ' ↓' : ' ↑') : ''}
					</button>
				{/each}
			</div>
			<div
				class="body"
				bind:this={body}
				style:height="{found.length * ROW}px"
				style:width="{width}rem"
			>
				{#each visible as word, i (word.id)}
					{@const gloss = glosses.get(word.id)}
					<button
						class="row"
						role="row"
						style:top="{(first + i) * ROW}px"
						style:grid-template-columns={template}
						onclick={() => open(word)}
					>
						<span class="cell word" role="cell" lang="zh">{word.form}</span>
						{#each shown as column (column.key)}
							<span class="cell" role="cell">{column.shown(word, gloss, context)}</span>
						{/each}
					</button>
				{/each}
			</div>
		</div>
	{/if}
</section>

{#if chosen && detail}
	<WordDetailSheet
		word={chosen}
		gloss={glosses.get(chosen.id)}
		{detail}
		{context}
		onclose={() => {
			chosen = null;
			detail = null;
		}}
		onstatus={(status) => {
			const id = chosen!.id;
			words = words!.map((w) => (w.id === id ? { ...w, status } : w));
			chosen = { ...chosen!, status };
		}}
	/>
{/if}

<style>
	.words {
		margin-top: 2rem;
	}
	.tools {
		display: flex;
		gap: 0.5rem;
	}
	.tools input {
		flex: 1;
		min-width: 0;
	}
	.columns {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 1rem;
		border: 1px solid var(--rule);
		border-radius: 12px;
		margin: 0.5rem 0 0;
	}
	.columns label {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		min-height: 44px;
	}
	.count {
		margin: 0.5rem 0;
		font-size: 0.85rem;
	}
	/* The list scrolls sideways when the chosen columns are wider than the screen. */
	.table {
		overflow-x: auto;
	}
	.row {
		display: grid;
		align-items: center;
		min-width: 100%;
		height: 44px;
		padding: 0;
		background: none;
		color: var(--ink);
		border: none;
		border-bottom: 1px solid var(--rule);
		border-radius: 0;
		text-align: left;
		font: inherit;
	}
	.body {
		position: relative;
		min-width: 100%;
	}
	.body .row {
		position: absolute;
		left: 0;
		right: 0;
	}
	.head {
		border-bottom: 2px solid var(--rule);
	}
	.cell {
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		padding: 0 0.5rem 0 0;
		font-size: 0.9rem;
	}
	.sort {
		height: 44px;
		min-height: 0;
		background: none;
		color: var(--muted);
		border: none;
		border-radius: 0;
		text-align: left;
		font-size: 0.75rem;
		font-weight: 650;
	}
	.word {
		font-size: 1.15rem;
	}
	.muted {
		color: var(--muted);
	}
</style>
