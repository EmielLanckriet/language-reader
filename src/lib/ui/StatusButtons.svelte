<script lang="ts">
	/**
	 * Retire and Ignore for one word, with their undo (spec 019, FR-013, FR-014): in the word sheet
	 * and in Progress's word detail. Retire is offered on an active word; a word the reader retired
	 * shows it chosen, and tapping it again writes back the status before. Ignore likewise.
	 */
	import { session } from '$lib/storage/session';
	import type { Status } from '$lib/domain/status';

	let {
		lexemeId,
		onchanged
	}: {
		lexemeId: number;
		/** After the change is saved, with the word's new status. */
		onchanged?: (status: Status) => void;
	} = $props();

	let detail = $state<{ status: Status; byReader: boolean; before?: Status } | null>(null);
	let busy = $state(false);

	$effect(() => {
		const id = lexemeId;
		let stale = false;
		void session()
			.then(({ repository }) => repository.statusDetail(id))
			.then((found) => {
				if (!stale) detail = found;
			});
		return () => (stale = true);
	});

	const retired = $derived(detail?.status === 'retired' && detail.byReader);
	const ignored = $derived(detail?.status === 'ignored');

	async function set(status: Status) {
		if (busy) return;
		busy = true;
		try {
			const { repository } = await session();
			await repository.setStatus(lexemeId, status);
			detail = await repository.statusDetail(lexemeId);
			onchanged?.(status);
		} finally {
			busy = false;
		}
	}
</script>

{#if detail}
	<div class="statuses">
		{#if detail.status === 'active' || retired}
			<button
				class="choice"
				class:chosen={retired}
				aria-pressed={retired}
				disabled={busy}
				onclick={() => set(retired ? (detail!.before ?? 'retired') : 'retired')}
			>
				{retired ? 'Retired ✓ · tap to undo' : 'Retire'}
				<small>off Cards, still remembered</small>
			</button>
		{/if}
		<button
			class="choice"
			class:chosen={ignored}
			aria-pressed={ignored}
			disabled={busy}
			onclick={() => set(ignored ? (detail!.before ?? 'retired') : 'ignored')}
		>
			{ignored ? 'Ignored ✓ · tap to undo' : 'Ignore'}
			<small>never a card or drilled</small>
		</button>
	</div>
{/if}

<style>
	.statuses {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}
	.choice {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		min-height: 38px;
		min-width: 0;
		padding: 0.2rem 0.3rem;
		font-size: 0.8rem;
		background: transparent;
		color: var(--ink);
		border: 1px solid var(--rule);
	}
	.choice small {
		color: var(--muted);
		font-size: 0.7rem;
	}
	.choice.chosen {
		border-color: var(--accent);
		border-width: 2px;
	}
</style>
