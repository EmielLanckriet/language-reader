<script lang="ts">
	import { browser } from '$app/environment';
	import { serviceWorker } from '$lib/ui/registerServiceWorker';

	/**
	 * Telling the reader a new version is ready, and moving to it only when they say so.
	 *
	 * FR-009 needs no code at all, and that is worth knowing rather than discovering: a newly
	 * installed service worker enters `waiting` and stays there. The running application keeps the
	 * version it started with because nothing takes it away. What this component adds is the *offer*
	 * — FR-010 — and the one message that activates the waiting worker.
	 *
	 * An explicit control rather than automatic adoption is a staged decision, recorded in the spec
	 * under Anticipated Changes. While the application is deployed several times an hour, knowing
	 * exactly when a version landed is diagnostic information worth a tap. Once that stops being
	 * interesting it becomes automatic on the next fresh start.
	 */

	let ready = $state<ServiceWorker | undefined>(undefined);
	let moving = $state(false);

	$effect(() => {
		if (!browser) return;

		let stop = () => {};
		void serviceWorker().then((registration) => {
			if (!registration) return;

			// Already waiting when this page loaded: a version installed during an earlier visit.
			if (registration.waiting) ready = registration.waiting;

			const found = () => {
				const installing = registration.installing;
				if (!installing) return;
				const check = () => {
					// `installed` is the state a worker reaches when it is ready and waiting. Only
					// then is there anything to offer; announcing an install in progress would
					// invite a tap that does nothing.
					if (installing.state === 'installed' && registration.waiting) {
						ready = registration.waiting;
					}
				};
				installing.addEventListener('statechange', check);
				check();
			};

			registration.addEventListener('updatefound', found);
			found();

			// The new worker has taken over. Reloading here rather than immediately after asking it
			// to activate: until control actually changes, a reload would just re-run the old one.
			const took = () => window.location.reload();
			navigator.serviceWorker.addEventListener('controllerchange', took);

			stop = () => {
				registration.removeEventListener('updatefound', found);
				navigator.serviceWorker.removeEventListener('controllerchange', took);
			};
		});
		return () => stop();
	});

	function move() {
		moving = true;
		ready?.postMessage({ type: 'skip-waiting' });
	}
</script>

{#if ready}
	<div class="notice">
		<p><strong>A new version is ready.</strong> Your library and your marks are not affected.</p>
		<div class="actions">
			<button onclick={move} disabled={moving}>
				{moving ? 'Updating…' : 'Update now'}
			</button>
		</div>
	</div>
{/if}
