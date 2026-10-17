<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { session } from '$lib/storage/session';
	import type { StoredDocument } from '$lib/storage/repository';
	import { loadMedia, type StoredMedia } from '$lib/media/store';
	import { resumeOf } from '$lib/media/cover';
	import { lineAt } from '$lib/media/subtitles';
	import { codePointsOf } from '$lib/domain/offsets';
	import { lineRangesOf } from '$lib/domain/helped';
	import { HARDCORE_STEPS, type HardcoreStep } from '$lib/domain/encounter';
	import {
		classify,
		cutByLoad,
		drillWords,
		type Filters,
		type FragmentWord,
		type LineSpan,
		type Order
	} from '$lib/domain/hardcore';
	import { clock, type PlanDetail } from '$lib/ui/hardcore';
	import ErrorNotice from '$lib/ui/ErrorNotice.svelte';

	/**
	 * Starting a hardcore session (spec 014): the options are chosen here every time, never kept
	 * with the document (clarified 2026-10-12). Start records the plan and opens the session.
	 */
	const id = $derived(Number(page.params.id));
	let document = $state<StoredDocument | null>(null);
	let media = $state<StoredMedia | null>(null);
	let characters: string[] = [];
	let lineRanges = $state<[number, number][]>([]);
	let words = $state(new Map<number, FragmentWord>());
	let resumeLine = $state(0);
	let problem = $state<unknown>(null);
	let starting = $state(false);

	let start = $state<PlanDetail['start']>('beginning');
	let from = $state(0);
	let to = $state(0);
	let cut = $state(false);
	let size = $state(20);
	let steps = $state<Record<HardcoreStep, boolean>>({
		preview: true,
		'watch-first': true,
		drill: true,
		'watch-after': true
	});
	let order = $state<Order>('frequency');
	let minOccurrences = $state<number | null>(null);
	let topRank = $state<number | null>(null);
	let coverage = $state<number | null>(null);

	const STEP_LABELS: Record<HardcoreStep, string> = {
		preview: 'English preview',
		'watch-first': 'Watch first',
		drill: 'Drill the words',
		'watch-after': 'Watch after'
	};

	$effect(() => {
		const wanted = id;
		let stopped = false;
		void (async () => {
			try {
				const { repository } = await session();
				const [found, foundMedia] = await Promise.all([
					repository.getDocument(wanted),
					loadMedia(wanted)
				]);
				const lexemes = [
					...new Set(found.tokens.flatMap((t) => (t.lexemeId === undefined ? [] : [t.lexemeId])))
				];
				const now = new Date();
				const [states, memory, ranks, resume] = await Promise.all([
					repository.getStates(lexemes),
					repository.getMemory(lexemes),
					repository.frequencyRanks(lexemes),
					foundMedia?.media ? resumeOf(wanted, foundMedia.cues).catch(() => 0) : 0
				]);
				if (stopped) return;
				const classified = new Map(
					lexemes.map((lexemeId): [number, FragmentWord] => {
						const { class: wordClass, known } = classify(
							states.get(lexemeId),
							memory.memory.get(lexemeId)?.reading,
							now,
							memory.parameters
						);
						const rank = ranks.get(lexemeId);
						return [
							lexemeId,
							{ lexemeId, class: wordClass, known, ...(rank === undefined ? {} : { rank }) }
						];
					})
				);
				characters = codePointsOf(found.rawContent);
				lineRanges = lineRangesOf(characters);
				words = classified;
				media = foundMedia;
				resumeLine = resume > 0 && foundMedia ? Math.max(0, lineAt(foundMedia.cues, resume)) : 0;
				to = lineRanges.length - 1;
				if (resumeLine > 0) start = 'continue';
				document = found;
			} catch (error) {
				if (!stopped) problem = error;
			}
		})();
		return () => (stopped = true);
	});

	const lastLine = $derived(Math.max(0, lineRanges.length - 1));
	const fragment = $derived.by((): LineSpan => {
		if (start === 'continue') return [resumeLine, lastLine];
		if (start === 'range') return [Math.min(from, to), Math.max(from, to)];
		return [0, lastLine];
	});
	const filters = $derived.by((): Filters => {
		const chosen: Filters = {};
		if (minOccurrences !== null && minOccurrences > 1) chosen.minOccurrences = minOccurrences;
		if (topRank !== null && topRank > 0) chosen.topRank = topRank;
		if (coverage !== null && coverage > 0) chosen.coverage = Math.min(100, coverage) / 100;
		return chosen;
	});
	const drill = $derived(
		document ? drillWords(lineRanges, fragment, document.tokens, words, { order, filters }) : []
	);
	const parts = $derived(
		cut && size > 0
			? cutByLoad(fragment, drill, size)
			: [{ lines: fragment, words: drill.map((w) => w.lexemeId) }]
	);
	const chosenSteps = $derived(HARDCORE_STEPS.filter((step) => steps[step]));

	/** A line as the pickers show it: its number, its time in a video, its first words. */
	function lineLabel(line: number): string {
		const range = lineRanges[line];
		const text = range
			? characters.slice(range[0], Math.min(range[1], range[0] + 14)).join('')
			: '';
		const at = media?.cues[line] ? `${clock(media.cues[line].start)} · ` : '';
		return `${line + 1} · ${at}${text}`;
	}

	function partLabel(lines: LineSpan): string {
		const cues = media?.cues;
		if (cues?.[lines[0]] && cues[lines[1]])
			return `${clock(cues[lines[0]].start)}–${clock(cues[lines[1]].end)}`;
		return `lines ${lines[0] + 1}–${lines[1] + 1}`;
	}

	async function begin() {
		if (!document || starting || chosenSteps.length === 0) return;
		starting = true;
		try {
			const { repository } = await session();
			const plan: PlanDetail = {
				start,
				fragment,
				cut: cut ? { size } : null,
				steps: chosenSteps,
				filters,
				order,
				parts
			};
			const sessionId = await repository.startSession(document.id, 'hardcore');
			await repository.recordEncounters(sessionId, [
				{ kind: 'hardcore-plan', at: new Date().toISOString(), detail: { ...plan } }
			]);
			await goto(resolve('/hardcore/[session]', { session: String(sessionId) }));
		} catch (error) {
			problem = error;
			starting = false;
		}
	}
