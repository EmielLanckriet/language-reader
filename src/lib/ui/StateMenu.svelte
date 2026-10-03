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
		ontranslate,
		onclose,
		memory,
		parameters,
		readings,
		joinRefused,
		onjoin,
		onsplit
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
		/** The sentence's translation was opened: its words were helped (2026-10-04). */
		ontranslate?: () => void;
		onclose: () => void;
		/** The word's memory per skill (spec 007, FR-018), shown in plain words. */
		memory?: Partial<Record<Skill, Memory>>;
		parameters?: FsrsParameters;
		/** The pinyin shown above each character, which picks the dictionary sense heard here. */
		readings?: string[];
		/** Why this word cannot be joined with the next, shown when the reader asks (FR-003). */
		joinRefused?: string;
		/** Correcting the segmentation (spec 004); absent where there is nothing stored to correct. */
		onjoin?: () => void;
		onsplit?: (at: number) => void;
	} = $props();

	let refusal = $state<string | null>(null);
	const splits = $derived.by(() => {
		const cs = [...word];
		return cs.slice(1).map((_, i) => ({
			at: i + 1,
			label: `${cs.slice(0, i + 1).join('')} · ${cs.slice(i + 1).join('')}`
		}));
	});

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

	const looked = $derived(lookUp(word, readings));
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
		<!-- Compact on purpose: in full screen the phone is in landscape, about 380 px tall, and a
		     sheet anchored to the bottom loses its top — the word and its meaning — first. -->
		<div class="head">
			<p class="word" lang="zh">{word}</p>
			<div class="meanings">
				{#await looked}
					<p class="muted">Looking up…</p>
				{:then parts}
					{#if parts.length > 1}
						<p class="muted">Not in the dictionary as one word. Its parts:</p>
					{/if}
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
			<button class="icon close" onclick={onclose} aria-label="Cancel" title="Close">✕</button>
		</div>

		{#if remembered}
			<p class="muted small">
				{remembered.skills} · {remembered.origin}{#if fromAnki}
					· {fromAnki}{/if}
			</p>
		{:else if fromAnki}<p class="muted small">{fromAnki}</p>{/if}

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
			<p class="muted small">You can mark words once the transcript is complete.</p>
		{/if}

		<div class="actions">
			{#if translateUrl}
				<!-- An external site, so there is nothing for resolve() to resolve. -->
				<!-- eslint-disable svelte/no-navigation-without-resolve -->
				<a
					href={translateUrl}
					onclick={() => ontranslate?.()}
					class="icon tap"
					target="_blank"
					rel="noreferrer"
					aria-label="Translate sentence"
					title="Translate sentence">🌐</a
				>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
			{/if}
			{#if onknew}
				<button class="icon" onclick={onknew} aria-label="I knew it" title="I knew it">✓</button>
			{/if}
			{#if onjoin}
				<button
					class="icon"
					onclick={() => (joinRefused ? (refusal = joinRefused) : onjoin())}
					aria-label="Join with next"
					title="Join with next">⇥</button
				>
			{/if}
			{#if onsplit}
				{#each splits as split (split.at)}
					<button
						class="icon split"
						lang="zh"
						onclick={() => onsplit(split.at)}
						aria-label="Split {split.label}"
						title="Split {split.label}">✂ {split.label.replace(' · ', '|')}</button
					>
				{/each}
			{/if}
		</div>
		{#if refusal}<p class="muted small" role="alert">{refusal}</p>{/if}
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

	/* Anchored to the bottom, where a thumb reaches; never taller than the screen, so nothing is
	   cut off — it scrolls instead. */
	.sheet {
		position: relative;
		width: 100%;
		max-width: 36rem;
		max-height: 100dvh;
		overflow-y: auto;
		background: var(--paper);
		border-top-left-radius: 12px;
		border-top-right-radius: 12px;
		padding: 0.5rem 0.75rem calc(0.5rem + env(safe-area-inset-bottom));
		box-shadow: 0 -8px 30px rgba(0, 0, 0, 0.25);
		display: grid;
		gap: 0.4rem;
	}

	.head {
		display: flex;
		align-items: flex-start;
		gap: 0.6rem;
	}

	.word {
		font-size: 1.6rem;
		line-height: 1.2;
		margin: 0;
		flex: none;
	}

	.meanings {
		flex: 1;
		min-width: 0;
		max-height: 7.5rem;
		overflow-y: auto;
		font-size: 0.85rem;
		line-height: 1.3;
	}

	.meanings p {
		margin: 0 0 0.15rem;
	}

	.pinyin {
		font-weight: 600;
		margin-right: 0.3rem;
	}

	.part {
		font-size: 1rem;
		margin-top: 0.25rem !important;
	}

	.muted {
		color: var(--muted);
	}

	.small {
		font-size: 0.75rem;
		margin: 0;
	}

	.choices {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 0.3rem;
	}

	.choice {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.3rem;
		min-height: 34px;
		min-width: 0;
		padding: 0.2rem 0.3rem;
		font-size: 0.8rem;
		background: transparent;
		color: var(--ink);
		border: 1px solid var(--rule);
	}

	.choice.chosen {
		border-color: var(--accent);
		border-width: 2px;
	}

	.swatch {
		width: 0.7rem;
		height: 0.7rem;
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

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}

	.icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 34px;
		min-width: 34px;
		padding: 0 0.5rem;
		font-size: 0.95rem;
		background: transparent;
		color: var(--accent);
		border: 1px solid var(--rule);
		border-radius: 6px;
		text-decoration: none;
	}

	.icon.split {
		font-size: 0.85rem;
	}

	.close {
		flex: none;
		border: none;
		color: var(--muted);
	}
</style>
