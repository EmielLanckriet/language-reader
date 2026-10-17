<script lang="ts">
	import { page } from '$app/state';
	import { SvelteSet } from 'svelte/reactivity';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { session } from '$lib/storage/session';
	import type { StoredDocument } from '$lib/storage/repository';
	import { loadMedia, type StoredMedia } from '$lib/media/store';
	import { codePointsOf } from '$lib/domain/offsets';
	import { lineRangesOf } from '$lib/domain/helped';
	import { RETRACTED } from '$lib/domain/state';
	import { HARDCORE_STEPS, type HardcoreStep } from '$lib/domain/encounter';
	import { afterGrade, classify, nextStep, type StepRecord } from '$lib/domain/hardcore';
	import { englishFor, llmByLine } from '$lib/translation/lines';
	import { humanLines } from '$lib/media/translation';
	import { quickTranslation, type QuickStatus } from '$lib/translation/quick';
	import { clock, drillSentence, firstOccurrences, type PlanDetail } from '$lib/ui/hardcore';
	import CardFace from '$lib/ui/CardFace.svelte';
	import ErrorNotice from '$lib/ui/ErrorNotice.svelte';
	import type { CardHelp } from '$lib/domain/card-help';

	/**
	 * A hardcore session (spec 014): each part runs the chosen steps in order. Where the reader is
	 * comes from the session's records, so coming back from the player continues at the next step.
	 */
	const sessionId = $derived(Number(page.params.session));
	// Raw: replaced whole, never changed in place. Deep proxies made reading the document's tokens
	// for each card cost hundreds of milliseconds on the phone (issue #41).
	let document = $state.raw<StoredDocument | null>(null);
	let media = $state.raw<StoredMedia | null>(null);
	let plan = $state<PlanDetail | null>(null);
	let records = $state<StepRecord[]>([]);
	let characters: string[] = [];
	let lineRanges: [number, number][] = [];
	let fromPart = $state(0);
	let problem = $state<unknown>(null);
	let busy = $state(false);

	const STEP_LABELS: Record<HardcoreStep, string> = {
		preview: 'English preview',
		'watch-first': 'Watch first',
		drill: 'Drill',
		'watch-after': 'Watch after'
	};

	$effect(() => {
		const wanted = sessionId;
		let stopped = false;
		void (async () => {
			try {
				const { repository } = await session();
				const found = await repository.hardcoreSession(wanted);
				const [doc, foundMedia] = await Promise.all([
					repository.getDocument(found.documentId),
					loadMedia(found.documentId)
				]);
				if (stopped) return;
				characters = codePointsOf(doc.rawContent);
				lineRanges = lineRangesOf(characters);
				media = foundMedia?.media ? foundMedia : null;
				plan = found.plan as unknown as PlanDetail;
				records = found.steps;
				document = doc;
				// Back from the player or the reader: that step is done.
				const ended = page.url.searchParams.get('ended');
				if (ended) {
					const [part, step] = ended.split('.') as [string, HardcoreStep];
					if (HARDCORE_STEPS.includes(step)) await record(Number(part), step, 'end');
					fromPart = Number(part);
					await goto(resolve('/hardcore/[session]', { session: String(wanted) }), {
						replaceState: true
					});
				}
			} catch (error) {
				if (!stopped) problem = error;
			}
		})();
		return () => (stopped = true);
	});

	const current = $derived(
		plan ? nextStep(plan.steps, plan.parts.length, records, fromPart) : undefined
	);
	const part = $derived(plan && current ? plan.parts[current.part] : undefined);

	async function record(partIndex: number, step: HardcoreStep, at: 'start' | 'end') {
		if (
			at === 'end' &&
			records.some((r) => r.part === partIndex && r.step === step && r.at === 'end')
		)
			return;
		const { repository } = await session();
		await repository.recordEncounters(sessionId, [
			{
				kind: 'hardcore-step',
				at: new Date().toISOString(),
				detail: { part: partIndex, step, at }
			}
		]);
		records = [...records, { part: partIndex, step, at }];
	}

	/** Each step's start is recorded once, when the reader comes to it. */
	const begun = new SvelteSet<string>();
	$effect(() => {
		if (!current || current.step === 'watch-first' || current.step === 'watch-after') return;
		const key = `${current.part} ${current.step}`;
		if (begun.has(key)) return;
		begun.add(key);
		void record(current.part, current.step, 'start').catch((error) => (problem = error));
	});

	async function finishStep() {
		if (!current || busy) return;
		busy = true;
		try {
			await record(current.part, current.step, 'end');
		} catch (error) {
			problem = error;
		} finally {
			busy = false;
		}
	}

	function partLabel(lines: [number, number]): string {
		const cues = media?.cues;
		if (cues?.[lines[0]] && cues[lines[1]])
			return `${clock(cues[lines[0]].start)}–${clock(cues[lines[1]].end)}`;
		return `lines ${lines[0] + 1}–${lines[1] + 1}`;
	}

	const lineText = (line: number) => characters.slice(...lineRanges[line]).join('');

	// --- Watching (FR-011): the player plays the part and comes back here. ---

	function watchHref(step: HardcoreStep, english = false): string {
		if (!document || !part || !current) return '';
		const back = `${resolve('/hardcore/[session]', { session: String(sessionId) })}?ended=${current.part}.${step}`;
		const [first, last] = part.lines;
		const params: [string, string | number][] = [
			['back', back],
			['step', `${sessionId}.${current.part}.${step}`],
			...((media
				? [
						['t', media.cues[first]?.start ?? 0],
						['until', media.cues[last]?.end ?? media.cues.at(-1)?.end ?? 0],
						...(english ? [['english', 'shown']] : [])
					]
				: [
						['from', first],
						['to', last]
					]) as [string, string | number][])
		];
		const query = params
			.map(([name, value]) => `${name}=${encodeURIComponent(String(value))}`)
			.join('&');
		return `${resolve('/read/[id]', { id: String(document.id) })}?${query}`;
	}

	async function watch(step: HardcoreStep, english = false) {
		if (!current) return;
		const href = watchHref(step, english);
		busy = true;
		try {
			await record(current.part, step, 'start');
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- resolved in watchHref
			await goto(href);
		} catch (error) {
			problem = error;
		} finally {
			busy = false;
		}
	}

	// --- English preview (FR-012): the video's own English, the quick translator for the rest. ---

	let english = $state<(string | undefined)[]>([]);
	let quickStatus = $state<QuickStatus | undefined>();
	$effect(() => {
		if (current?.step !== 'preview' || !part) return;
		const lines = Array.from(
			{ length: part.lines[1] - part.lines[0] + 1 },
			(_, i) => part.lines[0] + i
		);
		const own = media
			? englishFor(
					media.cues.length,
					llmByLine(media.cues, media.translation),
					media.quick,
					humanLines(media)
				)
			: [];
		const found = lines.map((line) => own[line]?.text);
		english = found;
		// A video never opened in the player has no English yet, and a text never has any. Decided
		// from `found`: reading `english` here would make this effect re-run on every line it gets,
		// stopping the translator each time.
		if (found.every((line) => line !== undefined)) return;
		const texts = lines.map(lineText);
		const quick = quickTranslation(
			() => texts,
			(i) => english[i] !== undefined,
			(i, found) => {
				english[i] = found;
			},
			(status) => (quickStatus = status)
		);
		quick.more();
		return () => quick.stop();
	});

	// --- The drill (FR-008–FR-010). ---

	let queue = $state<number[]>([]);
	let drilling = $state<string | null>(null);
	/** While a part's words are being checked against memory. */
	let checking = $state(false);
	/** Counts showings, so a card shown again is mounted afresh, on its front. */
	let showing = $state(0);
	let retiredLast = $state<{ lexemeId: number; word: string; previous?: string } | null>(null);

	$effect(() => {
		if (current?.step !== 'drill' || !part) return;
		const key = `${current.part}`;
		if (drilling === key) return;
		drilling = key;
		// A copy: the plan is a deep proxy, which cannot be posted to the storage worker.
		const words = [...part.words];
		checking = true;
		void (async () => {
			const { repository } = await session();
			const { memory, parameters } = await repository.getMemory(words);
			if (drilling !== key) return;
			// Memory decides now, as it did for the plan (FR-010): a word passed since then is not due.
			const now = new Date();
			queue = words.filter(
				(w) => classify(undefined, memory.get(w)?.reading, now, parameters).class !== 'excluded'
			);
			showing++;
		})()
			.catch((error) => (problem = error))
			.finally(() => {
				if (drilling === key) checking = false;
			});
	});

	const occurrences = $derived(
		part && document ? firstOccurrences(document.tokens, lineRanges, part.lines) : undefined
	);
	const card = $derived.by(() => {
		const lexemeId = queue[0];
		const found = lexemeId === undefined ? undefined : occurrences?.get(lexemeId);
		if (!found || !document) return undefined;
		const { token, line } = found;
		const range = lineRanges[line];
		return {
			lexemeId,
			word: characters.slice(token.start, token.end).join(''),
			token,
			range,
			sentence: drillSentence(document, characters, range, line, token)
		};
	});

	async function grade(value: 1 | 2 | 3 | 4, _shown: unknown, help: CardHelp) {
		if (!card || !current || !document || busy) return;
		busy = true;
		try {
			const { repository } = await session();
			await repository.recordEncounters(sessionId, [
				{
					kind: 'review',
					at: new Date().toISOString(),
					lexemeId: card.lexemeId,
					documentId: document.id,
					fromOffset: card.token.start,
					toOffset: card.token.end,
					detail: {
						skill: 'reading',
						grade: value,
						hardcore: { part: current.part },
						line: card.range,
						...help
					}
				}
			]);
			retiredLast = null;
			queue = afterGrade(queue, value);
			showing++;
			if (queue.length === 0) await record(current.part, 'drill', 'end');
		} catch (error) {
			problem = error;
		} finally {
			busy = false;
		}
	}

	async function retire() {
		if (!card || !current || busy) return;
		busy = true;
		try {
			const { repository } = await session();
			const { lexemeId, word } = card;
			const previous = (await repository.getStates([lexemeId])).get(lexemeId)?.state;
			await repository.assertState(lexemeId, 'retired');
			retiredLast = { lexemeId, word, previous };
			queue = queue.filter((w) => w !== lexemeId);
			showing++;
			if (queue.length === 0) await record(current.part, 'drill', 'end');
		} catch (error) {
			problem = error;
		} finally {
			busy = false;
		}
	}

	async function unretire() {
		if (!retiredLast || busy) return;
		busy = true;
		try {
			const { repository } = await session();
			await repository.assertState(retiredLast.lexemeId, retiredLast.previous ?? RETRACTED);
			queue = [retiredLast.lexemeId, ...queue];
			retiredLast = null;
			showing++;
		} catch (error) {
			problem = error;
		} finally {
			busy = false;
		}
	}
