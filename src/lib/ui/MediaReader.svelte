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
		document.getElementById(`line-${at}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
	}

	function seek(line: number) {
		if (!player) return;
		player.currentTime = cues[line].start;
		void player.play();
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
	{/if}
{/if}

{#if askable || translations.some(Boolean)}
	<label class="all-english">
		<input type="checkbox" bind:checked={showAll} /> Show all English
	</label>
{/if}

<!-- No whitespace between words: this is Chinese, and the browser renders any gap the markup has. -->
<div class="reading lines" lang={language}>
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
					>{:else if askable && cues[i]}<span class="english pending">…</span>{/if}{/if}
		</p>
	{/each}
</div>

<style>
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
