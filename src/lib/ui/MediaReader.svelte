<script lang="ts" module>
	export interface LineWord {
		key: number;
		text: string;
		isWord: boolean;
		/** A class for the word's marking, e.g. `state-known`. */
		mark?: string;
	}
</script>

<script lang="ts">
	import type { Cue } from '$lib/media/subtitles';
	import type { English } from '$lib/translation/lines';
	import type { Snippet } from 'svelte';

	/**
	 * A player with its subtitle lines underneath: the current line follows playback, ▸ seeks to a
	 * line, and tapping a word pauses. Shared by a stored media document and one still being
	 * transcribed, which differ only in where the lines come from.
	 */
	let {
		file,
		cues,
		lines,
		language = 'zh',
		startAt = 0,
		translations = [],
		askable = false,
		onask,
		online,
		status,
		onword,
		player = $bindable(null)
	}: {
		file: File;
		cues: Cue[];
		lines: LineWord[][];
		language?: string;
		startAt?: number;
		/** English for line i, from whichever translator has it best (ADR-0023); revealed per line. */
		translations?: (English | undefined)[];
		/** Whether English can still be asked for, so every line offers it. */
		askable?: boolean;
		/** The reader wants line i's English and it is not there yet. */
		onask?: (line: number) => void;
		/** Playback moved to line i. */
		online?: (line: number) => void;
		/** What the page is waiting on (progress bars), shown on the stage as well as above the list. */
		status?: Snippet;
		onword: (line: number, word: LineWord) => void;
		player?: HTMLMediaElement | null;
	} = $props();

	let url = $state<string | null>(null);
	let currentLine = $state(-1);
	let revealed = $state<number[]>([]);
	let showAll = $state(false);

	function reveal(line: number) {
		if (!translations[line]) onask?.(line);
		revealed = revealed.includes(line) ? revealed.filter((i) => i !== line) : [...revealed, line];
	}
	/** How much English there is: every line with some, and those the LLM has improved. */
	const english = $derived({
		have: translations.filter(Boolean).length,
		improved: translations.filter((line) => line?.source === 'llm').length
	});
	const isAudio = $derived(/\.(m4a|mp3|ogg|opus|wav)$/i.test(file.name));

	$effect(() => {
		const made = URL.createObjectURL(file);
		url = made;
		return () => URL.revokeObjectURL(made);
	});

	function started() {
		if (player && startAt > 0) player.currentTime = startAt;
	}

	/** The last line that started: a gap keeps the line before it, and nothing precedes line 0. */
	function follow() {
		if (!player) return;
		const time = player.currentTime;
		let at = -1;
		for (let i = 0; i < cues.length && cues[i].start <= time; i++) at = i;
		if (at === currentLine) return;
		currentLine = at;
		if (at >= 0) online?.(at);
		if (!stage)
			document
				.getElementById(`line-${at}`)
				?.scrollIntoView({ block: 'center', behavior: 'smooth' });
	}

	function seek(line: number) {
		if (!player || !cues[line]) return;
		player.currentTime = cues[line].start;
		void player.play();
	}

	/**
	 * Language Reactor's layout: the video fills the screen, with the current line on it, Chinese
	 * above English blurred. The list is one tap away. Remembered on this device only.
	 */
	let stage = $state(readPreference('reader.stage', true));
	let blurEnglish = $state(readPreference('reader.blurEnglish', true));
	/** The line whose English the reader unblurred; the next line starts blurred again. */
	let unblurred = $state(-1);

	function readPreference(key: string, fallback: boolean): boolean {
		try {
			const kept = localStorage.getItem(key);
			return kept === null ? fallback : kept === 'true';
		} catch {
			return fallback;
		}
	}

	function keep(key: string, value: boolean) {
		try {
			localStorage.setItem(key, String(value));
		} catch {
			// Private mode or blocked storage: the choice just lasts for this visit.
		}
	}

	function setStage(on: boolean) {
		stage = on;
		keep('reader.stage', on);
		if (!on && document.fullscreenElement) void document.exitFullscreen();
	}

	function toggleBlur() {
		blurEnglish = !blurEnglish;
		keep('reader.blurEnglish', blurEnglish);
	}

	/** The whole app, not the video element: the word sheet has to show on top of it. */
	async function toggleFullscreen() {
		try {
			if (document.fullscreenElement) await document.exitFullscreen();
			else {
				await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
				await (screen.orientation as { lock?: (o: string) => Promise<void> }).lock?.('landscape');
			}
		} catch {
			// Refused or unsupported (a phone kept upright, an iPhone): the stage still fills the app.
		}
	}

	function showEnglish() {
		if (currentLine < 0) return;
		if (!translations[currentLine]) onask?.(currentLine);
		unblurred = unblurred === currentLine ? -1 : currentLine;
	}

	/** ◀ goes to the start of this line when more than a second in, as Language Reactor does. */
	function previous() {
		if (!player || currentLine < 0) return;
		const into = player.currentTime - cues[currentLine].start;
		seek(into > 1 || currentLine === 0 ? currentLine : currentLine - 1);
	}

	function tap(line: number, word: LineWord) {
		player?.pause();
		onword(line, word);
	}
