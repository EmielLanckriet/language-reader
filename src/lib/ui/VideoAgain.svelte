<script lang="ts">
	/**
	 * Download the video again (media/redownload.ts), on the page of a video document that has no
	 * video file: only its sound, or nothing. Follows Termux while it downloads, then puts the video
	 * into this document and says so through `onvideo`.
	 */
	import { askForVideo, takeVideo, videoProgress, waitingForVideo } from '$lib/media/redownload';
	import { readMediaJson } from '$lib/media/store';

	let {
		documentId,
		meta,
		sound,
		onvideo
	}: {
		documentId: number;
		meta: Record<string, unknown>;
		/** Whether its sound is on the phone, though the video is not. */
		sound: boolean;
		onvideo: () => void;
	} = $props();

	const POLL_MS = 3000;
	// svelte-ignore state_referenced_locally
	let waiting = $state(waitingForVideo(meta));
	let busy = $state(false);
	let status = $state<{ label: string; fraction?: number } | undefined>();
	let problem = $state('');

	async function ask() {
		busy = true;
		problem = '';
		try {
			await askForVideo(documentId);
			waiting = true;
		} catch (error) {
			problem = error instanceof Error ? error.message : String(error);
		} finally {
			busy = false;
		}
	}

	$effect(() => {
		if (!waiting) return;
		let stopped = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const poll = async () => {
			try {
				if (await takeVideo(documentId)) {
					if (!stopped) {
						waiting = false;
						status = undefined;
						onvideo();
					}
					return;
				}
				const current =
					(await readMediaJson<Record<string, unknown>>(documentId, 'meta.json')) ?? {};
				const progress = await videoProgress(current);
				if (stopped) return;
				if (progress === 'unreachable') {
					status = undefined;
					problem = 'Termux is not reachable. Start it: the download goes on there.';
				} else if (progress?.failed) {
					status = undefined;
					problem = progress.label;
				} else {
					problem = '';
					status = progress ?? { label: 'Waiting for Termux…' };
				}
			} catch (error) {
				if (!stopped) problem = error instanceof Error ? error.message : String(error);
			}
			if (!stopped) timer = setTimeout(() => void poll(), POLL_MS);
		};
		void poll();
		return () => {
			stopped = true;
			clearTimeout(timer);
		};
	});
</script>

<section class="again" aria-label="The video">
	{#if waiting}
		<p role="status">
			{status?.label ?? 'Asking Termux…'}
			{#if status?.fraction !== undefined}<progress value={status.fraction}></progress>{/if}
		</p>
	{:else}
		<p class="muted">
			{sound ? 'Only the sound of this video is' : 'This video is not'} on the phone. Termux can download
			it again; the subtitles, your line edits and your history stay as they are.
		</p>
	{/if}
	{#if problem}<p role="alert">{problem}</p>{/if}
	<button onclick={ask} disabled={busy}>
		{waiting ? 'Ask Termux again' : 'Download the video again'}
	</button>
</section>

<style>
	.again {
		margin-top: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.again p {
		margin: 0;
	}
	.muted {
		color: var(--muted);
		font-size: 0.9rem;
	}
	progress {
		width: 100%;
	}
	button {
		min-height: 44px;
	}
</style>
