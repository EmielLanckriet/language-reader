<script lang="ts">
	import type { DocumentSummary } from '$lib/storage/repository';
	import type { Shares, WordCounts } from '$lib/domain/shares';
	import { recallBand } from '$lib/domain/memory';

	/** A document's picture, titles and figures: a library row, and the head of its own page (#31). */
	let {
		document,
		video,
		picture,
		english,
		watched,
		share,
		counts,
		understood
	}: {
		document: DocumentSummary;
		video: boolean;
		picture?: string;
		english?: string;
		/** How far the video was played, 0–1. */
		watched?: number;
		share?: Shares;
		counts?: WordCounts;
		/** Predicted comprehension, 0–1 (#13). */
		understood?: number;
	} = $props();

	const percent = (part: number) => `${Math.round(part * 100)}%`;
	// Coloured by the band of the figure shown, so "~95%" never wears the 85–95 % colour.
	const band = $derived(
		understood === undefined ? undefined : recallBand(Math.round(understood * 100) / 100)
	);
</script>

{#if video}
	<span class="frame">
		{#if picture}
			<img class="picture" src={picture} alt="" />
		{:else}
			<span class="picture placeholder" aria-hidden="true"
				><span>文</span><span class="play-symbol">▶</span></span
			>
		{/if}
		{#if watched}
			<span class="track" title={`Watched to ${percent(watched)}`}>
				<span class="watched" style:width={percent(watched)}></span>
			</span>
		{/if}
	</span>
{/if}
<span class="text">
	<strong class="document-title">{document.title}</strong>
	{#if english}
		<span class="english-title">{english}</span>
	{/if}
	<span class="meta">
		{document.characterCount.toLocaleString()} characters
		{#if share}
			· <span class="known">{percent(share.known)} known</span> ·
			<span class="learning">{percent(share.learning)} learning</span> ·
			<span class="fresh">{percent(share.fresh)} new</span>
		{/if}
	</span>
	{#if share}
		<span class="shares" aria-hidden="true">
			<span class="known" style:width={percent(share.known)}></span>
			<span class="learning" style:width={percent(share.learning)}></span>
			<span class="fresh" style:width={percent(share.fresh)}></span>
		</span>
	{/if}
	{#if understood !== undefined || (counts && (counts.due > 0 || counts.fresh > 0))}
		<span class="meta counts">
			{#if understood !== undefined}
				<span class="understood band-{band}">~{percent(understood)} understood</span>
				{#if counts && (counts.due > 0 || counts.fresh > 0)}·{/if}
			{/if}
			{#if counts && counts.due > 0}
				<span class="due">{counts.due} due come up ({counts.dueOccurrences}×)</span>
			{/if}
			{#if counts && counts.due > 0 && counts.fresh > 0}·{/if}
			{#if counts && counts.fresh > 0}
				{counts.fresh} new {counts.fresh === 1 ? 'word' : 'words'}{#if counts.freshRecurring > 0}, {counts.freshRecurring}
					recur{/if}
			{/if}
		</span>
	{/if}
</span>
