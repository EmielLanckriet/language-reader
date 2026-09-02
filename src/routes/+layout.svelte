<script lang="ts">
	import { browser } from '$app/environment';
	import '$lib/ui/app.css';
	import InstallOffer from '$lib/ui/InstallOffer.svelte';
	import { serviceWorker } from '$lib/ui/registerServiceWorker';

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
	});
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
	<!-- UpdateOffer and ReadOnlyNotice mount here as their stories land. -->
</div>

<main>
	{@render children()}
</main>
