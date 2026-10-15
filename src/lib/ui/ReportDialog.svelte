<script lang="ts">
	import { resolve } from '$app/paths';
	import { session } from '$lib/storage/session';
	import { VERIFICATION } from '$lib/media/service-address';
	import { runningVersion, describeVersion } from '$lib/ui/version';
	import {
		issueFrom,
		readToken,
		sectionText,
		sendIssue,
		REPOSITORY,
		type ReportDraft,
		type ReportState,
		type Section
	} from '$lib/report/report';

	let {
		screen,
		beforeopen
	}: {
		screen?: () => Record<string, string>;
		/** Run before the state is read: the reader pauses and saves what it recorded. */
		beforeopen?: () => Promise<unknown> | void;
	} = $props();

	let dialog = $state<HTMLDialogElement>();
	let draft = $state<ReportDraft>({
		kind: 'problem',
		title: '',
		description: '',
		include: { device: true, screen: true, failures: true, session: true }
	});
	let gathered = $state<ReportState | null>(null);
	let sending = $state(false);
	let outcome = $state<{ url: string } | { problem: string } | null>(null);
	let token = $state<string | null>(null);

	const sections: { key: Section; label: string }[] = [
		{ key: 'device', label: 'Build, device, storage' },
		{ key: 'screen', label: 'This screen' },
		{ key: 'failures', label: 'Recent failure records' },
		{ key: 'session', label: 'Latest session (kinds and timings, no words)' }
	];

	/** The state as it is now, when the dialog opens: the screen behind it is what is reported. */
	async function gather(): Promise<ReportState> {
		const running = runningVersion();
		const device: Record<string, string> = {
			Build: describeVersion(running),
			'Running since': running.since?.toISOString() ?? 'unknown',
			Reported: new Date().toISOString(),
			'User agent': navigator.userAgent,
			Viewport: `${innerWidth}×${innerHeight} at ${devicePixelRatio}×`,
			Installed: matchMedia('(display-mode: standalone)').matches ? 'yes' : 'no',
			Online: navigator.onLine ? 'yes' : 'no',
			'Cross-origin isolated': globalThis.crossOriginIsolated ? 'yes' : 'no'
		};
		if (VERIFICATION) device['Test reader'] = 'yes';
		const state: ReportState = {
			device,
			screen: { Route: location.pathname + location.search, ...screen?.() }
		};

		// Each part on its own: a report is most wanted when storage or the model will not answer.
		const settled = await Promise.allSettled([
			import('$lib/analyzer/active').then(({ activeAnalyzer }) => activeAnalyzer()),
			import('$lib/speech/model').then(({ REVISION }) => REVISION),
			within(session())
		]);
		const [analyzer, revision, opened] = settled;
		device['Word splitting'] =
			analyzer.status === 'fulfilled'
				? `${analyzer.value.name} · ${analyzer.value.version}`
				: 'unknown';
		device['Speech model'] =
			revision.status === 'fulfilled' ? revision.value.slice(0, 7) : 'unknown';
		if (opened.status === 'rejected') {
			device.Storage = 'did not open within 3 s';
			return state;
		}
		const { repository, persistence } = opened.value;
		const [failures, recent] = await Promise.allSettled([
			within(repository.readDiagnostics(5)),
			within(repository.recentEncounters())
		]);
		if (failures.status === 'fulfilled') state.failures = failures.value;
		if (recent.status === 'fulfilled') state.session = recent.value[0];
		// After the reads: on opening, the lease is usually still being acquired.
		let availability = '';
		repository.watch((now) => (availability = now.kind))();
		device.Storage = repository.refusal
			? `${availability}: ${repository.refusal.headline}`
			: availability;
		device['Persistent storage'] = persistence;
		return state;
	}

	function within<T>(work: Promise<T>): Promise<T> {
		return Promise.race([
			work,
			new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timed out')), 3000))
		]);
	}

	async function open() {
		token = readToken();
		outcome = null;
		gathered = null;
		dialog?.showModal();
		// Bounded: a save waits for the storage lease, and a report is most wanted when it is stuck.
		await within(Promise.resolve(beforeopen?.())).catch(() => {});
		gathered = await gather();
	}

	async function send() {
		if (!token || !gathered) return;
		sending = true;
		outcome = await sendIssue(token, issueFrom($state.snapshot(draft), gathered));
		sending = false;
		if ('url' in outcome) {
			draft.title = '';
			draft.description = '';
		}
	}
