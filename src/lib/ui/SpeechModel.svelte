<script lang="ts">
	/**
	 * The speech model's one-time setup (spec 008, story 2): asked for, never downloaded unasked;
	 * resumable; then a calibration of about a minute. Shown where a transcript waits for it, and on
	 * Diagnostics.
	 */
	import Progress from './Progress.svelte';
	import { speechSetup, type SetupState } from '$lib/speech/app';
	import { TOTAL_BYTES } from '$lib/speech/model';

	let state = $state<SetupState>(speechSetup.state);
	$effect(() => speechSetup.subscribe((s) => (state = s)));

	const mb = (bytes: number) => Math.round(bytes / 1_000_000);
</script>

<div class="speech-model">
	{#if state.kind === 'missing'}
		<p>
			Reader writes the transcript itself. It needs a one-time download of {mb(TOTAL_BYTES)} MB, best
			on Wi-Fi.
		</p>
		<button onclick={() => void speechSetup.download()}>Download the speech model</button>
	{:else if state.kind === 'downloading'}
		<Progress
			label={`Downloading the speech model, once: ${mb(state.bytes)} of ${mb(state.total)} MB`}
			fraction={state.bytes / state.total}
		/>
	{:else if state.kind === 'paused'}
		<Progress
			label={`The download paused at ${mb(state.bytes)} of ${mb(state.total)} MB${state.message ? `: ${state.message}` : ''}`}
			fraction={state.bytes / state.total}
		/>
		<button onclick={() => void speechSetup.download()}>Continue</button>
	{:else if state.kind === 'calibrating'}
		<Progress
			label={`Measuring how fast this phone transcribes (${state.step} of ${state.of})…`}
			fraction={(state.step - 1) / state.of}
		/>
	{:else if state.kind === 'failed'}
		<p role="alert">{state.message}</p>
		<button onclick={() => void speechSetup.download()}>Try again</button>
	{:else if state.kind === 'ready'}
		<p>The speech model is on this device.</p>
	{/if}
</div>

<style>
	.speech-model {
		font-size: 0.85rem;
		color: var(--muted);
		margin: 0.3rem 0;
	}
	.speech-model p {
		margin: 0.2rem 0;
	}
</style>
