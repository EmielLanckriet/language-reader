<script lang="ts">
	import { AVAILABLE_STATES } from '$lib/domain/state';

	/**
	 * The menu a tap opens (FR-006).
	 *
	 * A menu rather than a cycling tap, because FR-006a refuses to promise a small fixed number of
	 * states: cycling only works when the reader can predict what comes next, and it stops working
	 * the moment a fifth state exists. The states are read from configuration for the same reason,
	 * so adding one changes nothing here.
	 */
	let {
		word,
		current,
		onchoose,
		onclose
	}: {
		word: string;
		current: string | null;
		onchoose: (state: string) => void;
		onclose: () => void;
	} = $props();
</script>

<svelte:window
	onkeydown={(event) => {
		if (event.key === 'Escape') onclose();
	}}
/>

<!-- Clicking the backdrop dismisses. The button is the accessible way to do the same thing. -->
<div class="backdrop">
	<button class="dismiss" onclick={onclose} aria-label="Close without marking"></button>

	<div class="sheet" role="dialog" aria-modal="true" aria-label="Mark {word}">
		<p class="word" lang="zh">{word}</p>

		<div class="choices">
			{#each AVAILABLE_STATES as state (state.name)}
				<button
					class="choice"
					class:chosen={current === state.name}
					onclick={() => onchoose(state.name)}
				>
					<span class="swatch state-{state.name}"></span>
					{state.label}
				</button>
			{/each}
		</div>

		<button class="secondary cancel" onclick={onclose}>Cancel</button>
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 10;
		display: flex;
		align-items: flex-end;
		justify-content: center;
	}

	/* Covers the viewport behind the sheet. Not a target the reader aims at, so the 44px floor
	   that applies to real controls is irrelevant here. */
	.dismiss {
		position: absolute;
		inset: 0;
		width: 100%;
		min-width: 0;
		min-height: 0;
		background: rgba(0, 0, 0, 0.35);
		border: none;
		border-radius: 0;
		padding: 0;
	}

	/* Anchored to the bottom of the screen, where a thumb reaches without shifting grip. */
	.sheet {
		position: relative;
		width: 100%;
		max-width: 32rem;
		background: var(--paper);
		border-top-left-radius: 16px;
		border-top-right-radius: 16px;
		padding: 1rem 1rem calc(1rem + env(safe-area-inset-bottom));
		box-shadow: 0 -8px 30px rgba(0, 0, 0, 0.25);
	}

	.word {
		font-size: 2rem;
		text-align: center;
		margin: 0.25rem 0 1rem;
	}

	.choices {
		display: grid;
		gap: 0.5rem;
	}

	.choice {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
		background: transparent;
		color: var(--ink);
		border: 1px solid var(--rule);
		text-align: left;
		padding: 0.75rem 1rem;
	}

	.choice.chosen {
		border-color: var(--accent);
		border-width: 2px;
	}

	.swatch {
		width: 1rem;
		height: 1rem;
		border-radius: 50%;
		flex: none;
	}

	.swatch.state-unknown {
		background: var(--unknown);
	}
	.swatch.state-learning {
		background: var(--learning);
	}
	.swatch.state-known {
		background: var(--known);
	}
	.swatch.state-ignored {
		background: var(--ignored);
	}

	.cancel {
		width: 100%;
		margin-top: 0.75rem;
	}
</style>
