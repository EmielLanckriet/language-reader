<script lang="ts">
	import { ankiImportOf } from '$lib/domain/anki';
	import { ANKI_LEVELS, AVAILABLE_STATES } from '$lib/domain/state';
	import { lookUp } from '$lib/analyzer/lookup';
	import { recall, type Memory } from '$lib/domain/memory';
	import type { FsrsParameters } from '$lib/domain/anki';
	import type { Skill } from '$lib/domain/encounter';

	/**
	 * The menu a tap opens (FR-006).
	 *
	 * A menu rather than a cycling tap, because FR-006a refuses to promise a small fixed number of
	 * states: cycling only works when the reader can predict what comes next, and it stops working
	 * the moment a fifth state exists. The states are read from configuration for the same reason,
	 * so adding one changes nothing here.
	 */
	let {
		word,
		sentence,
		marking = true,
		current,
		provenance,
		onchoose,
		onknew,
		onclose,
		memory,
		parameters
	}: {
		word: string;
		sentence?: string;
		/** False while a transcript is still arriving: there is no stored word to mark yet. */
		marking?: boolean;
		current: string | null;
		/** How the current state was acquired: shown when it came from Anki (FR-012). */
		provenance?: string;
		onchoose: (state: string) => void;
		/** The reader only checked a word they knew: a check, not a lookup (spec 007). */
		onknew?: () => void;
		onclose: () => void;
		/** The word's memory per skill (spec 007, FR-018), shown in plain words. */
		memory?: Partial<Record<Skill, Memory>>;
		parameters?: FsrsParameters;
	} = $props();

	const DAY_MS = 86_400_000;

	function describeSkill(name: string, m: Memory | undefined): string {
		if (!m) return `${name}: —`;
		const chance = Math.round(recall(m, new Date(), parameters) * 100);
		const days = Math.round((new Date(m.due).getTime() - Date.now()) / DAY_MS);
		const next =
			new Date(m.due).getTime() <= Date.now()
				? 'due now'
				: days < 1
					? 'next review today'
					: days === 1
						? 'next review tomorrow'
						: `next review in ${days} days`;
		return `${name}: ${chance}% today, ${next}`;
	}

	const remembered = $derived.by(() => {
		if (!memory?.reading && !memory?.listening) return null;
		const reading = memory.reading;
		const origin = reading?.reviewed
			? 'Reviewed in the Reader'
			: reading?.seeded
				? 'Started from Anki'
				: 'From your lookups';
		return {
			skills: `${describeSkill('Reading', memory.reading)} · ${describeSkill('Listening', memory.listening)}`,
			origin
		};
	});

	const looked = $derived(lookUp(word));
	const fromAnki = $derived.by(() => {
		const id = provenance && ankiImportOf(provenance);
		const level = ANKI_LEVELS.find((level) => level.name === current);
		return id && level
			? `${level.label}, from the import of ${new Date(id).toLocaleDateString()}`
			: null;
	});
	const translateUrl = $derived(
		sentence &&
			`https://translate.google.com/?sl=zh-CN&tl=en&op=translate&text=${encodeURIComponent(sentence)}`
	);
</script>

<svelte:window
	onkeydown={(event) => {
		if (event.key === 'Escape') onclose();
	}}
/>

<!-- Clicking the backdrop dismisses. The button is the accessible way to do the same thing. -->
<div class="backdrop">
	<button class="dismiss" onclick={onclose} aria-label="Close without marking"></button>

	<div class="sheet" role="dialog" aria-modal="true" aria-label="Mark {word}">
		<p class="word" lang="zh">{word}</p>

		<div class="meanings">
			{#await looked}
				<p class="muted">Looking up…</p>
			{:then parts}
				{#each parts as part (part.text)}
					{#if parts.length > 1}<p class="part" lang="zh">{part.text}</p>{/if}
					{#each part.entries.slice(0, 4) as entry, i (i)}
						<p><span class="pinyin">{entry.pinyin}</span> {entry.meaning}</p>
					{/each}
				{:else}
					<p class="muted">Not in the dictionary.</p>
				{/each}
			{:catch error}
				<p class="muted">{error.message}</p>
			{/await}
		</div>

		{#if translateUrl}
			<!-- An external site, so there is nothing for resolve() to resolve. -->
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
			<a class="translate" href={translateUrl} target="_blank" rel="noreferrer"
				>Translate sentence ↗</a
			>
		{/if}

		{#if remembered}
			<p class="muted memory">{remembered.skills}</p>
			<p class="muted memory">
				{remembered.origin}{#if fromAnki}
					· {fromAnki}{/if}
			</p>
		{:else if fromAnki}<p class="muted anki">{fromAnki}</p>{/if}

		{#if marking}
			<div class="choices">
				{#each AVAILABLE_STATES as state (state.name)}
					<button
						class="choice"
						class:chosen={current === state.name}
						onclick={() => onchoose(state.name)}
					>
						<span class="swatch state-{state.name}"></span>
						{state.label}
					</button>
				{/each}
			</div>
		{:else}
			<p class="muted">You can mark words once the transcript is complete.</p>
		{/if}

		<div class="closing">
			{#if onknew}<button class="secondary" onclick={onknew}>I knew it</button>{/if}
			<button class="secondary cancel" onclick={onclose}>Cancel</button>
		</div>
	</div>
</div>

<style>
	.closing {
		display: flex;
		gap: 0.5rem;
	}
	.closing > button {
		flex: 1;
	}
	.meanings {
		max-height: 30vh;
		overflow-y: auto;
		margin-bottom: 0.75rem;
		font-size: 0.95rem;
		line-height: 1.4;
	}

	.meanings p {
		margin: 0.2rem 0;
	}

	.pinyin {
		font-weight: 600;
		margin-right: 0.3rem;
	}

	.part {
		font-size: 1.2rem;
		margin-top: 0.5rem !important;
	}

	.muted {
		color: var(--muted);
	}

	.translate {
		display: block;
		margin-bottom: 0.75rem;
	}

	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 10;
		display: flex;
		align-items: flex-end;
		justify-content: center;
	}

	/* Covers the viewport behind the sheet. Not a target the reader aims at, so the 44px floor
	   that applies to real controls is irrelevant here. */
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

	/* Anchored to the bottom of the screen, where a thumb reaches without shifting grip. */
	.sheet {
		position: relative;
		width: 100%;
		max-width: 32rem;
		background: var(--paper);
		border-top-left-radius: 16px;
		border-top-right-radius: 16px;
		padding: 1rem 1rem calc(1rem + env(safe-area-inset-bottom));
		box-shadow: 0 -8px 30px rgba(0, 0, 0, 0.25);
	}

	.word {
		font-size: 2rem;
		text-align: center;
		margin: 0.25rem 0 1rem;
	}

	.choices {
		display: grid;
		gap: 0.5rem;
	}

	.choice {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
		background: transparent;
		color: var(--ink);
		border: 1px solid var(--rule);
		text-align: left;
		padding: 0.75rem 1rem;
	}

	.choice.chosen {
		border-color: var(--accent);
		border-width: 2px;
	}

	.swatch {
		width: 1rem;
		height: 1rem;
		border-radius: 50%;
		flex: none;
	}

	.swatch.state-unknown {
		background: var(--unknown);
	}
	.swatch.state-learning {
		background: var(--learning);
	}
	.swatch.state-known {
		background: var(--known);
	}
	.swatch.state-ignored {
		background: var(--ignored);
	}

	.cancel {
		width: 100%;
		margin-top: 0.75rem;
	}
</style>
