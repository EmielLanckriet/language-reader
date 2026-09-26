<script lang="ts">
	import {
		canShareToTermux,
		helperExpected,
		startBySharing,
		startWithHelper
	} from '$lib/media/service';

	/** Called once the service answers. */
	let { onstarted }: { onstarted?: () => void } = $props();

	let state = $state<'idle' | 'starting' | 'failed' | 'no-helper'>('idle');

	async function start() {
		state = 'starting';
		// Reader Start is one tap; the share sheet is the fallback on a phone without it.
		const started = helperExpected() ? await startWithHelper() : await startBySharing();
		if (started === true) {
			state = 'idle';
			onstarted?.();
		} else state = started === 'missing' ? 'no-helper' : 'failed';
	}
</script>

{#if helperExpected() || canShareToTermux()}
	<span class="start-termux">
		<button onclick={start} disabled={state === 'starting'}>
			{state === 'starting' ? 'Starting Termux…' : 'Start Termux'}
		</button>
		{#if state === 'no-helper'}
			<small>Reader Start isn't installed. Tap again to start Termux through the share list.</small>
		{:else if state === 'failed'}
			<small>Termux didn't start. Open Termux once, then come back.</small>
		{/if}
	</span>
{/if}

<style>
	.start-termux {
		display: inline-flex;
		flex-direction: column;
		gap: 0.25rem;
		margin-top: 0.5rem;
	}
</style>
