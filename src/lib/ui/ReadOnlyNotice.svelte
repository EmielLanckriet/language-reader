<script lang="ts">
	import { browser } from '$app/environment';
	import { session } from '$lib/storage/session';
	import type { Availability } from '$lib/storage/availability';
	import { explain } from '$lib/storage/availability';

	/**
	 * What the reader is told when this copy cannot save (FR-013, FR-015).
	 *
	 * The wording comes from `explain()` in availability.ts rather than from here, so that FR-013's
	 * requirement — that "another copy has it" and "this device will not" ask for *opposite* things,
	 * and that an unknown cause says so — is asserted by a test rather than reviewed by eye.
	 *
	 * The retry control is the on-demand half of FR-015. The other half needs no control at all:
	 * trying to mark a word attempts storage first, so a reader who simply carries on is usually
	 * never told about any of this.
	 */

	let availability = $state<Availability>({ kind: 'acquiring', remembering: false });
	let retrying = $state(false);

	$effect(() => {
		if (!browser) return;
		let stop = () => {};
		void session().then(({ repository }) => {
			stop = repository.watch((state) => {
				availability = state;
				if (state.kind !== 'acquiring') retrying = false;
			});
		});
		return () => stop();
	});

	const refusal = $derived(
		availability.kind === 'refused' ? explain(availability.cause) : undefined
	);

	async function again() {
		retrying = true;
		const { repository } = await session();
		repository.retry();
	}
</script>

{#if refusal}
	<div class="notice warning" role="alert">
		<p><strong>{refusal.headline}</strong> {refusal.action}</p>
		<div class="actions">
			<button onclick={again} disabled={retrying}>
				{retrying ? 'Trying…' : 'Try again'}
			</button>
		</div>
		{#if refusal.detail}
			<p class="detail">{refusal.detail}</p>
		{/if}
	</div>
{/if}
