<script lang="ts">
	import { resolve } from '$app/paths';
	import { session } from '$lib/storage/session';
	import { explain, type Availability } from '$lib/storage/availability';
	import type { Diagnostic } from '$lib/diagnostics/describe';
	import { runningVersion, describeVersion } from '$lib/ui/version';

	/**
	 * FR-021: the reader must be able to retrieve and read the failure record **without developer
	 * tools**. On Android there are none to hand, and with no server there is nowhere else the
	 * information exists — so this page is the whole of it.
	 */
	let entries = $state<Diagnostic[]>([]);
	let availability = $state<Availability>({ kind: 'acquiring', remembering: false });
	let persistence = $state('');
	let loading = $state(true);

	// Read outside the storage effect on purpose: the version has to be reportable even when the
	// database cannot be opened, which is exactly when someone opens this page.
	const running = runningVersion();

	$effect(() => {
		let stop = () => {};
		void (async () => {
			const s = await session();
			stop = s.repository.watch((state) => (availability = state));
			persistence = s.persistence;
			entries = await s.repository.readDiagnostics();
			loading = false;
		})();
		return () => stop();
	});

	const storage = $derived.by(() => {
		switch (availability.kind) {
			case 'holding':
				return 'On this device, in the browser’s private file system. Changes are being saved.';
			case 'acquiring':
				return 'Reconnecting to your library. This happens each time you come back to the app.';
			case 'paused':
				return 'Released, because this window is in the background. It comes back when you do.';
			case 'refused': {
				const why = explain(availability.cause);
				return `${why.headline} ${why.action}${why.detail ? ` (${why.detail})` : ''}`;
			}
		}
	});

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

<h2 class="section">Right now</h2>

<dl class="facts">
	<dt>Version</dt>
	<dd>
		<!--
			FR-010 asks the reader to decide when to move to a new version, on the stated grounds
			that knowing when one landed is worth a tap. That only pays off if it is still knowable
			afterwards — a notice missed is a notice gone. Recorded when a new build is first seen.
		-->
		{describeVersion(running)}{running.since
			? `, running here since ${running.since.toLocaleString()}`
			: ''}
	</dd>
	<dt>Storage</dt>
	<dd>{storage}</dd>
	<dt>Eviction</dt>
	<dd>
		{persistence === 'granted'
			? 'The browser has promised not to evict it.'
			: 'The browser has not promised to keep it. It may be deleted if the device runs short of space.'}
	</dd>
	<dt>What is safe, and what is not</dt>
	<dd>
		<!--
			FR-018. A permanent line rather than a notice shown once: a first-run notice is dismissed
			reflexively and is then absent exactly when someone wants to check. Nothing interrupts
			the reader with this anywhere else.
		-->
		Text you save is kept and is never thrown away. Words you mark are <strong>provisional</strong>
		— this version splits Chinese one character at a time, and when real word-splitting arrives the words
		themselves change, so marks attached to single characters may not carry across.
	</dd>
</dl>

<h2 class="section">What has happened before</h2>
<p class="subtitle">
	A record of past failures, each with the time it happened. These describe moments that have
	already passed — for what is true now, read the two lines above.
</p>

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
	.section {
		font-size: 0.95rem;
		margin: 1.5rem 0 0.5rem;
	}

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
