<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { fallbackAnalyzer } from '$lib/analyzer/active';
	import { codePointsOf } from '$lib/domain/offsets';
	import type { Cue } from '$lib/media/subtitles';
	import { isPlayable, loadPending } from '$lib/media/store';
	import { titleIn } from '$lib/media/import';
	import MediaReader, { type LineWord } from '$lib/ui/MediaReader.svelte';
	import StateMenu from '$lib/ui/StateMenu.svelte';
	import Progress from '$lib/ui/Progress.svelte';
	import SpeechModel from '$lib/ui/SpeechModel.svelte';
	import { speechSetup, transcriber, type SetupState } from '$lib/speech/app';
	import { lines as cut } from '$lib/speech/lines';
	import type { JobState } from '$lib/speech/transcriber';
	import type { Token } from '$lib/speech/windows';
	import { englishFor } from '$lib/translation/lines';
	import {
		quickTranslation,
		type QuickStatus,
		type QuickTranslation
	} from '$lib/translation/quick';

	/**
	 * A video Reader is still transcribing (spec 008). Lines arrive from the app-wide transcriber a
	 * window at a time and are segmented here with the fast analyzer, so words can be looked up at
	 * once. Nothing is stored in the database until the transcript is complete; then the transcriber
	 * makes it an ordinary document and this page moves to it at the same point in playback.
	 */
	const job = page.params.job!;

	let files = $state<File[]>([]);
	let title = $state('');
	let cues = $state<Cue[]>([]);
	let lines = $state<LineWord[][]>([]);
	let problem = $state<string | null>(null);
	let chosen = $state<{ line: number; word: LineWord } | null>(null);
	let player = $state<HTMLMediaElement | null>(null);
	let jobState = $state<JobState | undefined>();
	let setup = $state<SetupState>(speechSetup.state);

	const media = $derived(files.find((file) => isPlayable(file.name)));

	/** Quick English as lines arrive (ADR-0023); the LLM's follows on the read page, once a document. */
	let quickLines = $state<(string | null)[]>([]);
	let quick = $state<QuickTranslation | undefined>();
	let quickStatus = $state<QuickStatus | undefined>();
	const transcribed = $derived(jobState?.kind === 'finishing' || jobState?.kind === 'done');
	const english = $derived(englishFor(cues.length, [], quickLines));

	$effect(() => {
		if (!media) return;
		// Untracked, as on the reader page: starting it must not make this effect depend on the lines.
		const translator = untrack(() =>
			quickTranslation(
				() => cues.map((cue) => cue.text),
				(i) => Boolean(quickLines[i]),
				(i, text) => {
					const next = [...quickLines];
					next[i] = text;
					quickLines = next;
				},
				(status) => (quickStatus = status),
				() => transcribed
			)
		);
		quick = translator;
		return () => {
			translator.stop();
			quick = undefined;
		};
	});

	async function segment(text: string): Promise<LineWord[]> {
		const characters = codePointsOf(text);
		return (await fallbackAnalyzer.analyze(text)).map((token) => ({
			key: token.start,
			text: characters.slice(token.start, token.end).join(''),
			isWord: token.isWord
		}));
	}

	/**
	 * New tokens: lines are cut again, and only lines whose text changed are segmented. Earlier lines
	 * stay as they were; the last can still grow while its speech continues into the next window.
	 */
	let shown = 0;
	async function show(tokens: Token[]) {
		const call = ++shown;
		const fresh = cut(tokens).filter((line) => line.text);
		const words = await Promise.all(
			fresh.map((line, i) => (cues[i]?.text === line.text ? lines[i] : segment(line.text)))
		);
		if (call !== shown) return;
		const changed = fresh.some((line, i) => cues[i]?.text !== line.text);
		quickLines = quickLines.map((english, i) =>
			cues[i]?.text === fresh[i]?.text ? english : null
		);
		cues = fresh.map((line) => ({ start: line.from, end: line.to, text: line.text }));
		lines = words;
		if (changed) quick?.more();
	}

	$effect(() => {
		let unsubscribe = () => {};
		const stopSetup = speechSetup.subscribe((state) => (setup = state));
		void (async () => {
			try {
				files = await loadPending(job);
				const meta = files.find((file) => file.name === 'meta.json');
				title = meta ? titleIn(await meta.text(), 'Video') : 'Video';
				unsubscribe = transcriber.subscribe((which, state, tokens) => {
					if (which !== job) return;
					jobState = state;
					void show([...tokens]);
					if (state.kind === 'done') void moveTo(state.documentId);
				});
				transcriber.prefer(job);
			} catch (error) {
				problem = error instanceof Error ? error.message : String(error);
			}
		})();
		return () => {
			unsubscribe();
			stopSetup();
		};
	});

	let moving = false;
	async function moveTo(documentId: number) {
		if (moving) return;
		moving = true;
		const at = Math.floor(player?.currentTime ?? 0);
		// resolve() is used; the rule cannot see through the query string appended to it.
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		await goto(`${resolve('/read/[id]', { id: String(documentId) })}?t=${at}`, {
			replaceState: true
		});
	}

	const clock = (seconds: number) =>
		`${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

	function sentenceOf(line: number): string {
		return cues[line]?.text ?? '';
	}
</script>

<a class="back" href={resolve('/')}>← Videos</a>

{#if problem}
	<p role="alert">{problem}</p>
{:else if media}
	<h1 class="compact">{title}</h1>
	<MediaReader
		file={media}
		{cues}
		{lines}
		translations={english}
		askable={quick !== undefined}
		onask={(line) => quick?.focus(line, true)}
		online={(line) => quick?.focus(line)}
		bind:player
		onword={(line, word) => (chosen = { line, word })}
	>
		{#snippet status()}
			<div class="progress">
				{#if setup.kind === 'missing' || setup.kind === 'paused' || setup.kind === 'downloading' || setup.kind === 'calibrating' || setup.kind === 'failed'}
					<SpeechModel />
				{:else if !jobState || jobState.kind === 'waiting-for-model'}
					<Progress label="Getting speech-to-text ready…" />
				{:else if jobState.kind === 'queued'}
					<Progress label="Waiting: another video is being transcribed first." />
				{:else if jobState.kind === 'loading'}
					<Progress label="Loading the speech model…" />
				{:else if jobState.kind === 'transcribing'}
					<Progress
						label={cues.length
							? `Transcribing: ${clock(jobState.through)} of ${clock(jobState.total)}`
							: 'Listening to the first seconds…'}
						fraction={jobState.total ? jobState.through / jobState.total : undefined}
					/>
				{:else if jobState.kind === 'finishing'}
					<Progress label="Saving the transcript…" />
				{:else if jobState.kind === 'failed'}
					<Progress label={`Transcribing stopped: ${jobState.reason}`} />
				{/if}
				{#if quickStatus}<Progress {...quickStatus} />{/if}
			</div>
		{/snippet}
	</MediaReader>
	{#if chosen}
		<StateMenu
			word={chosen.word.text}
			sentence={sentenceOf(chosen.line)}
			marking={false}
			current={null}
			onchoose={() => {}}
			onclose={() => (chosen = null)}
		/>
	{/if}
{:else}
	<p class="loading">Opening…</p>
{/if}

<style>
	h1.compact {
		font-size: 1rem;
		margin: 0.25rem 0;
	}
	.progress {
		color: var(--muted);
		font-size: 0.85rem;
		margin: 0.25rem 0;
	}
</style>
