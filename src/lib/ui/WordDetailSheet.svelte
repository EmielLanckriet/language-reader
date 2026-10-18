<script lang="ts">
	import { lookUp } from '$lib/analyzer/lookup';
	import { recall, type Memory } from '$lib/domain/memory';
	import type { WordDetail, WordListEntry } from '$lib/storage/repository';
	import { deckStatus, fromNow, markLabel, type Context, type Gloss } from './word-list';
	import ErrorNotice from './ErrorNotice.svelte';

	// Read only (issue #47): this sheet shows a word's data and changes nothing.
	let {
		word,
		gloss,
		detail,
		context,
		onclose
	}: {
		word: WordListEntry;
		gloss: Gloss | undefined;
		detail: Promise<WordDetail>;
		context: Context;
		onclose: () => void;
	} = $props();

	const meanings = $derived(lookUp(word.form));
	const date = (at: string) =>
		new Date(at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
	const skills = $derived(
		[
			['Reading', word.reading],
			['Listening', word.listening]
		].filter((entry): entry is [string, Memory] => entry[1] !== undefined)
	);
</script>

<svelte:window
	onkeydown={(event) => {
		if (event.key === 'Escape') onclose();
	}}
/>

<div class="backdrop">
	<button class="dismiss" onclick={onclose} aria-label="Close"></button>
	<div class="sheet" role="dialog" aria-modal="true" aria-label="About {word.form}">
		<div class="head">
			<p class="form" lang="zh">{word.form}</p>
			{#if gloss}<p class="pinyin">{gloss.pinyin}</p>{/if}
		</div>
		{#await meanings}
			<p class="muted">Looking up…</p>
		{:then parts}
			{#each parts as part (part.text)}
				{#if parts.length > 1}<p class="part" lang="zh">{part.text}</p>{/if}
				{#each part.entries as entry, i (i)}
					<p class="meaning"><span class="muted">{entry.pinyin}</span> {entry.meaning}</p>
				{:else}<p class="muted">Not in the dictionary.</p>{/each}
			{/each}
		{:catch error}<ErrorNotice {error} />{/await}

		<dl>
			<dt>Deck</dt>
			<dd>{deckStatus(word)}</dd>
			{#if markLabel(word.mark)}
				<dt>Mark</dt>
				<dd>{markLabel(word.mark)}</dd>
			{/if}
		</dl>

		{#each skills as [name, memory] (name)}
			<h3>{name}</h3>
			<dl>
				<dt>Recall now</dt>
				<dd>{Math.round(recall(memory, context.now, context.parameters) * 100)} %</dd>
				<dt>Stability</dt>
				<dd>{memory.stability.toFixed(1)} days</dd>
				<dt>Due</dt>
				<dd>{date(memory.due)} ({fromNow(memory.due, context.now)})</dd>
				<dt>Last seen</dt>
				<dd>{date(memory.lastAt)} ({fromNow(memory.lastAt, context.now)})</dd>
				<dt>Difficulty</dt>
				<dd>{memory.difficulty.toFixed(1)} of 10</dd>
				<dt>Reviews</dt>
				<dd>{memory.reps}, {memory.lapses} lapsed</dd>
				{#if memory.seeded}
					<dt>From Anki</dt>
					<dd>{memory.seeded === 'anki-undated' ? 'yes, last review unknown' : 'yes'}</dd>
				{/if}
			</dl>
		{:else}
			<p class="muted">No memory yet: nothing read, heard or reviewed counts for it so far.</p>
		{/each}

		{#await detail}
			<p class="muted">Finding where you met it…</p>
		{:then found}
			<h3>Met in</h3>
			{#if found.met.length === 0 && !found.ankiExample}
				<p class="muted">Not met in your library.</p>
			{:else}
				<ul>
					{#each found.met as document (document.documentId)}<li>{document.title}</li>{/each}
					{#if found.ankiExample}<li>An Anki example sentence</li>{/if}
				</ul>
			{/if}
			{#if found.marks.length > 0}
				<h3>Marks</h3>
				<ul>
					{#each found.marks as mark, i (i)}
						<li>{markLabel(mark.asserted) || 'Unmarked'} · {date(mark.at)}</li>
					{/each}
				</ul>
			{/if}
		{:catch error}<ErrorNotice {error} />{/await}

		<button class="secondary" onclick={onclose}>Close</button>
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 10;
		display: flex;
		align-items: flex-end;
		justify-content: center;
	}
	/* Covers the viewport behind the sheet; tapping it closes, the Close button is the accessible way. */
	.dismiss {
		position: absolute;
		inset: 0;
		width: 100%;
		min-width: 0;
		min-height: 0;
		background: rgba(0, 0, 0, 0.35);
		border: none;
		border-radius: 0;
		padding: 0;
	}
	.sheet {
		position: relative;
		width: 100%;
		max-width: 36rem;
		max-height: 85dvh;
		overflow-y: auto;
		background: var(--paper);
		border-top-left-radius: 12px;
		border-top-right-radius: 12px;
		padding: 0.75rem 1rem calc(0.75rem + env(safe-area-inset-bottom));
		box-shadow: 0 -8px 30px rgba(0, 0, 0, 0.25);
	}
	.head {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
	}
	.form {
		font-size: 2rem;
		margin: 0;
	}
	.pinyin,
	.part {
		margin: 0;
	}
	.meaning {
		margin: 0.15rem 0;
	}
	h3 {
		font-size: 0.95rem;
		margin: 1rem 0 0.25rem;
	}
	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.15rem 1rem;
		margin: 0.5rem 0 0;
	}
	dt {
		color: var(--muted);
	}
	dd {
		margin: 0;
	}
	ul {
		margin: 0;
		padding-left: 1.2rem;
	}
	.muted {
		color: var(--muted);
	}
	.secondary {
		margin-top: 1rem;
		width: 100%;
	}
</style>
