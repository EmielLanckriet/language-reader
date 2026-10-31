<script lang="ts">
	import { onMount } from 'svelte';
	import { studyDayOf } from '$lib/domain/study';
	import { readDayEnd } from '$lib/ui/hardcore';
	import { isTaalCode } from '$lib/taal/send';
	import {
		requestSend,
		setTaalConnection,
		taalConnection,
		TAAL_CHANGE,
		type TaalConnection
	} from '$lib/taal/sync';

	/** Under More: connect this device to the reader's Taal challenge with a code (spec 020). */
	let connection = $state<TaalConnection | null>(taalConnection());
	let code = $state('');
	let problem = $state<string | null>(null);

	onMount(() => {
		const update = () => (connection = taalConnection());
		window.addEventListener(TAAL_CHANGE, update);
		return () => window.removeEventListener(TAAL_CHANGE, update);
	});

	function connect() {
		problem = null;
		if (!isTaalCode(code)) {
			problem = 'This is not a Taal code. Copy it again from Taal.';
			return;
		}
		const today = studyDayOf(Intl.DateTimeFormat().resolvedOptions().timeZone, readDayEnd());
		setTaalConnection({ code: code.trim(), since: today(new Date()), on: true });
		code = '';
		requestSend(true);
	}
</script>

<dl class="facts">
	<dt>What is sent</dt>
	<dd>
		Your reading and watching minutes (Study when you studied it, Output when you shadowed it, Input
		otherwise), 10 s of Study per drill card and 10 s per Cards answer, per hour. Taal adds them
		next to what you enter there yourself. Days before you connect are never sent. Nothing else
		leaves this device.
	</dd>
	<dt>This device</dt>
	<dd>
		{#if connection?.on}
			Sending from {connection.since} on.
			<br /><button class="secondary" onclick={() => setTaalConnection(null)}>Disconnect</button>
		{:else}
			In Taal: Settings → Connected apps → Connect. Paste the code here.
			<br /><input
				aria-label="Taal code"
				placeholder="Taal code"
				autocomplete="off"
				spellcheck="false"
				bind:value={code}
			/>
			<button class="secondary" onclick={connect}>Connect</button>
		{/if}
		{#if problem}<p class="problem" role="alert">{problem}</p>{/if}
	</dd>
</dl>

<style>
	/* As More's own facts lists, whose styles stay in that page. */
	.facts {
		border: 1px solid var(--rule);
		border-radius: 8px;
		padding: 0.75rem 1rem;
		margin: 0 0 1.5rem;
	}
	.facts dt {
		font-weight: 600;
		font-size: 0.85rem;
	}
	.facts dd {
		margin: 0 0 0.6rem;
		color: var(--muted);
		font-size: 0.9rem;
	}
	.problem {
		color: var(--danger);
		margin: 0.5rem 0 0;
	}
</style>
