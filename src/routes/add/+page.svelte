<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { session } from '$lib/storage/session';
	import { pasteSource } from '$lib/content/paste';
	import { fallbackAnalyzer } from '$lib/analyzer/active';
	import { resolveTokens, stampOf } from '$lib/analyzer/resolve';
	import { RejectedInput } from '$lib/content/types';
	import ErrorNotice from '$lib/ui/ErrorNotice.svelte';
	import { describeError } from '$lib/diagnostics/describe';
	import { MAXIMUM_CHARACTERS } from '$lib/content/paste';
	import { codePointLength } from '$lib/domain/offsets';

	let pasted = $state('');
	let saving = $state(false);
	let problem = $state<unknown>(null);

	// Counted in characters, matching the limit the content source enforces (FR-020). Shown live
	// so the reader can see they are over the limit before pressing anything.
	const length = $derived(codePointLength(pasted));

	async function save() {
		problem = null;
		saving = true;
		try {
			const { repository } = await session();
			const document = await pasteSource.ingest(pasted);
			// **The fallback, deliberately, even when the model is on the device.**
			//
			// The model costs about 4 s per 1,000 characters (research.md R18), so importing five
			// thousand characters with it took over thirty seconds on the reader's phone against
			// SC-004's three, and — in their words — "doesn't even really work". The dictionary
			// segments the same document in 26 ms.
			//
			// The document is therefore saved stamped with the fallback, which makes it immediately
			// out of date under the model. That is not a defect being tolerated; it is the existing
			// staleness machinery being used for what it is for. The background sweep re-derives it
			// (FR-016), and T048 confirmed on a real device that re-derivation preserves the marks
			// made in the meantime — marks live on lexemes, which `replaceTokens` reuses rather
			// than deletes.
			//
			// The reader consequently reads dictionary words first and better words shortly after.
			// That trade was put to them explicitly and chosen. What it costs, and the incremental
			// version that would upgrade the first page first, are recorded in
			// docs/anticipated-changes.md.
			const analyzer = fallbackAnalyzer;
			const analyzed = await analyzer.analyze(document.rawContent);
			const tokens = resolveTokens(document.rawContent, analyzed, analyzer);
			await repository.saveDocument(document, tokens, stampOf(analyzer));
			pasted = '';
			// Straight to the new text in its list, where it is first.
			await goto(resolve('/texts'));
		} catch (error) {
			// A refused paste and a broken database are different problems and read differently
			// (FR-018, FR-022). Collapsing them into "something went wrong" is what this avoids,
			// and ErrorNotice is what tells them apart.
			problem = error;
			if (!(error instanceof RejectedInput)) await record('storage', error);
		} finally {
			saving = false;
		}
	}

	/** Failures go to the on-device record as well as to the screen (FR-021). */
	async function record(kind: 'storage' | 'unexpected', error: unknown) {
		try {
			const { repository } = await session();
			await repository.recordDiagnostic(kind, describeError(error));
		} catch {
			// The database is the thing that failed. Nothing further to try.
		}
	}

	/** See the control above. Short enough to read at a glance on a phone. */
	const SAMPLE_TEXT =
		'朋友很好。我在中国学习中文。他骑自行车去上班。三个人在那里等着。玛丽亚是我的朋友。圆周率大约是3.14。';
</script>

<h1>Add</h1>

<section aria-labelledby="add-video">
	<h2 id="add-video">A video</h2>
	<p>
		In YouTube, tap <strong>Share</strong>, then <strong>Termux</strong>. It shows under
		<a href={resolve('/')}>Videos</a> within seconds, and you can start watching while it downloads. A
		video with no Chinese subtitles gets them made on the phone as you watch.
	</p>
	<p class="subtitle">
		A bundle file from elsewhere can be <a href={resolve('/inbox')}>opened by hand</a>.
	</p>
</section>

<section aria-labelledby="add-text">
	<h2 id="add-text">A text</h2>
	<p class="subtitle">Paste Chinese text, then tap words as you read.</p>

	<!--
	A sample to hand, so checking the reader on a phone does not start with typing Chinese into a
	touch keyboard. It fills the box rather than saving directly: the reader still decides what
	enters their library, and nothing writes earned data on their behalf.

	The text is chosen to exercise the cases that actually distinguish segmenters — a plain
	two-character word, a compound that dictionary methods split, a name, a measure-word run, and a
	decimal — so a glance at the result says whether word splitting is working on this device.
-->
	<button class="secondary" onclick={() => (pasted = SAMPLE_TEXT)}>Load sample text</button>

	<textarea
		bind:value={pasted}
		placeholder="Paste Chinese text here"
		aria-label="Text to save"
		lang="zh"></textarea>

	<p class="subtitle">
		{length.toLocaleString()} of {MAXIMUM_CHARACTERS.toLocaleString()} characters
	</p>

	{#if problem}
		<ErrorNotice error={problem} />
	{/if}

	<!--
	FR-017, and the open question slice 0 left behind. The control is disabled while there is
	nothing to save, which makes the rejection message it would otherwise show unreachable — so
	slice 0 had a requirement about explaining refused input that no reader could ever see.

	Resolved as: preventing the error is fine, leaving the reader to guess is not. The control says
	why it cannot be used, next to itself, instead of waiting to be pressed so it can complain.
-->
	<button onclick={save} disabled={saving || pasted.trim() === ''}>
		{saving ? 'Saving…' : 'Save'}
	</button>
	{#if !saving && pasted.trim() === ''}
		<p class="subtitle why">Paste some text above and this becomes available.</p>
	{:else if length > MAXIMUM_CHARACTERS}
		<p class="subtitle why">
			That is {(length - MAXIMUM_CHARACTERS).toLocaleString()} characters over the limit. Saving will
			refuse it until you shorten it.
		</p>
	{/if}
</section>
