<script lang="ts">
	import { health } from '$lib/media/service';
	import StartTermux from './StartTermux.svelte';

	/**
	 * Whether Termux's reader service runs, always in view on the library's tabs, with the button to
	 * start it beside it. Before this the only sign was a warning that stayed quiet for a day, so a
	 * press that did not take (Android can kill Termux again at once when memory is short) looked
	 * exactly like one that did.
	 */
	let running = $state<boolean | null>(null);

	const check = async () => {
		if (document.visibilityState === 'visible') running = (await health()) !== null;
	};

	$effect(() => {
		void check();
		const timer = setInterval(check, 5000);
		document.addEventListener('visibilitychange', check);
		return () => {
			clearInterval(timer);
			document.removeEventListener('visibilitychange', check);
		};
	});
</script>

<div class="termux" data-termux={running === null ? 'unknown' : running ? 'running' : 'stopped'}>
	{#if running}
		<span class="dot on" aria-hidden="true"></span> Termux running
	{:else if running === false}
		<span class="dot" aria-hidden="true"></span> Termux not running
		<StartTermux onstarted={check} />
	{/if}
</div>

<style>
	.termux {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.4rem;
		font-size: 0.9rem;
		color: var(--muted);
		min-height: 1.5rem;
	}
	.dot {
		width: 0.6rem;
		height: 0.6rem;
		border-radius: 50%;
		background: var(--unknown);
	}
	.dot.on {
		background: var(--known);
	}
	.termux :global(.start-termux) {
		margin-top: 0;
	}
</style>
