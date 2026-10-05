<script lang="ts" module>
	export interface LineWord {
		key: number;
		text: string;
		isWord: boolean;
		/** A class for the word's marking, e.g. `state-known`. */
		mark?: string;
		/** Its characters with their pinyin, once known, shown above them. */
		chars?: { c: string; py: string }[];
	}
</script>

<script lang="ts">
	import { lineAt, type Cue } from '$lib/media/subtitles';
	import { landscapeWhileFullscreen } from '$lib/media/orientation';
	import type { English } from '$lib/translation/lines';
	import { untrack, type Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import type { Recorder } from './recorder';

	/**
	 * A player with its subtitle lines underneath: the current line follows playback, ▸ seeks to a
	 * line, and tapping a word pauses. Shared by a stored media document and one still being
	 * transcribed, which differ only in where the lines come from.
	 */
	let {
		file,
		cues,
		sourceCues,
		lines,
		language = 'zh',
		startAt = 0,
		translations = [],
		askable = false,
		onask,
		online,
		status,
		onword,
		joined = [],
		onjoin,
		onsplit,
		recorder,
		title,
		artist,
		soundFile,
		player = $bindable(null)
	}: {
		file: File;
		cues: Cue[];
		/**
		 * The document's own lines, when `cues` shows some of them as one (a clause the subtitles cut):
		 * what the recorder counts in, since the offsets it writes are theirs.
		 */
		sourceCues?: Cue[];
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
		/** Which lines are sentences the reader joined from several (media/sentences.ts). */
		joined?: boolean[];
		/** Join line i with the one after it, or take a joined line apart again. */
		onjoin?: (line: number) => void;
		onsplit?: (line: number) => void;
		/** Where what happens during playback is written down (spec 007). */
		recorder?: Recorder;
		/** What the lock screen and headphones' controls say is playing. */
		title?: string;
		artist?: string;
		/** The video's sound alone (media/audio-track.ts): what plays while the screen is locked. */
		soundFile?: File;
		player?: HTMLMediaElement | null;
	} = $props();

	let url = $state<string | null>(null);
	let currentLine = $state(-1);
	let revealed = $state<number[]>([]);
	let showAll = $state(false);

	function reveal(line: number) {
		if (!translations[line]) onask?.(line);
		revealed = revealed.includes(line) ? revealed.filter((i) => i !== line) : [...revealed, line];
		if (revealed.includes(line)) recorder?.translation(sourceOf(line), translations[line]?.source);
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

	let soundUrl = $state<string | null>(null);
	$effect(() => {
		if (!soundFile) return;
		const made = URL.createObjectURL(soundFile);
		soundUrl = made;
		return () => {
			URL.revokeObjectURL(made);
			soundUrl = null;
		};
	});

	function started() {
		if (!player) return;
		if (startAt > 0) player.currentTime = startAt;
		// Both: a new source resets playbackRate to defaultPlaybackRate.
		player.defaultPlaybackRate = player.playbackRate = speed;
	}

	/** The last line that started: a gap keeps the line before it, and nothing precedes line 0. */
	function follow() {
		const media = active();
		if (!media) return;
		const time = media.currentTime;
		if (!media.paused) recorder?.playing(sourceLineAt(time), moment());
		// The screen is locked: no animation frames, so watchLineEnd cannot stop at a line's end.
		if (away) checkLineEnd(media);
		const at = lineAt(cues, time);
		if (at === currentLine) return;
		currentLine = at;
		if (at >= 0) online?.(at);
		if (!stage)
			document
				.getElementById(`line-${at}`)
				?.scrollIntoView({ block: 'center', behavior: 'smooth' });
	}

	/** The document's own line playing at `time`, for the recorder. */
	function sourceLineAt(time: number): number {
		return lineAt(sourceCues ?? cues, time);
	}

	/** The document's first own line of shown line `line`, for the recorder. */
	function sourceOf(line: number): number {
		return line < 0 || !cues[line] ? line : sourceLineAt(cues[line].start);
	}

	/**
	 * Every line's text is on screen while the page is (the stage and the list alike); with the
	 * screen locked it is heard only, which is what makes it listening (research R5).
	 */
	function moment() {
		const media = active();
		return {
			mediaMs: Math.round((media?.currentTime ?? 0) * 1000),
			speed: media?.playbackRate ?? speed,
			textVisible: !away && document.visibilityState === 'visible'
		};
	}

	// --- Listening with the screen locked (asked for 2026-09-27: audio on the bike) ---

	/**
	 * Chrome pauses a hidden video within seconds (measured on the phone: ~14 s after locking), and
	 * will neither start nor keep playing anything with a video track while hidden, but an
	 * audio-only file plays on. So while the page is hidden the video's sound alone (`soundFile`)
	 * plays in `sound`, from where the video was, and hands back on return. Until that file has
	 * been made, a video simply pauses when the screen locks. An audio file needs none of this.
	 */
	let sound = $state<HTMLAudioElement | null>(null);
	let away = $state(false);

	/** Whichever element is playing now: the video, or its sound while the screen is locked. */
	function active(): HTMLMediaElement | null {
		return away ? sound : player;
	}

	function handOff() {
		if (isAudio || away || !player || !sound || player.paused) return;
		sound.currentTime = player.currentTime;
		sound.defaultPlaybackRate = sound.playbackRate = player.playbackRate;
		away = true;
		player.pause();
		void sound.play();
	}

	function handBack() {
		if (!away || !player || !sound) return;
		const playing = !sound.paused;
		player.currentTime = sound.currentTime;
		sound.pause();
		away = false;
		if (playing) void player.play();
	}

	$effect(() => {
		const change = () => (document.visibilityState === 'hidden' ? handOff() : handBack());
		document.addEventListener('visibilitychange', change);
		return () => document.removeEventListener('visibilitychange', change);
	});

	$effect(() => landscapeWhileFullscreen(document, screen.orientation));

	/** A line's end, checked on timeupdate while locked: coarser than per frame, but it still stops. */
	function checkLineEnd(media: HTMLMediaElement) {
		stopAtLineEnd(media);
	}

	/**
	 * Stops at the end of the line playing now, and says whether it did. The line is taken from the
	 * time, not from currentLine: that follows a frame behind, so after "next line" it still named
	 * the line before, whose end is where the next begins, and playback stopped at once.
	 */
	function stopAtLineEnd(media: HTMLMediaElement): boolean {
		if (!pauseEachLine || media.paused) return false;
		const time = media.currentTime;
		const line = lineAt(cues, time);
		if (line < 0) return false;
		const end = Math.min(cues[line].end, cues[line + 1]?.start ?? Infinity);
		if (stoppedAt === line && time < end - 0.5) stoppedAt = -1;
		if (time >= end - 0.05 && stoppedAt !== line) {
			stoppedAt = line;
			media.pause();
			return true;
		}
		return false;
	}

	/**
	 * Headphones' and the lock screen's buttons (Media Session). Headphones send three signals:
	 * one press play/pause, two "next track", three "previous track". Chosen by the reader: next
	 * replays the current sentence, previous goes to the one before.
	 */
	$effect(() => {
		if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
		const session = navigator.mediaSession;
		session.metadata = new MediaMetadata({ title: title ?? '', artist: artist ?? '' });
		const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
			['play', () => void active()?.play()],
			['pause', () => active()?.pause()],
			['nexttrack', () => replayFrom('media-key', false)],
			['previoustrack', () => replayFrom('media-key', true)]
		];
		for (const [action, handler] of handlers) {
			try {
				session.setActionHandler(action, handler);
			} catch {
				// An action this browser does not know: that button just does nothing here.
			}
		}
		return () => {
			for (const [action] of handlers) {
				try {
					session.setActionHandler(action, null);
				} catch {
					// As above.
				}
			}
		};
	});

	/** Replay the current sentence, or the one before it. */
	function replayFrom(via: string, before: boolean) {
		const line = before && currentLine > 0 ? currentLine - 1 : currentLine;
		recorder?.replay(sourceOf(currentLine), before && currentLine > 0, moment().mediaMs, via);
		seek(line);
	}

	/**
	 * Where playback was before a seek. By `seeking`, currentTime is already the target, and by
	 * `seeked` a timeupdate has passed, so the last timeupdate's time is kept and taken at `seeking`.
	 */
	let playedTo = 0;
	let seekFrom = 0;
	function noteTime() {
		const media = active();
		if (media && !media.seeking) playedTo = media.currentTime;
	}

	function seek(line: number) {
		const media = active();
		if (!media || !cues[line]) return;
		stoppedAt = -1;
		media.currentTime = cues[line].start;
		void media.play();
	}

	/**
	 * Language Reactor's layout: the video fills the screen, with the current line on it, Chinese
	 * above English blurred. The list is one tap away. Remembered on this device only.
	 */
	let stage = $state(readPreference('reader.stage', true));
	let blurEnglish = $state(readPreference('reader.blurEnglish', true));
	/** Stop at the end of every line, to repeat it or read it before going on. */
	let pauseEachLine = $state(readPreference('reader.pauseEachLine', false));
	const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5];
	let speed = $state(readSpeed());
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

	function readSpeed(): number {
		try {
			const kept = Number(localStorage.getItem('reader.speed'));
			return SPEEDS.includes(kept) ? kept : 1;
		} catch {
			return 1;
		}
	}

	function nextSpeed() {
		speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
		if (player) player.playbackRate = speed;
		if (sound) sound.playbackRate = speed;
		recorder?.setting('speed', speed);
		try {
			localStorage.setItem('reader.speed', String(speed));
		} catch {
			// As keep() below: the choice lasts for this visit.
		}
	}

	function togglePauseEachLine() {
		pauseEachLine = !pauseEachLine;
		keep('reader.pauseEachLine', pauseEachLine);
		recorder?.setting('stopAfterLine', pauseEachLine);
		stoppedAt = -1;
	}

	/** Controls hidden for plain watching: only the video and its lines. For this visit only. */
	let bare = $state(false);
	function playOrPause() {
		const media = active();
		if (!media) return;
		if (media.paused) void media.play();
		else media.pause();
	}

	/** The line already stopped at, so pressing play again carries on into the next one. */
	let stoppedAt = -1;

	/**
	 * Every frame while playing, not on timeupdate: that fires about every quarter second, which
	 * let the next line's first word through. A line ends at its own end or where the next begins,
	 * whichever is first, since cues can overlap. Checked before follow() moves on to the next line.
	 */
	function watchLineEnd() {
		if (!player || player.paused) return;
		if (stopAtLineEnd(player)) return;
		follow();
		requestAnimationFrame(watchLineEnd);
	}

	/**
	 * What English the session opens with, since both are remembered across sessions: in the stage
	 * with blur off, every line's English is on screen (2026-10-04).
	 */
	$effect(() => {
		const opened = recorder;
		if (!opened) return;
		untrack(() => {
			opened.noteAtStart('stage', stage);
			opened.noteAtStart('blurEnglish', blurEnglish);
		});
	});

	function setStage(on: boolean) {
		stage = on;
		keep('reader.stage', on);
		recorder?.setting('stage', on);
		if (!on && document.fullscreenElement) void document.exitFullscreen();
	}

	function toggleBlur() {
		blurEnglish = !blurEnglish;
		keep('reader.blurEnglish', blurEnglish);
		recorder?.setting('blurEnglish', blurEnglish);
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
		if (unblurred === currentLine)
			recorder?.translation(sourceOf(currentLine), translations[currentLine]?.source);
	}

	/**
	 * ◀ goes to the line before; ↻ starts this one again. Asked for 2026-10-04, replacing ◀'s
	 * Language Reactor behaviour and ↻'s double press, which went to the line before.
	 */
	function previous() {
		if (currentLine < 0) return;
		replayFrom('previous-button', true);
	}

	function replay() {
		if (currentLine < 0) return;
		recorder?.replay(sourceOf(currentLine), false, moment().mediaMs);
		seek(currentLine);
	}

	function tap(line: number, word: LineWord) {
		active()?.pause();
		onword(line, word);
	}
