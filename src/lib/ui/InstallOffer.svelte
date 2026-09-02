<script lang="ts">
	import { browser } from '$app/environment';

	/**
	 * An offer to install the application, shown only while the device says it can be.
	 *
	 * FR-003a exists because the alternative is expecting the reader to find "Install app" inside a
	 * browser menu, and a reader who does not know the option exists will not go looking for it.
	 *
	 * FR-003b is the more useful half. A browser fires `beforeinstallprompt` **only once the
	 * application genuinely qualifies** — manifest served and parsed, both required icon sizes
	 * present, a service worker with a fetch handler, a secure origin. So this control appearing is
	 * a live assertion that installation is correctly set up, and its absence on Android Chrome is
	 * a defect rather than a preference. Slice 0's failure was exactly that nothing qualified and
	 * nothing said so, which was discovered only by tapping an icon and getting a browser.
	 */

	// Not in the DOM typings: `beforeinstallprompt` is Chromium-only and has never been
	// standardised. Declared here rather than reached for with `any`, so what we rely on is legible.
	interface BeforeInstallPromptEvent extends Event {
		prompt(): Promise<void>;
		readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
	}

	let offer = $state<BeforeInstallPromptEvent | undefined>(undefined);
	let installed = $state(false);

	$effect(() => {
		if (!browser) return;

		// Already running as an installed application: there is nothing to offer.
		installed = window.matchMedia('(display-mode: standalone)').matches;

		function held(event: Event) {
			// Without this the browser shows its own prompt on its own schedule, which is usually
			// not while the reader is looking at the thing it would install.
			event.preventDefault();
			offer = event as BeforeInstallPromptEvent;
		}

		function done() {
			installed = true;
			offer = undefined;
		}

		window.addEventListener('beforeinstallprompt', held);
		window.addEventListener('appinstalled', done);
		return () => {
			window.removeEventListener('beforeinstallprompt', held);
			window.removeEventListener('appinstalled', done);
		};
	});

	async function install() {
		const pending = offer;
		if (!pending) return;

		// The event is single-use whatever the reader chooses, so it is dropped either way. If they
		// dismiss it, the browser may offer another one later; holding a spent event would leave a
		// button that silently does nothing.
		offer = undefined;
		await pending.prompt();
	}
</script>

{#if offer && !installed}
	<div class="notice">
		<p>
			<strong>Add this to your home screen</strong> to open it without the browser, and offline.
		</p>
		<div class="actions">
			<button onclick={install}>Install</button>
		</div>
	</div>
{/if}
