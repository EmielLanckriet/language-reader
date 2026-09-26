<script lang="ts">
	import { canStartTermux, startTermux } from '$lib/media/service';

	/** Called once the service answers. */
	let { onstarted }: { onstarted?: () => void } = $props();

	let state = $state<'idle' | 'starting' | 'failed'>('idle');

	async function start() {
		state = 'starting';
		if (await startTermux()) {
			state = 'idle';
			onstarted?.();
		} else state = 'failed';
	}
</script>

{#if canStartTermux()}
	<span class="start-termux">
		<button onclick={start} disabled={state === 'starting'}>
			{state === 'starting' ? 'Starting Termux…' : 'Start Termux'}
		</button>
		{#if state === 'failed'}
			<!-- Without "Display over other apps", Termux only runs a share once it is opened. -->
			<small>Not started. In the list, choose Termux; if nothing happens, open Termux once.</small>
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
