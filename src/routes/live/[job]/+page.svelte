<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { fallbackAnalyzer } from '$lib/analyzer/active';
	import { codePointsOf } from '$lib/domain/offsets';
	import { parseSubtitles, type Cue } from '$lib/media/subtitles';
	import { isPlayable, loadPending, removePending } from '$lib/media/store';
	import { createMediaDocument, titleIn } from '$lib/media/import';
	import MediaReader, { type LineWord } from '$lib/ui/MediaReader.svelte';
	import StateMenu from '$lib/ui/StateMenu.svelte';
	import { followTranslation } from '$lib/media/translation';

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
	let problem = $state<string | null>(null);
	let reachable = $state(true);
	let chosen = $state<{ line: number; word: LineWord } | null>(null);
	let player = $state<HTMLMediaElement | null>(null);
	let finishing = false;
	let translations = $state<string[]>([]);
	let translated = $state<{ done: boolean; vtt: string } | null>(null);

	const media = $derived(files.find((file) => isPlayable(file.name)));

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
			...(translated?.done ? [{ name: 'media.en.vtt', blob: new Blob([translated.vtt]) }] : [])
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
						(lines, done, text) => {
							translations = lines;
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

	function sentenceOf(line: number): string {
		return cues[line]?.text ?? '';
	}
</script>

<a class="back" href={resolve('/')}>← Library</a>

{#if problem}
	<p role="alert">{problem}</p>
{:else if media}
	<h1 class="compact">{title}</h1>
	<p class="progress">
		{#if !reachable}
			Waiting for Termux… keep it open until the transcript is done.
		{:else}
			Transcribing: {Math.round(through)} s so far.
		{/if}
	</p>
	<MediaReader
		file={media}
		{cues}
		{lines}
		{translations}
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