</script>

<a class="back" href={resolve('/document/[id]', { id: String(id) })}>← Back</a>

{#if problem}
	<ErrorNotice error={problem} />
{:else if !document}
	<p class="loading">Finding the words…</p>
{:else}
	<h1>Hardcore</h1>
	<p class="subtitle">{document.title}</p>

	<fieldset>
		<legend>Fragment</legend>
		<label><input type="radio" bind:group={start} value="beginning" /> From the beginning</label>
		{#if resumeLine > 0}
			<label
				><input type="radio" bind:group={start} value="continue" /> Continue from {lineLabel(
					resumeLine
				)}</label
			>
		{/if}
		<label><input type="radio" bind:group={start} value="range" /> Choose the lines</label>
		{#if start === 'range'}
			<div class="range">
				<label
					>From <select bind:value={from}
						>{#each [...lineRanges.keys()] as i (i)}<option value={i}>{lineLabel(i)}</option
							>{/each}</select
					></label
				>
				<label
					>To <select bind:value={to}
						>{#each [...lineRanges.keys()] as i (i)}<option value={i}>{lineLabel(i)}</option
							>{/each}</select
					></label
				>
			</div>
		{/if}
	</fieldset>

	<fieldset>
		<legend>Steps</legend>
		{#each HARDCORE_STEPS as step (step)}
			<label><input type="checkbox" bind:checked={steps[step]} /> {STEP_LABELS[step]}</label>
		{/each}
	</fieldset>

	<fieldset>
		<legend>Words</legend>
		<label><input type="radio" bind:group={order} value="frequency" /> Most frequent first</label>
		<label><input type="radio" bind:group={order} value="story" /> In story order</label>
		<label class="number"
			>At least <input type="number" min="1" inputmode="numeric" bind:value={minOccurrences} /> times
			in the fragment</label
		>
		<label class="number"
			>Among the <input type="number" min="1" inputmode="numeric" bind:value={topRank} /> most common
			words</label
		>
		<label class="number"
			>Until <input type="number" min="1" max="100" inputmode="numeric" bind:value={coverage} />% of
			the running words are known</label
		>
	</fieldset>

	<fieldset>
		<legend>Parts</legend>
		<label><input type="checkbox" bind:checked={cut} /> Cut into parts of about</label>
		<label class="number"
			><input type="number" min="1" inputmode="numeric" bind:value={size} disabled={!cut} /> words</label
		>
	</fieldset>

	<p class="summary" role="status">
		{drill.length} words to drill{#if parts.length > 1}, in {parts.length} parts{/if}.
	</p>
	{#if parts.length > 1}
		<ol class="parts">
			{#each parts as part, i (i)}
				<li>
					{partLabel(part.lines)} · {part.words.length} words
				</li>
			{/each}
		</ol>
	{/if}
	<button class="play" onclick={begin} disabled={starting || chosenSteps.length === 0}>Start</button
	>
{/if}

<style>
	h1 {
		margin: 0.5rem 0 0;
	}
	fieldset {
		border: 1px solid var(--rule);
		border-radius: 12px;
		margin: 0.75rem 0;
		padding: 0.5rem 0.9rem 0.75rem;
		display: grid;
		gap: 0.35rem;
	}
	legend {
		font-weight: 600;
		padding: 0 0.3rem;
	}
	label {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.4rem;
		min-height: 40px;
	}
	.number input {
		width: 4.5rem;
	}
	.range {
		display: grid;
		gap: 0.3rem;
	}
	.range select {
		max-width: 100%;
		min-width: 0;
		flex: 1;
	}
	.summary {
		font-weight: 600;
	}
	.parts {
		margin: 0 0 0.5rem;
		padding-left: 1.4rem;
		color: var(--muted);
	}
	.play {
		width: 100%;
		min-height: 48px;
		border-radius: 12px;
		background: var(--accent);
		color: var(--on-accent);
		font-weight: 600;
		border: none;
	}
</style>
