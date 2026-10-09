<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { session } from '$lib/storage/session';
	import type { DocumentSummary } from '$lib/storage/repository';
	import { loadMedia, type StoredMedia } from '$lib/media/store';
	import { englishTitles, progressOf, sharesOf, thumbnailOf } from '$lib/media/cover';
	import type { Shares, WordCounts } from '$lib/domain/shares';
	import DocumentCard from '$lib/ui/DocumentCard.svelte';
	import DocumentSettings from '$lib/ui/DocumentSettings.svelte';
	import ErrorNotice from '$lib/ui/ErrorNotice.svelte';

	/**
	 * A document's own page (#31): every way into a video or text comes here first, with its figures,
	 * Play, its subtitles and Delete. The player keeps its own subtitle menus and Delete as well.
	 */
	let summary = $state<DocumentSummary | null>(null);
	let media = $state<StoredMedia | null>(null);
	let loading = $state(true);
	let problem = $state<unknown>(null);
	let figures = $state<{ shares: Shares; counts: WordCounts } | undefined>();
	let watched = $state<number | undefined>();
	let picture = $state<string | undefined>();
	let english = $state<string | undefined>();

	const id = $derived(Number(page.params.id));
	const video = $derived(media !== null);

	$effect(() => {
		const wanted = id;
		let stopped = false;
		let stopTitle = () => {};
		let url: string | undefined;
		loading = true;
		problem = null;
		void (async () => {
			try {
				const { repository } = await session();
				const [all, found] = await Promise.all([repository.listDocuments(), loadMedia(wanted)]);
				if (stopped) return;
				summary = all.find((d) => d.id === wanted) ?? null;
				media = found;
			} catch (error) {
				if (!stopped) problem = error;
				return;
			} finally {
				if (!stopped) loading = false;
			}
			const shown = summary;
			if (!shown) return;
			// The figures load after the page, each at its own pace, as in the library.
			void sharesOf([wanted]).then((all) => !stopped && (figures = all.get(wanted)));
			if (!media) return;
			void progressOf([wanted]).then((all) => !stopped && (watched = all.get(wanted)));
			void thumbnailOf(wanted).then((blob) => {
				if (stopped || !blob) return;
				url = URL.createObjectURL(blob);
				picture = url;
			});
			void englishTitles([shown], (_, text) => !stopped && (english = text)).then((stop) =>
				stopped ? stop() : (stopTitle = stop)
			);
		})();
		return () => {
			stopped = true;
			stopTitle();
			if (url) URL.revokeObjectURL(url);
		};
	});
</script>

{#if video}
	<a class="back" href={resolve('/')}>← Videos</a>
{:else}
	<a class="back" href={resolve('/texts')}>← Texts</a>
{/if}

{#if loading}
	<p class="loading">Opening…</p>
{:else if problem}
	<ErrorNotice error={problem} />
{:else if !summary}
	<p class="empty">This document is no longer in your library.</p>
{:else}
	<div class="library collection">
		<div class="card" class:with-picture={video}>
			<DocumentCard
				document={summary}
				{video}
				{picture}
				{english}
				{watched}
				share={figures?.shares}
				counts={figures?.counts}
			/>
		</div>
	</div>
	<a class="play" href={resolve('/read/[id]', { id: String(summary.id) })}>
		{video ? (watched ? 'Continue watching' : 'Play') : 'Read'}
	</a>
	<DocumentSettings document={summary} bind:media reopen="/document/[id]" />
{/if}

<style>
	.collection {
		margin-top: 0.5rem;
	}
	.card {
		border: 1px solid var(--rule);
		border-radius: 18px;
		overflow: hidden;
		background: var(--surface);
	}
	.play {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 48px;
		margin-top: 1rem;
		border-radius: 12px;
		background: var(--accent);
		color: var(--on-accent);
		font-weight: 600;
		text-decoration: none;
	}
</style>