</script>

{#if document}
	<a class="back" href={resolve('/document/[id]', { id: String(document.id) })}
		>← {document.title}</a
	>
{/if}

{#if problem}
	<ErrorNotice error={problem} />
{:else if !plan || !document}
	<p class="loading">Opening the session…</p>
{:else}
	{#if plan.parts.length > 1}
		<details class="parts">
			<summary>
				Part {(current?.part ?? plan.parts.length - 1) + 1} of {plan.parts.length}
			</summary>
			<ol>
				{#each plan.parts as each, i (i)}
					<li>
						<button class="link" onclick={() => (fromPart = i)}>
							{partLabel(each.lines)} · {each.words.length} words
						</button>
					</li>
				{/each}
			</ol>
		</details>
	{/if}

	{#if !current || !part}
		<div class="done">
			<h2>Session done.</h2>
			<a href={resolve('/document/[id]/hardcore', { id: String(document.id) })}>Another session →</a
			>
		</div>
	{:else}
		<p class="subtitle" role="status">
			{STEP_LABELS[current.step]} · {partLabel(part.lines)}
		</p>

		{#if current.step === 'preview'}
			{#if quickStatus}<p class="note" role="status">{quickStatus.label}</p>{/if}
			<ol class="preview">
				{#each english as line, i (i)}
					<li>
						<p class="chinese" lang="zh-Hans">{lineText(part.lines[0] + i)}</p>
						<p class="english" lang="en">{line ?? 'translating…'}</p>
					</li>
				{/each}
			</ol>
			{#if media}
				<button class="secondary" onclick={() => watch('preview', true)} disabled={busy}
					>Play it with English</button
				>
			{/if}
			<button class="primary" onclick={finishStep} disabled={busy}>Done</button>
		{:else if current.step === 'watch-first' || current.step === 'watch-after'}
			<p>{media ? 'Watch' : 'Read'} the part, then come back here.</p>
			<button class="primary" onclick={() => watch(current!.step)} disabled={busy}
				>{media ? 'Watch' : 'Read'} {partLabel(part.lines)}</button
			>
			<button class="secondary" onclick={finishStep} disabled={busy}>Skip</button>
		{:else if checking}
			<p class="loading">Finding the words…</p>
		{:else if card}
			<p class="counts">{queue.length} to go</p>
			<div class="drill">
				{#key showing}
					<CardFace
						lexemeId={card.lexemeId}
						word={card.word}
						sentence={card.sentence}
						{busy}
						ongrade={grade}
						onretire={retire}
					>
						{#snippet notice()}
							{#if retiredLast}<p class="note" role="status">
									<span lang="zh-Hans">{retiredLast.word}</span> retired.
									<button class="link" onclick={unretire} disabled={busy}>Undo</button>
								</p>{/if}
						{/snippet}
					</CardFace>
				{/key}
			</div>
		{:else}
			<p>No words left to drill in this part.</p>
			<button class="primary" onclick={finishStep} disabled={busy}>Continue</button>
		{/if}
	{/if}
{/if}

<style>
	.drill {
		/* No tab bar on this page: the card's buttons sit at the bottom. */
		--card-actions-bottom: 0rem;
	}
	.parts summary {
		min-height: 44px;
		display: flex;
		align-items: center;
	}
	.parts ol {
		padding-left: 1.4rem;
		margin: 0 0 0.5rem;
	}
	.preview {
		padding-left: 1.4rem;
	}
	.preview li + li {
		margin-top: 0.6rem;
	}
	.chinese {
		font-size: 1.25rem;
		margin: 0;
	}
	.english {
		margin: 0.15rem 0 0;
		color: var(--muted);
	}
	.primary,
	.secondary {
		display: block;
		width: 100%;
		min-height: 48px;
		border-radius: 12px;
		margin-top: 0.75rem;
		font-weight: 600;
	}
	.primary {
		background: var(--accent);
		color: var(--on-accent);
		border: none;
	}
	.secondary {
		background: transparent;
		color: var(--accent);
		border: 1px solid var(--rule);
	}
	.counts {
		margin: 0 0 0.25rem;
		color: var(--muted);
	}
	.note {
		font-size: 0.78rem;
		color: var(--muted);
	}
	.link {
		background: none;
		border: none;
		padding: 0 0.25rem;
		min-height: 0;
		color: var(--accent);
		text-decoration: underline;
		font-size: inherit;
		text-align: left;
	}
	.done {
		padding: 1.5rem 0;
	}
</style>