</script>

{#if url}
	{#if isAudio}
		<audio
			class="player"
			controls
			src={url}
			bind:this={player}
			ontimeupdate={follow}
			onloadedmetadata={started}
		></audio>
	{:else}
		<div class="media" class:stage>
			{#if stage && status}<div class="stage-status">{@render status()}</div>{/if}
			<!-- svelte-ignore a11y_media_has_caption -->
			<video
				class="player"
				controls
				playsinline
				src={url}
				bind:this={player}
				ontimeupdate={follow}
				onloadedmetadata={started}
			></video>
			{#if stage}
				<div class="bar">
					<button onclick={() => setStage(false)}>☰ Lines</button>
					<button onclick={toggleBlur} aria-pressed={!blurEnglish}
						>{blurEnglish ? 'English blurred' : 'English shown'}</button
					>
					<button onclick={toggleFullscreen} aria-label="Full screen">⛶</button>
				</div>
				{#if currentLine >= 0 && lines[currentLine]}
					<div class="subtitles">
						<p class="chinese" lang={language}>
							{#each lines[currentLine] as word (word.key)}{#if word.isWord}<button
										class="token {word.mark ?? 'state-none'}"
										onclick={() => tap(currentLine, word)}>{word.text}</button
									>{:else}<span class="token">{word.text}</span>{/if}{/each}
						</p>
						<button
							class="english-line"
							class:blurred={blurEnglish && unblurred !== currentLine}
							class:quick={translations[currentLine]?.source === 'quick'}
							lang="en"
							onclick={showEnglish}
							>{translations[currentLine]?.text ??
								(askable ? 'translating…' : 'No English yet')}</button
						>
						<div class="steps">
							<button onclick={previous} aria-label="Previous line">◀</button>
							<button onclick={() => seek(currentLine)} aria-label="Replay this line">↻</button>
							<button onclick={() => seek(currentLine + 1)} aria-label="Next line">▶</button>
						</div>
					</div>
				{/if}
			{/if}
		</div>
		{#if !stage}
			<button class="to-stage" onclick={() => setStage(true)}>▶ Full screen with subtitles</button>
			{#if status}{@render status()}{/if}
		{/if}
	{/if}
{/if}

{#if askable || translations.some(Boolean)}
	<label class="all-english" class:hidden={stage && !isAudio}>
		<input type="checkbox" bind:checked={showAll} /> Show all English
		<small>
			· {english.have} of {lines.length} lines{english.improved > 0
				? `, ${english.improved} improved`
				: ''}
		</small>
	</label>
{/if}

<!-- No whitespace between words: this is Chinese, and the browser renders any gap the markup has. -->
<div class="reading lines" class:hidden={stage && !isAudio} lang={language}>
	{#each lines as line, i (i)}
		<p id="line-{i}" class:current={i === currentLine}>
			{#if cues[i]}<button class="seek" aria-label="Play from here" onclick={() => seek(i)}
					>▸</button
				>{/if}{#each line as word (word.key)}{#if word.isWord}<button
						class="token {word.mark ?? 'state-none'}"
						onclick={() => tap(i, word)}>{word.text}</button
					>{:else}<span class="token">{word.text}</span
					>{/if}{/each}{#if translations[i] || (askable && cues[i])}<button
					class="reveal"
					aria-label="Show the English"
					aria-pressed={showAll || revealed.includes(i)}
					onclick={() => reveal(i)}>EN</button
				>{/if}{#if showAll || revealed.includes(i)}{#if translations[i]}<span
						class="english"
						class:quick={translations[i]?.source === 'quick'}
						title={translations[i]?.source === 'quick' ? 'Quick translation' : undefined}
						lang="en">{translations[i]?.text}</span
					>{:else if askable && cues[i]}<span class="english pending">translating…</span>{/if}{/if}
		</p>
	{/each}
</div>

<style>
	.hidden {
		display: none;
	}
	.media.stage {
		position: fixed;
		inset: 0;
		z-index: 5;
		background: #000;
		display: flex;
		flex-direction: column;
		justify-content: center;
	}
	.media.stage .player {
		position: static;
		width: 100%;
		height: 100%;
		max-height: none;
		object-fit: contain;
	}
	.bar {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		display: flex;
		gap: 0.5rem;
		padding: 0.5rem;
		justify-content: space-between;
	}
	.bar button,
	.steps button {
		background: rgb(0 0 0 / 55%);
		color: #fff;
		border: 1px solid rgb(255 255 255 / 30%);
		border-radius: 999px;
		padding: 0.3rem 0.8rem;
		min-height: 0;
	}
	.stage-status {
		position: absolute;
		top: 3rem;
		left: 0.75rem;
		right: 0.75rem;
		color: #fff;
		background: rgb(0 0 0 / 55%);
		border-radius: 8px;
		padding: 0.2rem 0.6rem;
	}
	.stage-status :global(.progress-bar) {
		color: #fff;
	}
	/* Above the video's own controls, which sit along the bottom edge. */
	.subtitles {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 4.5rem;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.3rem;
		padding: 0 0.75rem;
		text-align: center;
		pointer-events: none;
	}
	.subtitles > * {
		pointer-events: auto;
	}
	.chinese {
		margin: 0;
		font-size: 1.5rem;
		line-height: 1.5;
		color: #fff;
		background: rgb(0 0 0 / 60%);
		border-radius: 8px;
		padding: 0.1rem 0.5rem;
	}
	/* Subtitle words sit together as a sentence, not spaced like the list's tap targets. */
	.chinese .token {
		color: #fff;
		padding: 0;
		margin: 0;
		min-width: 0;
		min-height: 0;
	}
	.english-line {
		font-size: 1rem;
		color: #fff;
		background: rgb(0 0 0 / 60%);
		border: none;
		border-radius: 8px;
		padding: 0.2rem 0.6rem;
		min-height: 0;
		transition: filter 0.15s;
	}
	.english-line.blurred {
		filter: blur(5px);
	}
	/*
	 * Held upright, a video is a strip across the middle, and subtitles on it would sit far from
	 * nothing. So portrait stacks: status, the video at the top, the current line right under it.
	 */
	@media (orientation: portrait) {
		.media.stage {
			justify-content: flex-start;
			padding-top: 3.25rem;
			overflow-y: auto;
		}
		.media.stage .player {
			height: auto;
			max-height: 45vh;
			flex: none;
		}
		.stage-status {
			position: static;
			margin: 0 0.75rem 0.5rem;
		}
		.subtitles {
			position: static;
			margin-top: 1rem;
		}
	}
	.english-line.quick {
		font-style: italic;
	}
	.steps {
		display: flex;
		gap: 1.5rem;
	}
	.to-stage {
		display: block;
		margin: 0.4rem 0;
		font-size: 0.85rem;
	}
	.player {
		position: sticky;
		top: 0;
		z-index: 1;
		width: 100%;
		max-height: 35vh;
		background: #000;
	}
	audio.player {
		background: var(--bg, #fff);
	}
	.lines {
		line-height: 1.7;
	}
	.lines p {
		margin: 0 0 0.4rem;
		padding: 0.1rem 0.25rem;
		border-radius: 6px;
	}
	.lines p.current {
		background: color-mix(in srgb, currentColor 8%, transparent);
	}
	.reveal {
		font-size: 0.65rem;
		vertical-align: middle;
		margin-left: 0.4rem;
		padding: 0 0.3rem;
		min-height: 0;
		min-width: 0;
		opacity: 0.5;
	}
	.english {
		display: block;
		font-size: 0.95rem;
		line-height: 1.4;
		color: var(--muted);
		margin: 0.1rem 0 0.2rem;
	}
	.english.quick {
		font-style: italic;
	}
	.english.pending {
		opacity: 0.6;
	}
	.all-english {
		display: block;
		font-size: 0.85rem;
		margin: 0.4rem 0;
	}
	.seek {
		font-size: 0.8rem;
		vertical-align: middle;
		margin-right: 0.3rem;
		padding: 0 0.3rem;
		min-height: 0;
		min-width: 0;
		opacity: 0.6;
	}
</style>
