<script lang="ts">
	/**
	 * One shown line opened for editing by hand (media/layout.ts): its Chinese joined to a
	 * neighbour, cut at a cursor, or shown earlier or later; its English is its share of the
	 * English run of words, moved by tapping a word: one in a line above to start there, one below
	 * to end there, one of its own to start or end there. A panel along the bottom, not a dialog, so
	 * the video stays in view while timing.
	 */
	import { untrack } from 'svelte';
	import type { LineWord } from './MediaReader.svelte';

	/** A line near the one being edited: its Chinese, and its English words to tap. */
	interface Near {
		s: number;
		chinese: string;
		english: string[];
	}

	let {
		s,
		count,
		words,
		english,
		around,
		shiftMs,
		offsetMs,
		canUndo,
		edits,
		onplay,
		onmove,
		onundo,
		onclose
	}: {
		s: number;
		count: number;
		words: LineWord[];
		/** This line's English words. */
		english: string[];
		/** Up to two lines before and two after, in order. */
		around: Near[];
		/** This line's own timing change, and every line's, in ms. */
		shiftMs: number;
		offsetMs: number;
		canUndo: boolean;
		edits: {
			joinChinese(s: number, way: -1 | 1): void;
			/** A new line starting at this offset in the document. */
			cutChinese(offset: number): void;
			shiftTime(s: number, ms: number, all: boolean): void;
			/** Line `s` starts (or ends) at word `word` of line `line`. */
			setEdge(s: number, line: number, word: number, edge: 'start' | 'end'): void;
		};
		onplay: () => void;
		onmove: (s: number) => void;
		onundo: () => void;
		onclose: () => void;
	} = $props();

	const before = $derived(around.filter((line) => line.s < s));
	const after = $derived(around.filter((line) => line.s > s));
	/** Where the Chinese cut goes: before this word. */
	let chineseAt = $state(1);
	/** A word of this line's English tapped: it asks whether the line starts or ends there. */
	let chosen = $state<number | null>(null);
	let allLines = $state(false);
	// A new line, or the line changed under the cursor: the cursor goes back to the middle.
	$effect(() => {
		const n = words.length;
		void s;
		void english;
		untrack(() => {
			chineseAt = Math.max(1, Math.floor(n / 2));
			chosen = null;
		});
	});

	const seconds = (ms: number) =>
		`${ms > 0 ? '+' : ms < 0 ? '−' : '±'}${Math.abs(ms / 1000).toFixed(1)} s`;
	const shift = (ms: number) => edits.shiftTime(s, ms, allLines);
</script>

<svelte:window
	onkeydown={(event) => {
		if (event.key === 'Escape') onclose();
	}}
/>