</script>

<!-- No whitespace inside: this is Chinese, and any gap in the markup would show between characters. -->
{#snippet rubied(word: LineWord)}{#if word.chars}{#each word.chars as ch, i (i)}{#if ch.py}<ruby
					>{ch.c}<rt>{ch.py}</rt></ruby
				>{:else}{ch.c}{/if}{/each}{:else}{word.text}{/if}{/snippet}

{#if url}
	{#if isAudio}
		<audio
			class="player"
			controls
			src={url}
			bind:this={player}
			ontimeupdate={() => (noteTime(), follow())}
			onloadedmetadata={started}
			onpause={() => recorder?.paused()}
			onseeking={() => (seekFrom = playedTo)}
			onseeked={() => recorder?.seek(Math.round(seekFrom * 1000), moment().mediaMs)}
		></audio>
	{:else}
		<div class="media" class:stage>
			{#if stage && status}<div class="stage-status">{@render status()}</div>{/if}
			<!-- svelte-ignore a11y_media_has_caption -->
			<!-- No full screen of the player's own: it showed the bare video, without the subtitles on
			     it. ⛶ on the stage is the one full screen, the whole app's. -->
			<video
				class="player"
				controls={!bare}
				onclick={bare ? playOrPause : undefined}
				controlslist="nofullscreen"
				disablepictureinpicture
				playsinline
				src={url}
				bind:this={player}
				ontimeupdate={() => (noteTime(), follow())}
				onplay={watchLineEnd}
				onloadedmetadata={started}
				onpause={() => recorder?.paused()}
				onseeking={() => (seekFrom = playedTo)}
				onseeked={() => recorder?.seek(Math.round(seekFrom * 1000), moment().mediaMs)}
			></video>
			<!-- The video's own sound, for while the screen is locked (handOff). Never shown. -->
			{#if soundUrl}<audio
					src={soundUrl}
					preload="auto"
					bind:this={sound}
					ontimeupdate={() => away && (noteTime(), follow())}
					onpause={() => away && recorder?.paused()}
					onseeking={() => away && (seekFrom = playedTo)}
					onseeked={() => away && recorder?.seek(Math.round(seekFrom * 1000), moment().mediaMs)}
				></audio>{/if}
			{#if stage}
				{#if bare}
					<button class="unbare" onclick={() => (bare = false)} aria-label="Show the buttons"
						>⋯</button
					>
				{/if}
				<div class="bar" class:hidden={bare}>
					<!-- The stage covers the page, its back link too: without this, a video had no way out
					     but Android's back gesture. -->
					<a class="back-to-videos" href={resolve('/')} aria-label="Back to videos">←</a>
					<button onclick={() => setStage(false)} aria-label="All lines">☰</button>
					<button onclick={toggleBlur} aria-pressed={!blurEnglish}
						>{blurEnglish ? 'English blurred' : 'English shown'}</button
					>
					<button onclick={toggleFullscreen} aria-label="Full screen">⛶</button>
					<button onclick={() => (bare = true)} aria-label="Hide the buttons">✕</button>
				</div>
				{#if currentLine >= 0 && lines[currentLine]}
					<div class="subtitles">
						<p class="chinese" lang={language}>
							{#each lines[currentLine] as word (word.key)}{#if word.isWord}<button
										class="token {word.mark ?? 'state-none'}"
										onclick={() => tap(currentLine, word)}>{@render rubied(word)}</button
									>{:else}<span class="token">{word.text}</span>{/if}{/each}
						</p>
						<button
							class="english-line"
							class:blurred={blurEnglish && unblurred !== currentLine}
							class:quick={translations[currentLine]?.source === 'quick'}
							title={translations[currentLine]?.source === 'human'
								? "From the video's English subtitles"
								: undefined}
							lang="en"
							onclick={showEnglish}
							>{translations[currentLine]?.text ??
								(askable ? 'translating…' : 'No English yet')}</button
						>
						<!-- ◀ ↻ ▶ in the middle; the two settings aside at the edges, quieter. -->
						<div class="steps" class:hidden={bare}>
							<button
								class="setting"
								onclick={togglePauseEachLine}
								aria-pressed={pauseEachLine}
								class:on={pauseEachLine}
								aria-label="Stop after each line">❚❚</button
							>
							<div class="moves">
								<button onclick={previous} aria-label="Previous line">◀</button>
								<button onclick={replay} aria-label="Replay this line">↻</button>
								<button onclick={() => seek(currentLine + 1)} aria-label="Next line">▶</button>
							</div>
							{#if onjoin && currentLine >= 0}
								<div class="moves">
									{#if currentLine + 1 < cues.length}<button
											onclick={() => onjoin(currentLine)}
											aria-label="Join this line with the next">⊕</button
										>{/if}{#if joined[currentLine]}<button
											onclick={() => onsplit?.(currentLine)}
											aria-label="Split this sentence into its lines again">✂</button
										>{/if}
								</div>
							{/if}
							<button class="setting" onclick={nextSpeed} aria-label="Playback speed"
								>{speed}×</button
							>
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
		<input
			type="checkbox"
			bind:checked={showAll}
			onchange={() => recorder?.setting('showAllEnglish', showAll)}
		/>
		Show all English
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
						onclick={() => tap(i, word)}>{@render rubied(word)}</button
					>{:else}<span class="token">{word.text}</span
					>{/if}{/each}{#if translations[i] || (askable && cues[i])}<button
					class="reveal"
					aria-label="Show the English"
					aria-pressed={showAll || revealed.includes(i)}
					onclick={() => reveal(i)}>EN</button
				>{/if}{#if showAll || revealed.includes(i)}{#if translations[i]}<span
						class="english"
						class:quick={translations[i]?.source === 'quick'}
						title={translations[i]?.source === 'quick'
							? 'Quick translation'
							: translations[i]?.source === 'human'
								? "From the video's English subtitles"
								: undefined}
						lang="en">{translations[i]?.text}</span
					>{:else if askable && cues[i]}<span class="english pending">translating…</span
					>{/if}{/if}{#if onjoin && i + 1 < cues.length}<button
					class="join"
					aria-label="Join this line with the next"
					onclick={() => onjoin(i)}>⊕</button
				>{/if}{#if joined[i]}<button
					class="split"
					aria-label="Split this sentence into its lines again"
					onclick={() => onsplit?.(i)}>✂</button
				>{/if}
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
	.bar .back-to-videos,
	.steps button {
		background: rgb(0 0 0 / 55%);
		color: #fff;
		border: 1px solid rgb(255 255 255 / 30%);
		border-radius: 999px;
		padding: 0.3rem 0.8rem;
		min-height: 0;
	}
	.bar button,
	.bar .back-to-videos {
		white-space: nowrap;
	}
	.bar .back-to-videos {
		display: inline-flex;
		align-items: center;
		text-decoration: none;
		font-size: 1.1rem;
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
	/* Pinyin on the video: light on the dark band, like the line itself. */
	.chinese rt {
		color: rgb(255 255 255 / 75%);
	}
	/* On video, an unjudged word is coloured like a subtitle highlight rather than tinted: a tint
	   under white text on black turned muddy. */
	.chinese .token.state-none {
		color: #ffd75e;
		background: none;
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
		align-self: stretch;
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
	}
	.moves {
		display: flex;
		gap: 1.5rem;
	}
	.steps .setting {
		justify-self: start;
		font-size: 0.85rem;
		opacity: 0.6;
		border-color: transparent;
	}
	.steps .setting:last-child {
		justify-self: end;
	}
	.steps .setting.on {
		opacity: 1;
		background: var(--accent);
	}
	.hidden {
		display: none !important;
	}
	.unbare {
		position: absolute;
		top: 0.5rem;
		right: 0.5rem;
		z-index: 1;
		background: rgb(0 0 0 / 35%);
		color: rgb(255 255 255 / 70%);
		border: none;
		border-radius: 999px;
		padding: 0.2rem 0.7rem;
		min-height: 0;
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
	.reveal,
	.join,
	.split {
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
