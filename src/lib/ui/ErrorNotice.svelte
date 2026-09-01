<script lang="ts">
	import { resolve } from '$app/paths';
	import { RejectedInput } from '$lib/content/types';
	import { StorageFailure } from '$lib/storage/repository';

	/**
	 * Showing a failure with enough detail to act on (FR-022).
	 *
	 * Three kinds, distinguished on purpose, because they call for different responses and a
	 * reader who cannot tell them apart cannot do anything useful:
	 *
	 *   - a refused input is the reader's to fix, and is not really a failure
	 *   - a storage failure means the data may not be safe, which is worth alarm
	 *   - anything else is a bug, and the thing to do is read the diagnostics
	 *
	 * "Something went wrong" fails this requirement, and so does a blank screen. On Android there
	 * are no developer tools to fall back on, so an error the reader cannot read costs a round
	 * trip to another device.
	 */
	let { error, onretry }: { error: unknown; onretry?: () => void } = $props();

	const kind = $derived(
		error instanceof RejectedInput
			? 'input'
			: error instanceof StorageFailure
				? 'storage'
				: 'unexpected'
	);

	const heading = $derived(
		{
			input: 'That input was not accepted',
			storage: 'Storage problem',
			unexpected: 'Something failed unexpectedly'
		}[kind]
	);

	const guidance = $derived(
		{
			input: 'Nothing was saved, and nothing was lost. Adjust the text and try again.',
			storage:
				'Your saved reading may not be safe. Check the diagnostics below before saving more.',
			unexpected: 'This is a bug. The diagnostics record has the details.'
		}[kind]
	);

	const detail = $derived(error instanceof Error ? error.message : String(error));
</script>

<div class="notice problem" role="alert">
	<p class="heading">{heading}</p>
	<p class="detail">{detail}</p>
	<p class="guidance">{guidance}</p>

	<div class="actions">
		{#if onretry}
			<button class="secondary" onclick={onretry}>Try again</button>
		{/if}
		{#if kind !== 'input'}
			<a class="tap link" href={resolve('/diagnostics')}>Diagnostics</a>
		{/if}
	</div>
</div>

<style>
	.heading {
		margin: 0 0 0.35rem;
		font-weight: 600;
	}

	.detail {
		margin: 0 0 0.5rem;
		/* The actual message, verbatim. Wrapped rather than truncated: the useful part of an
		   error is often at the end. */
		word-break: break-word;
		font-family: ui-monospace, monospace;
		font-size: 0.85rem;
	}

	.guidance {
		margin: 0;
		color: var(--muted);
	}

	.actions {
		display: flex;
		gap: 0.75rem;
		align-items: center;
		margin-top: 0.75rem;
		flex-wrap: wrap;
	}

	.link {
		display: inline-flex;
		align-items: center;
		color: var(--accent);
	}
</style>
