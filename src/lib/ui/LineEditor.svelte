<script lang="ts">
	/**
	 * One shown line opened for editing by hand (media/layout.ts): its Chinese joined to a
	 * neighbour, cut at a cursor, or shown earlier or later; its English joined, cut, or moved to
	 * another line. A panel along the bottom, not a dialog, so the video stays in view while timing.
	 */
	import { untrack } from 'svelte';
	import { wordsOf } from '$lib/media/layout';
	import type { LineWord } from './MediaReader.svelte';

	interface Neighbour {
		chinese: string;
		english?: string;
	}

	let {
		s,
		count,
		words,
		english,
		before,
		after,
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
		english?: string;
		before?: Neighbour;
		after?: Neighbour;
		/** This line's own timing change, and every line's, in ms. */
		shiftMs: number;
		offsetMs: number;
		canUndo: boolean;
		edits: {
			joinChinese(s: number, way: -1 | 1): void;
			/** A new line starting at this offset in the document. */
			cutChinese(offset: number): void;
			shiftTime(s: number, ms: number, all: boolean): void;
			joinEnglish(s: number, way: -1 | 1): void;
			splitEnglish(s: number, word: number): void;
			shiftEnglish(s: number, by: -1 | 1, onward: boolean): void;
		};
		onplay: () => void;
		onmove: (s: number) => void;
		onundo: () => void;
		onclose: () => void;
	} = $props();

	const englishWords = $derived(english ? wordsOf(english) : []);
	/** Where each cut goes: before this word. */
	let chineseAt = $state(1);
	let englishAt = $state(1);
	let allLines = $state(false);
	let onward = $state(false);
	// A new line, or the line changed under the cursor: the cursor goes back to the middle.
	$effect(() => {
		const n = words.length;
		const e = englishWords.length;
		void s;
		untrack(() => {
			chineseAt = Math.max(1, Math.floor(n / 2));
			englishAt = Math.max(1, Math.floor(e / 2));
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

	{#if before}
		<button class="neighbour" onclick={() => onmove(s - 1)} aria-label="Edit the line before">
			<span lang="zh">{before.chinese}</span>{#if before.english}<span lang="en"
					>{before.english}</span
				>{/if}
		</button>
	{/if}

	<div class="part">
		<p class="text chinese" lang="zh">
			{#each words as word, k (word.key)}{#if k === chineseAt && words.length > 1}<span
						class="cursor"
						aria-hidden="true"
					></span>{/if}<button class="piece" onclick={() => (chineseAt = Math.max(1, k))}
					>{word.text}</button
				>{/each}
		</p>
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

	<div class="part">
		{#if english}
			<p class="text" lang="en">
				{#each englishWords as word, k (k)}{#if k === englishAt && englishWords.length > 1}<span
							class="cursor"
							aria-hidden="true"
						></span>{/if}<button class="piece word" onclick={() => (englishAt = Math.max(1, k))}
						>{word}</button
					>{/each}
			</p>
			{#if englishWords.length > 1}
				<input
					type="range"
					min="1"
					max={englishWords.length - 1}
					bind:value={englishAt}
					aria-label="Where to split the English"
				/>
			{/if}
		{:else}
			<p class="text muted">No English on this line.</p>
		{/if}
		<div class="row">
			<button onclick={() => edits.joinEnglish(s, -1)} disabled={s === 0}>⤒ Join previous</button>
			<button onclick={() => edits.joinEnglish(s, 1)} disabled={s + 1 >= count}>⤓ Join next</button>
			<button
				onclick={() => edits.splitEnglish(s, englishAt)}
				disabled={englishWords.length < 2 || s + 1 >= count}
				title="The rest goes to the next line">✂ Split</button
			>
		</div>
		<div class="row">
			<label><input type="checkbox" bind:checked={onward} /> and all after</label>
			<button onclick={() => edits.shiftEnglish(s, -1, onward)} disabled={!english || s === 0}
				>↑ Earlier line</button
			>
			<button onclick={() => edits.shiftEnglish(s, 1, onward)} disabled={!english || s + 1 >= count}
				>↓ Later line</button
			>
		</div>
	</div>

	{#if after}
		<button class="neighbour" onclick={() => onmove(s + 1)} aria-label="Edit the line after">
			<span lang="zh">{after.chinese}</span>{#if after.english}<span lang="en">{after.english}</span
				>{/if}
		</button>
	{/if}
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
	/* English words are buttons side by side: the space between them is a margin. */
	.word {
		margin-right: 0.3em;
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
	.neighbour {
		all: unset;
		cursor: pointer;
		display: flex;
		flex-direction: column;
		opacity: 0.55;
		font-size: 0.9rem;
	}
	.muted {
		color: var(--muted);
		font-size: 0.9rem;
	}
</style>
