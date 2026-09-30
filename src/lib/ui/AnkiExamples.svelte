<script lang="ts">
	import { importExampleBundle, readExampleBundle } from '$lib/media/example-bundle';
	let selected = $state<File | null>(null);
	let count = $state(0);
	let clips = $state(0);
	let busy = $state(false);
	let progress = $state('');
	let problem = $state('');
	async function pick(event: Event) {
		selected = null;
		problem = '';
		progress = '';
		const file = (event.currentTarget as HTMLInputElement).files?.[0];
		if (!file) return;
		busy = true;
		try {
			const bundle = await readExampleBundle(file);
			selected = file;
			count = bundle.examples.length;
			clips = bundle.audio.length;
		} catch (error) {
			problem = String(error);
		} finally {
			busy = false;
		}
	}
	async function save() {
		if (!selected) return;
		busy = true;
		problem = '';
		try {
			const changed = await importExampleBundle(selected, (text) => (progress = text));
			progress = `Examples ready. ${changed} new or updated examples saved; audio is available offline.`;
			selected = null;
		} catch (error) {
			problem = String(error);
		} finally {
			busy = false;
		}
	}
</script>

<section>
	<h2>Anki examples and audio</h2>
	<p>
		Keep the example sentences and recordings from your Anki deck. This adds context to cards
		without changing their schedule.
	</p>
	<details>
		<summary>Prepare the file on your laptop</summary>
		<p>
			Run <code>python3 scripts/anki/export_examples.py --push</code>, then choose
			<code>anki-examples.tar</code> from Downloads. Keep this file to restore audio later; regular backups
			retain the example text but not the audio files.
		</p>
	</details>
	<label>Example bundle <input type="file" accept=".tar" onchange={pick} disabled={busy} /></label>
	{#if selected}<p>
			{count} examples · {clips} audio files · {Math.round(selected.size / 1024 / 1024)} MB
		</p>
		<button onclick={save} disabled={busy}>Import examples and audio</button>{/if}
	{#if progress}<p role="status">{progress}</p>{/if}
	{#if problem}<p role="alert">{problem} You can select the file and retry.</p>{/if}
</section>

<style>
	section {
		margin: 2rem 0;
	}
	input {
		max-width: 100%;
		margin: 1rem 0;
	}
	summary {
		cursor: pointer;
		padding: 0.6rem 0;
	}
	code {
		overflow-wrap: anywhere;
	}
</style>
