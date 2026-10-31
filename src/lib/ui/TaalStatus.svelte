<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import {
		requestSend,
		taalConnection,
		taalStatus,
		TAAL_CHANGE,
		type TaalStatus
	} from '$lib/taal/sync';

	/** On Progress: the last send to Taal, or why it failed (spec 020, User Story 3). */
	let on = $state(taalConnection()?.on ?? false);
	let status = $state<TaalStatus | null>(taalStatus());

	onMount(() => {
		const update = () => {
			on = taalConnection()?.on ?? false;
			status = taalStatus();
		};
		window.addEventListener(TAAL_CHANGE, update);
		return () => window.removeEventListener(TAAL_CHANGE, update);
	});

	const time = (at: string) =>
		new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	const WHY = {
		offline: 'no network; it goes when you are back online',
		refused: 'Taal no longer accepts the code. Make a new one in Taal and paste it under More',
		failed: 'Taal could not save it'
	};
</script>

{#if on}
	<p class="taal" role="status">
		{#if !status}
			Taal: waiting for the first send.
		{:else if status.ok}
			Taal is up to date ({time(status.at)}): today {status.today.input} min Input, {status.today
				.study} min Study, {status.today.cards} cards.
		{:else}
			Not sent to Taal ({time(status.at)}): {WHY[status.reason]}. Nothing is lost.
			{#if status.reason === 'refused'}<a href={resolve('/diagnostics')}>More</a>{:else}<button
					class="text-button"
					onclick={() => requestSend(true)}>Retry</button
				>{/if}
			<small>{status.detail}</small>
		{/if}
	</p>
{/if}

<style>
	.taal {
		color: var(--muted);
		font-size: 0.9rem;
	}
	.taal small {
		display: block;
		overflow-wrap: anywhere;
	}
	.text-button {
		background: none;
		border: none;
		padding: 0;
		color: inherit;
		text-decoration: underline;
		font: inherit;
		cursor: pointer;
	}
</style>
