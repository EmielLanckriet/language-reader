<script lang="ts">
	import { browser, version } from '$app/environment';
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

	/**
	 * Ask a waiting worker which build it is, and only offer when it is genuinely a different one.
	 *
	 * A worker sitting in `waiting` was taken as proof that a new version was ready. It is not. On
	 * a fresh start with a network the browser fetches the new page and the new scripts straight
	 * from the server, so the reader is *already running* the new build while the previous worker
	 * is still nominally in control and the new one queues up behind it. The offer then names the
	 * version already on screen, which the reader reasonably reads as the notice being useless —
	 * and a notice that has been useless once is ignored when it matters.
	 *
	 * Reported on the phone, 2026-09-03: "I first update and then get a notification to accept the
	 * update." Exactly this.
	 *
	 * Falls back to offering. A worker that does not answer is either older than this check or
	 * unreachable, and staying silent about a real update is the worse of the two mistakes.
	 */
	async function isDifferentBuild(waiting: ServiceWorker): Promise<boolean> {
		return new Promise((resolve) => {
			const channel = new MessageChannel();
			const settle = (answer: boolean) => {
				clearTimeout(timer);
				channel.port1.onmessage = null;
				resolve(answer);
			};
			const timer = setTimeout(() => settle(true), 1500);

			channel.port1.onmessage = (event) => settle(event.data !== version);
			try {
				waiting.postMessage({ type: 'which-version' }, [channel.port2]);
			} catch {
				settle(true);
			}
		});
	}

	async function offerIfNew(waiting: ServiceWorker) {
		if (await isDifferentBuild(waiting)) ready = waiting;
	}

	$effect(() => {
		if (!browser) return;

		let stop = () => {};
		void serviceWorker().then((registration) => {
			if (!registration) return;

			// Already waiting when this page loaded: a version installed during an earlier visit.
			if (registration.waiting) void offerIfNew(registration.waiting);

			const found = () => {
				const installing = registration.installing;
				if (!installing) return;
				const check = () => {
					// `installed` is the state a worker reaches when it is ready and waiting. Only
					// then is there anything to offer; announcing an install in progress would
					// invite a tap that does nothing.
					if (installing.state === 'installed' && registration.waiting) {
						void offerIfNew(registration.waiting);
					}
				};
				installing.addEventListener('statechange', check);
				check();
			};

			registration.addEventListener('updatefound', found);
			found();

			// The new worker has taken over. Reloading here rather than immediately after asking it
			// to activate: until control actually changes, a reload would just re-run the old one.
			//
			// **Only when a worker is being replaced, though.** `controllerchange` fires for two
			// different events and only one of them is an update. On a first visit the page starts
			// with no controller, the worker installs, and `clients.claim()` gives it the page it
			// was installed from — which is deliberate and right (see service-worker.ts), but is
			// not an update and there is nothing to reload for. Reloading anyway threw away
			// whatever the reader had typed in the first moments of their first ever visit.
			// Measured at 614 ms after the paste box appeared, which is well inside the time it
			// takes to paste something (T093, research.md R21).
			//
			// So the question is whether this page was *already* controlled. If it was, control
			// changing means a different worker now serves it and the code running here is stale.
			// If it was not, this is the first install and the page is already current.
			const wasControlled = navigator.serviceWorker.controller !== null;
			const took = () => {
				if (wasControlled) window.location.reload();
			};
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
