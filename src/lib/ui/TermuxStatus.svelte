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

<details class="service-status">
	<summary
		>Device service <span>{running === null ? 'Checking…' : running ? 'Connected' : 'Offline'}</span
		></summary
	>
	<div class="termux" data-termux={running === null ? 'unknown' : running ? 'running' : 'stopped'}>
		{#if running}
			<span class="dot on" aria-hidden="true"></span> Termux running
		{:else if running === false}
			<span class="dot" aria-hidden="true"></span> Termux not running
			<StartTermux onstarted={check} />
		{/if}
	</div>
</details>

<style>
	.service-status {
		font-size: 0.75rem;
		color: var(--muted);
		margin: 0 0 1rem;
	}
	summary {
		cursor: pointer;
		min-height: 44px;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	summary span {
		border: 1px solid var(--rule);
		border-radius: 20px;
		padding: 0 0.5rem;
	}
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
