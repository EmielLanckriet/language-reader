<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { fallbackAnalyzer } from '$lib/analyzer/active';
	import { codePointsOf } from '$lib/domain/offsets';
	import { parseSubtitles, type Cue } from '$lib/media/subtitles';
	import { isPlayable, loadPending, removePending, QUICK_ENGLISH } from '$lib/media/store';
	import { createMediaDocument, titleIn } from '$lib/media/import';
	import MediaReader, { type LineWord } from '$lib/ui/MediaReader.svelte';
	import StateMenu from '$lib/ui/StateMenu.svelte';
	import Progress from '$lib/ui/Progress.svelte';
	import { followTranslation } from '$lib/media/translation';
	import { englishFor, llmByLine } from '$lib/translation/lines';
	import {
		quickTranslation,
		type QuickStatus,
		type QuickTranslation
	} from '$lib/translation/quick';

	/**
	 * A video whose transcript Termux is still producing (ADR-0019). Lines are fetched from Termux
	 * as they arrive and segmented here with the fast analyzer, so words can be looked up at once.
	 * Nothing is stored until the transcript is complete; then it becomes an ordinary document.
	 */
	const job = page.params.job!;
	const POLL_MS = 2000;

	let files = $state<File[]>([]);
	let title = $state('');
	let cues = $state<Cue[]>([]);
	let lines = $state<LineWord[][]>([]);
	let through = $state(0);
	/** The video's length, and the chunk whisper is on: when it started and how long it usually takes. */
	let total = $state<number | null>(null);
	let chunk = $state<{ started: number; expected: number } | null>(null);
	/** Ticks while waiting for the first lines, so the estimated bar moves. */
	let now = $state(Date.now() / 1000);
	let problem = $state<string | null>(null);
	let reachable = $state(true);
	let chosen = $state<{ line: number; word: LineWord } | null>(null);
	let player = $state<HTMLMediaElement | null>(null);
	let finishing = false;
	let translations = $state<Cue[]>([]);
	let translated = $state<{ done: boolean; vtt: string } | null>(null);

	const media = $derived(files.find((file) => isPlayable(file.name)));

	/** Quick English as lines arrive (ADR-0023), carried into the document when the transcript ends. */
	let quickLines = $state<(string | null)[]>([]);
	let quick = $state<QuickTranslation | undefined>();
	let quickStatus = $state<QuickStatus | undefined>();
	let transcribed = false;
	const llmLines = $derived(llmByLine(cues, translations));
	const english = $derived(englishFor(cues.length, llmLines, quickLines));

	$effect(() => {
		if (!media) return;
		// Untracked, as on the reader page: starting it must not make this effect depend on the lines.
		const translator = untrack(() =>
			quickTranslation(
				() => cues.map((cue) => cue.text),
				(i) => Boolean(llmLines[i]?.trim() || quickLines[i]),
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

	async function poll(where: { status: string; vtt: string }) {
		try {
			const status = await (await fetch(where.status, { cache: 'no-store' })).json();
			const vtt = await (await fetch(where.vtt, { cache: 'no-store' })).text();
			reachable = true;
			const fresh = parseSubtitles(vtt);
			// Earlier lines never change, so only the new ones are segmented.
			const added = await Promise.all(fresh.slice(lines.length).map((cue) => segment(cue.text)));
			cues = fresh;
			lines = [...lines, ...added];
			through = status.through;
			total = status.total ?? null;
			chunk = status.chunk ?? null;
			transcribed = Boolean(status.done);
			if (added.length > 0 || transcribed) quick?.more();
			if (status.done) await finish(vtt);
		} catch {
			reachable = false;
		}
	}

	async function finish(vtt: string) {
		if (finishing) return;
		finishing = true;
		const kept = files.filter((file) => file.name !== 'transcribing.json');
		const id = await createMediaDocument(title, vtt, [
			...kept.map((file) => ({ name: file.name, blob: file })),
			{ name: 'media.zh.vtt', blob: new Blob([vtt], { type: 'text/vtt' }) },
			// A finished translation goes with it; an unfinished one is followed on by the reader page.
			...(translated?.done ? [{ name: 'media.en.vtt', blob: new Blob([translated.vtt]) }] : []),
			// Quick lines so far; the reader page translates whatever is still missing.
			{ name: QUICK_ENGLISH, blob: new Blob([JSON.stringify(quickLines)]) }
		]);
		await removePending(job);
		const at = Math.floor(player?.currentTime ?? 0);
		// resolve() is used; the rule cannot see through the query string appended to it.
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		await goto(`${resolve('/read/[id]', { id: String(id) })}?t=${at}`, { replaceState: true });
	}

	$effect(() => {
		let timer: ReturnType<typeof setInterval> | undefined;
		let stopTranslation = () => {};
		void (async () => {
			try {
				files = await loadPending(job);
				const meta = files.find((file) => file.name === 'meta.json');
				title = meta ? titleIn(await meta.text(), 'Video') : 'Video';
				const where = JSON.parse(
					await files.find((file) => file.name === 'transcribing.json')!.text()
				);
				await poll(where);
				timer = setInterval(() => void poll(where), POLL_MS);
				const termuxJob = /\/downloads\/([^/]+)\//.exec(where.vtt)?.[1];
				if (termuxJob) {
					stopTranslation = followTranslation(
						decodeURIComponent(termuxJob),
						(english, done, text) => {
							translations = english;
							translated = { done, vtt: text };
						}
					);
				}
			} catch (error) {
				problem = error instanceof Error ? error.message : String(error);
			}
		})();
		return () => {
			clearInterval(timer);
			stopTranslation();
		};
	});

	$effect(() => {
		const timer = setInterval(() => (now = Date.now() / 1000), 500);
		return () => clearInterval(timer);
	});

	/** An estimate from this device's own timings, held short of full until the lines are there. */
	const firstLines = $derived(
		chunk ? Math.min(0.95, (now - chunk.started) / chunk.expected) : undefined
	);

	function sentenceOf(line: number): string {
		return cues[line]?.text ?? '';
	}
</script>

<a class="back" href={resolve('/')}>← Library</a>

{#if problem}
	<p role="alert">{problem}</p>
{:else if media}
	<h1 class="compact">{title}</h1>
	<div class="progress">
		{#if !reachable}
			<Progress label="Waiting for Termux… keep it open until the transcript is done." />
		{:else if cues.length === 0}
			<Progress label="Listening to the first 30 seconds…" fraction={firstLines} />
		{:else}
			<Progress
				label={`Transcribing: ${Math.round(through)}${total ? ` of ${Math.round(total)}` : ''} s`}
				fraction={total ? through / total : undefined}
			/>
		{/if}
		{#if quickStatus}<Progress {...quickStatus} />{/if}
	</div>
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
	/>
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