<section class="editor" aria-label="Edit line {s + 1}">
	<div class="head">
		<strong>Line {s + 1} of {count}</strong>
		<span class="grow"></span>
		<button onclick={onundo} disabled={!canUndo} aria-label="Undo">↶ Undo</button>
		<button class="icon" onclick={onclose} aria-label="Done editing">✕</button>
	</div>

	{#snippet near(line: Near, edge: 'start' | 'end')}
		<div class="near">
			<button
				class="near-chinese"
				lang="zh"
				onclick={() => onmove(line.s)}
				aria-label="Edit line {line.s + 1}">{line.chinese}</button
			>
			<p class="near-english" lang="en">
				{#each line.english as word, k (k)}<button
						class="word"
						onclick={() => edits.setEdge(s, line.s, k, edge)}
						aria-label="{edge === 'start' ? 'Start' : 'End'} line {s + 1} at “{word}”"
						>{word}</button
					>{:else}<span class="muted">—</span>{/each}
			</p>
		</div>
	{/snippet}

	{#each before as line (line.s)}{@render near(line, 'start')}{/each}

	<div class="current">
		<p class="text chinese" lang="zh">
			{#each words as word, k (word.key)}{#if k === chineseAt && words.length > 1}<span
						class="cursor"
						aria-hidden="true"
					></span>{/if}<button class="piece" onclick={() => (chineseAt = Math.max(1, k))}
					>{word.text}</button
				>{/each}
		</p>
		<p class="text english" lang="en">
			{#each english as word, k (k)}<button
					class="word own"
					class:chosen={chosen === k}
					onclick={() => (chosen = chosen === k ? null : k)}>{word}</button
				>{:else}<span class="muted">No English on this line.</span>{/each}
		</p>
		{#if chosen !== null}
			<div class="row choose">
				<button
					onclick={() => edits.setEdge(s, s, chosen!, 'start')}
					disabled={chosen === 0 || s === 0}>⇤ Start here</button
				>
				<button
					onclick={() => edits.setEdge(s, s, chosen!, 'end')}
					disabled={chosen === english.length - 1 || s + 1 >= count}>End here ⇥</button
				>
			</div>
		{/if}
	</div>

	{#each after as line (line.s)}{@render near(line, 'end')}{/each}

	<p class="hint">
		Tap an English word above to start this line there, below to end it there, or in this line to
		choose. Tap a Chinese line to edit it.
	</p>

	<div class="part">
		{#if words.length > 1}
			<input
				type="range"
				min="1"
				max={words.length - 1}
				bind:value={chineseAt}
				aria-label="Where to split the Chinese"
			/>
		{/if}
		<div class="row">
			<button onclick={() => edits.joinChinese(s, -1)} disabled={s === 0}>⤒ Join previous</button>
			<button onclick={() => edits.joinChinese(s, 1)} disabled={s + 1 >= count}>⤓ Join next</button>
			<button onclick={() => edits.cutChinese(words[chineseAt].key)} disabled={words.length < 2}
				>✂ Split</button
			>
		</div>
		<div class="row timing">
			<label><input type="checkbox" bind:checked={allLines} /> all lines</label>
			<button onclick={() => shift(-1000)}>−1 s</button>
			<button onclick={() => shift(-100)}>−0.1</button>
			<span class="amount">{seconds(allLines ? offsetMs : shiftMs)}</span>
			<button onclick={() => shift(100)}>+0.1</button>
			<button onclick={() => shift(1000)}>+1 s</button>
			<button onclick={onplay} aria-label="Play this line">▶</button>
		</div>
	</div>
</section>

<style>
	.editor {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 70;
		max-width: 36rem;
		max-height: 70dvh;
		margin: 0 auto;
		overflow-y: auto;
		background: var(--paper);
		color: var(--ink, inherit);
		border-top-left-radius: 12px;
		border-top-right-radius: 12px;
		padding: 0.5rem 0.75rem calc(0.75rem + env(safe-area-inset-bottom));
		box-shadow: 0 -8px 30px rgba(0, 0, 0, 0.25);
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.head,
	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem;
	}
	.grow {
		flex: 1;
	}
	.part {
		border-top: 1px solid var(--rule);
		padding-top: 0.4rem;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.text {
		margin: 0;
		font-size: 1.15rem;
		line-height: 1.6;
	}
	.chinese {
		font-size: 1.4rem;
	}
	.piece {
		all: unset;
		cursor: pointer;
	}
	.cursor {
		display: inline-block;
		width: 2px;
		height: 1.1em;
		margin: 0 2px;
		vertical-align: -0.15em;
		background: var(--accent, #c33);
	}
	input[type='range'] {
		width: 100%;
	}
	.head button,
	.row button {
		font-size: 0.85rem;
		padding: 0.2rem 0.55rem;
		min-height: 36px;
	}
	.timing label,
	.row label {
		font-size: 0.85rem;
	}
	.amount {
		min-width: 3.5rem;
		text-align: center;
		font-variant-numeric: tabular-nums;
	}
	.near {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}
	.near-chinese {
		all: unset;
		cursor: pointer;
		font-size: 0.95rem;
		color: var(--muted);
	}
	.near-english {
		margin: 0;
		font-size: 0.95rem;
		line-height: 1.7;
	}
	.current {
		border: 2px solid var(--accent, #c33);
		border-radius: 8px;
		padding: 0.3rem 0.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.english {
		font-size: 1.05rem;
		line-height: 1.8;
	}
	/* Each English word is a tap target; the space between words is a margin. */
	.word {
		all: unset;
		cursor: pointer;
		margin-right: 0.3em;
		padding: 0.1em 0.15em;
		border-radius: 4px;
		background: color-mix(in srgb, var(--rule) 45%, transparent);
	}
	.word.chosen {
		background: var(--accent, #c33);
		color: var(--paper);
	}
	.hint {
		margin: 0;
		font-size: 0.8rem;
		color: var(--muted);
	}
	.muted {
		color: var(--muted);
		font-size: 0.9rem;
	}
</style>
