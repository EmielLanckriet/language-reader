<script lang="ts">
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import { session } from '$lib/storage/session';
	import { mediaDocuments } from '$lib/media/store';
	import type { DocumentSummary } from '$lib/storage/repository';
	import ErrorNotice from './ErrorNotice.svelte';
	import { describeError } from '$lib/diagnostics/describe';
	import { englishTitles, progressOf, sharesOf, thumbnailOf } from '$lib/media/cover';
	import type { Shares, WordCounts } from '$lib/domain/shares';

	/** Videos or pasted texts: a video is a document with media beside it (ADR-0018). */
	let {
		kind,
		empty,
		onloaded
	}: {
		kind: 'video' | 'text';
		/** Shown when this list is empty; told whether the whole library is. */
		empty: Snippet<[boolean]>;
		onloaded?: (all: number) => void;
	} = $props();

	let documents = $state<DocumentSummary[]>([]);
	let total = $state(0);
	let loading = $state(true);
	let problem = $state<unknown>(null);
	let shares = $state<Map<number, { shares: Shares; counts: WordCounts }>>(new Map());
	let english = $state<Record<number, string>>({});
	let pictures = $state<Record<number, string>>({});
	let progress = $state<Map<number, number>>(new Map());

	const percent = (share: number) => `${Math.round(share * 100)}%`;

	// The extras load after the list, each at its own pace: a slow one never holds the titles back.
	$effect(() => {
		const listed = documents;
		if (listed.length === 0) return;
		let stopped = false;
		let stopTitles = () => {};
		const urls: string[] = [];
		void sharesOf(listed.map((d) => d.id)).then((found) => !stopped && (shares = found));
		if (kind === 'video') {
			void progressOf(listed.map((d) => d.id)).then((found) => !stopped && (progress = found));
			void englishTitles(listed, (id, text) => {
				if (!stopped) english = { ...english, [id]: text };
			}).then((stop) => (stopped ? stop() : (stopTitles = stop)));
			void (async () => {
				for (const d of listed) {
					const picture = await thumbnailOf(d.id).catch(() => undefined);
					if (stopped) return;
					if (!picture) continue;
					const url = URL.createObjectURL(picture);
					urls.push(url);
					pictures = { ...pictures, [d.id]: url };
				}
			})();
		}
		return () => {
			stopped = true;
			stopTitles();
			for (const url of urls) URL.revokeObjectURL(url);
		};
	});

	async function load() {
		try {
			const { repository } = await session();
			// Waits for the storage lease rather than resolving empty without it: a library that
			// briefly showed nothing on every return to the foreground would look like a loss.
			const [all, videos] = await Promise.all([repository.listDocuments(), mediaDocuments()]);
			total = all.length;
			documents = all.filter((document) => videos.has(document.id) === (kind === 'video'));
			onloaded?.(total);
		} catch (error) {
			problem = error;
			try {
				await (await session()).repository.recordDiagnostic('storage', describeError(error));
			} catch {
				// The database is the thing that failed.
			}
		} finally {
			loading = false;
		}
	}

	// Read again whenever this copy gets the storage back, not only on mount: a copy that had the
	// lease taken while in the background would otherwise show what was true when it last looked.
	$effect(() => {
		let seen: string | undefined;
		let stop = () => {};
		void session().then(({ repository }) => {
			stop = repository.watch((state) => {
				if (state.kind !== 'holding' || seen === 'holding') {
					seen = state.kind;
					return;
				}
				seen = state.kind;
				void load();
			});
		});
		return () => stop();
	});
</script>

{#if problem}
	<ErrorNotice error={problem} />
{/if}
{#if loading}
	<p class="loading">Opening your library…</p>
{:else if documents.length === 0}
	{@render empty(total === 0)}
{:else}
	<ul class="library collection" class:video-collection={kind === 'video'}>
		{#each documents as document (document.id)}
			{@const share = shares.get(document.id)?.shares}
			{@const counts = shares.get(document.id)?.counts}
			<li>
				<a
					href={resolve('/read/[id]', { id: String(document.id) })}
					class:with-picture={kind === 'video'}
				>
					{#if kind === 'video'}
						{@const watched = progress.get(document.id)}
						<span class="frame">
							{#if pictures[document.id]}
								<img class="picture" src={pictures[document.id]} alt="" />
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
						{#if english[document.id]}
							<span class="english-title">{english[document.id]}</span>
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
						{#if counts && (counts.due > 0 || counts.fresh > 0)}
							<span class="meta counts">
								{#if counts.due > 0}
									<span class="due">{counts.due} due come up ({counts.dueOccurrences}×)</span>
								{/if}
								{#if counts.due > 0 && counts.fresh > 0}·{/if}
								{#if counts.fresh > 0}
									{counts.fresh} new {counts.fresh === 1
										? 'word'
										: 'words'}{#if counts.freshRecurring > 0}, {counts.freshRecurring}
										recur{/if}
								{/if}
							</span>
						{/if}
					</span>
				</a>
			</li>
		{/each}
	</ul>
{/if}
