<script lang="ts">
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { importBundle } from '$lib/media/import';
	import { describeError } from '$lib/diagnostics/describe';
	import { INBOX_CACHE } from '$lib/analyzer/model-cache';
	import { readTar, type TarMember } from '$lib/media/tar';

	interface Arrival {
		key: string;
		name: string;
		type: string;
		size: number;
		received: number;
		members?: TarMember[];
		text?: string;
	}

	let arrivals = $state<Arrival[]>([]);
	let problem = $state<string | null>(null);
	let importing = $state(false);

	async function importFrom(blob: Blob, name: string, key?: string) {
		importing = true;
		problem = null;
		try {
			const id = await importBundle(blob, name.replace(/\.tar$/, ''));
			if (key) await (await caches.open(INBOX_CACHE)).delete(key);
			await goto(resolve('/read/[id]', { id: String(id) }));
		} catch (error) {
			problem = error instanceof Error ? error.message : describeError(error);
		} finally {
			importing = false;
		}
	}

	async function importArrival(key: string, name: string) {
		const response = await (await caches.open(INBOX_CACHE)).match(key);
		if (response) await importFrom(await response.blob(), name, key);
	}

	function picked(event: Event) {
		const file = (event.currentTarget as HTMLInputElement).files?.[0];
		if (file) void importFrom(file, file.name);
	}

	function megabytes(bytes: number): string {
		return `${(bytes / 1_000_000).toFixed(1)} MB`;
	}

	async function load() {
		try {
			const inbox = await caches.open(INBOX_CACHE);
			const found: Arrival[] = [];
			for (const request of await inbox.keys()) {
				const response = await inbox.match(request);
				if (!response) continue;
				const blob = await response.blob();
				const arrival: Arrival = {
					key: request.url,
					name: decodeURIComponent(response.headers.get('x-name') ?? '?'),
					type: response.headers.get('content-type') ?? '?',
					size: blob.size,
					received: Number(response.headers.get('x-received'))
				};
				if (arrival.type === 'text/uri-list') arrival.text = await blob.text();
				else if (arrival.type.includes('tar') || arrival.name.endsWith('.tar')) {
					arrival.members = await readTar(blob);
				}
				found.push(arrival);
			}
			arrivals = found.sort((a, b) => b.received - a.received);
		} catch (error) {
			problem = String(error);
		}
	}

	// A share lands here, and what was shared is what the reader wants to watch: import it and go.
	// The list and its buttons are what is left if that fails.
	let tried = false;
	$effect(() => {
		const bundle = arrivals.find((arrival) => arrival.members);
		if (!bundle || tried) return;
		tried = true;
		void importArrival(bundle.key, bundle.name);
	});

	async function discard(key: string) {
		await (await caches.open(INBOX_CACHE)).delete(key);
		await load();
	}

	$effect(() => {
		void load();
	});
</script>

<main>
	<p><a href={resolve('/')}>← Documents</a></p>
	<h1>Inbox</h1>
	{#if problem}<p role="alert">{problem}</p>{/if}
	<label>
		Open a bundle from Termux (.tar)
		<input type="file" accept=".tar,application/x-tar" onchange={picked} disabled={importing} />
	</label>
	{#if importing}<p>Importing…</p>{/if}
	{#if arrivals.length === 0}<p>Nothing shared yet.</p>{/if}
	<ul>
		{#each arrivals as arrival (arrival.key)}
			<li>
				<strong>{arrival.name}</strong> — {arrival.type}, {megabytes(arrival.size)}
				{#if arrival.text}<div>{arrival.text}</div>{/if}
				{#if arrival.members}
					<ul>
						{#each arrival.members as member (member.name)}
							<li>{member.name} — {megabytes(member.size)}</li>
						{/each}
					</ul>
				{/if}
				{#if arrival.members}
					<button disabled={importing} onclick={() => importArrival(arrival.key, arrival.name)}
						>Import</button
					>
				{/if}
				<button onclick={() => discard(arrival.key)}>Discard</button>
			</li>
		{/each}
	</ul>
</main>
