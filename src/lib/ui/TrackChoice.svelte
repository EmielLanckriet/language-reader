<script lang="ts">
	/**
	 * Which subtitle tracks a video is read with (spec 012). Shown only when there is a real choice:
	 * several clean Chinese tracks, or a human English track. The defaults are preselected, so
	 * confirming is one tap; closing imports nothing and the download stays in "New from Termux".
	 */
	import { untrack } from 'svelte';
	import { parseSubtitles, type ClassifiedTrack } from '$lib/media/subtitles';
	import type { ImportPlan, TrackChoice } from '$lib/media/import';

	let {
		title,
		plan,
		onconfirm,
		onclose
	}: {
		title: string;
		plan: ImportPlan;
		onconfirm: (choice: TrackChoice) => void;
		onclose: () => void;
	} = $props();

	// Start at the defaults; from then on the reader's taps decide.
	let chinese = $state(untrack(() => plan.defaults.chinese));
	let english = $state(untrack(() => plan.defaults.english));

	const chineseTracks = $derived(
		plan.tracks.filter((track) => track.chinese && !track.duplicateOf)
	);
	const englishTracks = $derived(plan.tracks.filter((track) => track.english));

	function preview(track: ClassifiedTrack): string[] {
		return parseSubtitles(track.text)
			.slice(0, 3)
			.map((cue) => cue.text);
	}

	function label(track: ClassifiedTrack): string {
		const kind = track.kind === 'human' ? 'by a person' : 'automatic';
		const extra = track.mixed ? ', with a second line under each line' : '';
		return `${track.name || track.lang} · ${kind}${extra}`;
	}
</script>

<svelte:window
	onkeydown={(event) => {
		if (event.key === 'Escape') onclose();
	}}
/>

<div class="backdrop">
	<button class="dismiss" onclick={onclose} aria-label="Close without importing"></button>

	<div class="sheet" role="dialog" aria-modal="true" aria-label="Choose subtitles for {title}">
		<div class="head">
			<h2>Choose subtitles</h2>
			<button class="icon close" onclick={onclose} aria-label="Close without importing">✕</button>
		</div>
		<p class="muted small">{title}</p>

		<fieldset>
			<legend>Chinese text</legend>
			{#each chineseTracks as track (track.file)}
				<label class="option">
					<input type="radio" name="chinese" value={track.file} bind:group={chinese} />
					<span>
						<span class="what">{label(track)}</span>
						{#each preview(track) as line, i (i)}
							<span class="line" lang="zh">{line}</span>
						{/each}
					</span>
				</label>
			{/each}
			<label class="option">
				<input type="radio" name="chinese" value="transcribe" bind:group={chinese} />
				<span class="what">Transcribe it myself</span>
			</label>
		</fieldset>

		<fieldset>
			<legend>English</legend>
			{#each englishTracks as track (track.file)}
				<label class="option">
					<input type="radio" name="english" value={track.file} bind:group={english} />
					<span>
						<span class="what">{label(track)}</span>
						{#each preview(track) as line, i (i)}
							<span class="line">{line}</span>
						{/each}
					</span>
				</label>
			{/each}
			<label class="option">
				<input type="radio" name="english" value="machine" bind:group={english} />
				<span class="what">Machine translation</span>
			</label>
			<label class="option">
				<input type="radio" name="english" value="none" bind:group={english} />
				<span class="what">None</span>
			</label>
		</fieldset>

		<button class="confirm" onclick={() => onconfirm({ chinese, english })}>Import</button>
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

	/* Covers the viewport behind the sheet; not a target the reader aims at. */
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

	.sheet {
		position: relative;
		width: 100%;
		max-width: 36rem;
		max-height: 100dvh;
		overflow-y: auto;
		background: var(--paper);
		border-top-left-radius: 12px;
		border-top-right-radius: 12px;
		padding: 0.5rem 0.75rem calc(0.75rem + env(safe-area-inset-bottom));
		box-shadow: 0 -8px 30px rgba(0, 0, 0, 0.25);
		display: grid;
		gap: 0.5rem;
	}

	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	h2 {
		font-size: 1.1rem;
		margin: 0;
	}

	fieldset {
		border: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.25rem;
	}

	legend {
		font-weight: 600;
		padding: 0;
		margin-bottom: 0.25rem;
	}

	.option {
		display: flex;
		gap: 0.6rem;
		align-items: flex-start;
		min-height: 44px;
		padding: 0.4rem 0.25rem;
		border-radius: 8px;
	}

	.option:has(input:checked) {
		background: color-mix(in srgb, currentColor 8%, transparent);
	}

	.option input {
		margin-top: 0.25rem;
		flex: none;
	}

	.what {
		display: block;
	}

	.line {
		display: block;
		font-size: 0.9rem;
		opacity: 0.75;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 28rem;
	}

	.muted {
		opacity: 0.7;
	}

	.small {
		font-size: 0.85rem;
		margin: 0;
	}

	.confirm {
		min-height: 44px;
		font-weight: 600;
	}
</style>