</script>

<button class="secondary" onclick={open}>Report a problem or idea</button>

<dialog bind:this={dialog} class="report" aria-label="Report a problem or idea">
	<form method="dialog" onsubmit={(event) => (event.preventDefault(), send())}>
		<h2>Report a problem or idea</h2>
		{#if outcome && 'url' in outcome}
			<p role="status">
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- an outside address -->
				Sent: <a href={outcome.url} target="_blank" rel="noreferrer">{outcome.url}</a>
			</p>
			<button type="button" onclick={() => dialog?.close()}>Close</button>
		{:else}
			<fieldset class="kind">
				<label><input type="radio" bind:group={draft.kind} value="problem" /> Problem</label>
				<label><input type="radio" bind:group={draft.kind} value="idea" /> Idea</label>
			</fieldset>
			<label>
				Title
				<input bind:value={draft.title} required />
			</label>
			<label>
				What happened, or what you would like
				<textarea bind:value={draft.description} rows="5"></textarea>
			</label>
			<p class="note">
				Goes to a public issue on {REPOSITORY}. Untick anything you would rather not send; titles
				and the words you looked up are never included.
			</p>
			{#if !gathered}
				<p class="note">Reading the app's state…</p>
			{:else}
				{#each sections as { key, label } (key)}
					{@const text = sectionText(key, gathered)}
					{#if text}
						<details>
							<summary>
								<label><input type="checkbox" bind:checked={draft.include[key]} /> {label}</label>
							</summary>
							<pre>{text}</pre>
						</details>
					{/if}
				{/each}
			{/if}
			{#if outcome && 'problem' in outcome}<p class="problem" role="alert">
					{outcome.problem}
				</p>{/if}
			{#if !token}
				<p class="problem">
					No GitHub token on this device yet. Add one in
					<a href={resolve('/diagnostics')} onclick={() => dialog?.close()}
						>More → Troubleshooting</a
					>.
				</p>
			{/if}
			<div class="actions">
				<button type="submit" disabled={!token || !gathered || sending}
					>{sending ? 'Sending…' : 'Send'}</button
				>
				<button type="button" class="secondary" onclick={() => dialog?.close()}>Cancel</button>
			</div>
		{/if}
	</form>
</dialog>

<style>
	.report {
		width: min(36rem, calc(100vw - 2rem));
		max-height: calc(100dvh - 2rem);
		border: 1px solid var(--rule);
		border-radius: 8px;
		background: var(--surface);
		color: var(--ink);
		padding: 1rem;
	}
	.report::backdrop {
		background: rgb(0 0 0 / 0.4);
	}
	h2 {
		font-size: 1.1rem;
		margin: 0 0 0.75rem;
	}
	form > label {
		display: grid;
		gap: 0.25rem;
		margin-bottom: 0.75rem;
	}
	input:not([type]) {
		font: inherit;
		min-height: 44px;
		padding: 0 0.75rem;
		border: 1px solid var(--rule);
		border-radius: 8px;
		background: var(--paper);
		color: var(--ink);
	}
	input:not([type]),
	textarea {
		width: 100%;
		box-sizing: border-box;
	}
	textarea {
		min-height: 6rem;
	}
	.kind {
		border: none;
		padding: 0;
		margin: 0 0 0.75rem;
		display: flex;
		gap: 1.25rem;
	}
	.note {
		font-size: 0.85rem;
		color: var(--muted);
	}
	details {
		border-top: 1px solid var(--rule);
		padding: 0.4rem 0;
	}
	pre {
		font-size: 0.75rem;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		max-height: 12rem;
		overflow: auto;
	}
	.problem {
		color: var(--danger);
	}
	.actions {
		display: flex;
		gap: 0.75rem;
		margin-top: 0.75rem;
	}
</style>
