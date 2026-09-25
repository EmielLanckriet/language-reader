<script lang="ts">
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { importBundle } from '$lib/media/import';
	import { describeError } from '$lib/diagnostics/describe';

	/**
	 * Opening a bundle by hand, for when the reader service is not running. Videos normally arrive
	 * through "New from Termux" on the library page (ADR-0022).
	 */
	let importing = $state(false);
	let problem = $state<string | null>(null);

	async function picked(event: Event) {
		const file = (event.currentTarget as HTMLInputElement).files?.[0];
		if (!file) return;
		importing = true;
		problem = null;
		try {
			const imported = await importBundle(file, file.name.replace(/\.tar$/, ''));
			await goto(
				'pending' in imported
					? resolve('/live/[job]', { job: imported.pending })
					: resolve('/read/[id]', { id: String(imported.documentId) })
			);
		} catch (error) {
			problem = error instanceof Error ? error.message : describeError(error);
		} finally {
			importing = false;
		}
	}
</script>

<main>
	<p><a href={resolve('/')}>← Documents</a></p>
	<h1>Open a bundle</h1>
	<p>
		A bundle is the <code>bundle.tar</code> Termux leaves in its <code>downloads</code> folder. Pick one
		from Termux in the file picker.
	</p>
	{#if problem}<p role="alert">{problem}</p>{/if}
	<input type="file" accept=".tar,application/x-tar" onchange={picked} disabled={importing} />
	{#if importing}<p>Importing…</p>{/if}
</main>
