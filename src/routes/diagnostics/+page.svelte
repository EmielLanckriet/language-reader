<script lang="ts">
	import { resolve } from '$app/paths';
	import { session } from '$lib/storage/session';
	import type { Diagnostic } from '$lib/diagnostics/log';

	/**
	 * FR-021: the reader must be able to retrieve and read the failure record **without developer
	 * tools**. On Android there are none to hand, and with no server there is nowhere else the
	 * information exists — so this page is the whole of it.
	 */
	let entries = $state<Diagnostic[]>([]);
	let durability = $state('');
	let persistence = $state('');
	let loading = $state(true);

	$effect(() => {
		void load();
	});

	async function load() {
		const s = await session();
		entries = await s.repository.readDiagnostics();
		durability = s.durability;
		persistence = s.persistence;
		loading = false;
	}

	async function clear() {
		const s = await session();
		await s.repository.clearDiagnostics();
		entries = await s.repository.readDiagnostics();
	}
</script>

<a class="back" href={resolve('/')}>← Library</a>

<h1>Diagnostics</h1>
<p class="subtitle">
	Everything that has gone wrong on this device. Nothing here is sent anywhere.
</p>

<dl class="facts">
	<dt>Storage</dt>
	<dd>
		{durability === 'opfs'
			? 'On this device, in the browser’s private file system.'
			: 'In memory only — anything saved will be lost when this tab closes.'}
	</dd>
	<dt>Eviction</dt>
	<dd>
		{persistence === 'granted'
			? 'The browser has promised not to evict it.'
			: 'The browser has not promised to keep it. It may be deleted if the device runs short of space.'}
	</dd>
</dl>

{#if loading}
	<p class="loading">Reading…</p>
{:else if entries.length === 0}
	<p class="empty">Nothing has failed yet.</p>
{:else}
	<ul class="entries">
		{#each entries as entry (entry.id)}
			<li>
				<p class="head">
					<span class="kind">{entry.kind}</span> <span class="at">{entry.at}</span>
				</p>
				<pre>{entry.detail}</pre>
			</li>
		{/each}
	</ul>
	<button class="secondary" onclick={clear}>Clear</button>
{/if}

<style>
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

	.entries {
		list-style: none;
		padding: 0;
		margin: 0 0 1rem;
	}

	.entries li {
		border-top: 1px solid var(--rule);
		padding: 0.75rem 0;
	}

	.head {
		margin: 0 0 0.35rem;
		font-size: 0.8rem;
	}

	.kind {
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--danger);
		font-weight: 600;
	}

	.at {
		color: var(--muted);
	}

	pre {
		margin: 0;
		white-space: pre-wrap;
		word-break: break-word;
		font-size: 0.8rem;
		color: var(--muted);
	}
</style>
