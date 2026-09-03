<script lang="ts">
	import { browser } from '$app/environment';
	import '$lib/ui/app.css';
	import InstallOffer from '$lib/ui/InstallOffer.svelte';
	import UpdateOffer from '$lib/ui/UpdateOffer.svelte';
	import ReadOnlyNotice from '$lib/ui/ReadOnlyNotice.svelte';
	import { serviceWorker } from '$lib/ui/registerServiceWorker';
	import { session } from '$lib/storage/session';
	import { sweepStaleDocuments } from '$lib/storage/sweep';
	import { activeAnalyzer } from '$lib/analyzer/active';
	import { describeError } from '$lib/diagnostics/describe';

	let { children } = $props();

	$effect(() => {
		if (!browser) return;

		// Tells app.html's fallback that the application arrived after all. Both halves matter: the
		// flag stops the notice appearing later, and removing the element handles a start slower
		// than app.html's timer, where the notice is already visible and is now wrong.
		(window as unknown as { __booted?: boolean }).__booted = true;
		document.getElementById('not-downloaded')?.remove();

		// Registered here rather than in app.html so it happens once the application is running,
		// and so the registration is available to the parts of the interface that need it.
		void serviceWorker();

		// Catch up the documents the reader has not opened (FR-016). Started once, from the layout,
		// because it is about the library rather than about any screen — and starting it per screen
		// would mean several sweeps competing for the same storage.
		//
		// Deliberately late and deliberately quiet. It waits for the first idle moment so it never
		// competes with the work of actually opening the application, and it stops the moment the
		// page stops being visible, because that is when this copy gives up the storage lease
		// (FR-018, FR-019).
		void startCatchUp();
	});

	async function startCatchUp() {
		await whenIdle();
		if (!browser || document.visibilityState !== 'visible') return;

		try {
			const { repository } = await session();
			await sweepStaleDocuments(
				repository,
				activeAnalyzer,
				() => document.visibilityState === 'visible',
				(documentId, error) =>
					void repository.recordDiagnostic(
						'analysis',
						`Could not re-segment document ${documentId}: ${describeError(error)}`
					)
			);
		} catch {
			// Nothing here is worth telling the reader about. The sweep is the application catching
			// up with itself; if it cannot, every document still re-derives the moment it is opened.
		}
	}

	/** The first moment nothing more urgent is happening. */
	function whenIdle(): Promise<void> {
		return new Promise((resolve) => {
			const idle = (window as unknown as { requestIdleCallback?: (cb: () => void) => void })
				.requestIdleCallback;
			if (idle) idle(() => resolve());
			else setTimeout(resolve, 2000);
		});
	}
</script>

<svelte:head>
	<title>Reader</title>
</svelte:head>

<!--
	One region, above the page, where the application says things about itself rather than about
	what the reader is reading: that it can be installed, that a new version is ready, that it
	cannot save right now.

	It exists as a single slot because three separate pieces of work each want to put a notice
	here, and three separate edits to this file would be three chances to disagree about where
	notices go. The order is fixed and deliberate — the read-only notice is last so that it sits
	closest to the content it is about, and it is the one that matters most.

	Nothing renders when there is nothing to say, and the region itself carries no styling of its
	own — so with no notices it occupies no space. A permanently occupied strip at the top of a
	reading application would be worse than any of the notices are good.
-->
<div class="notices">
	<InstallOffer />
	<UpdateOffer />
	<ReadOnlyNotice />
</div>

<main>
	{@render children()}
</main>
