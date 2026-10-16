<script lang="ts">
	import { resolve } from '$app/paths';
	import { session } from '$lib/storage/session';
	import { activeAnalyzer } from '$lib/analyzer/active';
	import {
		arrange,
		download,
		scoreText,
		search,
		subtitleText,
		type Candidate
	} from '$lib/content/find';
	import { newFromTermux } from '$lib/media/termux';
	import { videoDocument } from '$lib/media/store';
	import StartTermux from '$lib/ui/StartTermux.svelte';

	/**
	 * Find videos (spec 015, issue #11): YouTube results scored as the library scores a document,
	 * through the Termux service. Nothing here is written to the reader's history (FR-012).
	 */

	const BAR_KEY = 'reader.find.bar';
	const RECENT_KEY = 'reader.find.recent';

	function stored<T>(key: string, fallback: T): T {
		try {
			const raw = localStorage.getItem(key);
			return raw === null ? fallback : (JSON.parse(raw) as T);
		} catch {
			return fallback;
		}
	}
	function keep(key: string, value: unknown) {
		try {
			localStorage.setItem(key, JSON.stringify(value));
		} catch {
			// A convenience only: losing it costs a default.
		}
	}

	let query = $state('');
	let recent = $state<string[]>(stored(RECENT_KEY, []));
	let percent = $state<number>(stored(BAR_KEY, 90));
	let candidates = $state<Candidate[]>([]);
	let searching = $state(false);
	let problem = $state<'unreachable' | 'rate-limited' | 'failed' | null>(null);
	let message = $state<string | undefined>();
	/** Videos already in the library or under New from Termux, and those just handed to Termux. */
	let present = $state(new Set<string>());
	let downloading = $state(new Set<string>());
	let run = 0;

	const groups = $derived(arrange(candidates, percent / 100));

	function setBar(value: number) {
		percent = Math.min(99, Math.max(70, Math.round(value)));
		keep(BAR_KEY, percent);
	}

	function update(id: string, change: Partial<Candidate>) {
		candidates = candidates.map((c) => (c.id === id ? { ...c, ...change } : c));
	}

	async function fetchAndScore(candidate: Candidate, mine: number) {
		update(candidate.id, { state: 'fetching', problem: undefined });
		const found = await subtitleText(candidate.id);
		if (mine !== run) return;
		if (!found.ok) {
			if (found.status === 'unreachable') problem = 'unreachable';
			update(candidate.id, {
				state: found.status === 'rate-limited' ? 'rate-limited' : 'failed',
				problem: found.message
			});
			return;
		}
		if (!found.value) return update(candidate.id, { state: 'no-chinese' });
		const { repository } = await session();
		const score = await scoreText(found.value.text, await activeAnalyzer(), repository);
		if (mine !== run) return;
		update(candidate.id, { state: 'scored', automatic: found.value.automatic, score });
	}

	async function find(words = query) {
		const text = words.trim();
		if (!text) return;
		query = text;
		const mine = ++run;
		problem = null;
		message = undefined;
		candidates = [];
		searching = true;
		recent = [text, ...recent.filter((q) => q !== text)].slice(0, 5);
		keep(RECENT_KEY, recent);
		try {
			const found = await search(text);
			if (mine !== run) return;
			if (!found.ok) {
				problem = found.status;
				message = found.message;
				return;
			}
			candidates = found.value.map((c) => ({ ...c, state: 'fetching' as const }));
			const jobs = await newFromTermux();
			const listed = new Set(
				jobs === 'unreachable' ? [] : jobs.map((job) => (job as { id?: string }).id ?? '')
			);
			const inLibrary = await Promise.all(
				candidates.map(async (c) =>
					(await videoDocument(c.id)) !== undefined || listed.has(c.id) ? c.id : ''
				)
			);
			present = new Set(inLibrary.filter(Boolean));
			// One at a time: the service fetches politely, and results show as they come (FR-006).
			for (const candidate of candidates) {
				if (mine !== run || problem === 'unreachable') break;
				await fetchAndScore(candidate, mine);
			}
		} finally {
			if (mine === run) searching = false;
		}
	}

	async function choose(candidate: Candidate) {
		downloading = new Set([...downloading, candidate.id]);
		if (!(await download(candidate.url))) {
			downloading = new Set([...downloading].filter((id) => id !== candidate.id));
			problem = 'unreachable';
		}
	}

	function minutes(seconds: number | undefined) {
		if (!seconds) return '';
		const m = Math.round(seconds / 60);
		return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
	}
</script>

<p><a href={resolve('/')}>← Library</a></p>
<h1>Find videos</h1>
<p class="lede">
	YouTube videos ranked by how much of them you know and how many of your due words they use. Only
	their subtitles are fetched, through Termux.
</p>

<form
	class="search"
	onsubmit={(event) => {
		event.preventDefault();
		void find();
	}}
>
	<input
		type="search"
		bind:value={query}
		placeholder="e.g. Chinese comprehensible input"
		aria-label="Search YouTube"
	/>
	<button type="submit" disabled={!query.trim()}>Search</button>
</form>
{#if recent.length > 0}
	<p class="recent">
		Recent:
		{#each recent as q (q)}<button class="link" onclick={() => find(q)}>{q}</button>{/each}
	</p>
{/if}

<label class="bar">
	Known at least {percent} %
	<input
		type="range"
		min="70"
		max="99"
		value={percent}
		oninput={(event) => setBar(Number(event.currentTarget.value))}
	/>
</label>

{#if problem === 'unreachable'}
	<p class="notice" role="status">
		Termux isn't answering, so nothing can be searched. <StartTermux onstarted={() => find()} />
	</p>
{:else if problem === 'rate-limited'}
	<p class="notice" role="status">YouTube asked to slow down. Try again in a few minutes.</p>
{:else if problem === 'failed'}
	<p class="notice" role="status">The search failed{message ? `: ${message}` : ''}.</p>
{/if}

{#snippet result(candidate: Candidate)}
	<li class="result">
		<div class="title">{candidate.title}</div>
		<div class="meta">
			{candidate.channel}{candidate.duration ? ` · ${minutes(candidate.duration)}` : ''}
			{#if candidate.automatic}· automatic subtitles{/if}
		</div>
		{#if candidate.score}
			<div class="figures">
				<strong>{Math.round((candidate.score.known ?? 0) * 1000) / 10} % known</strong>
				· {candidate.score.neverMet} never met
				{#if candidate.score.due.length > 0}
					· due: <span lang="zh-Hans">{candidate.score.due.join(' ')}</span>
				{:else}· no due words{/if}
			</div>
		{:else if candidate.state === 'fetching'}
			<div class="meta">Fetching its subtitles…</div>
		{:else if candidate.state === 'rate-limited'}
			<div class="meta">
				YouTube asked to slow down.
				<button class="link" onclick={() => fetchAndScore(candidate, run)}>Try again</button>
			</div>
		{:else if candidate.state === 'failed'}
			<div class="meta">
				Couldn't fetch its subtitles{candidate.problem ? `: ${candidate.problem}` : ''}.
				<button class="link" onclick={() => fetchAndScore(candidate, run)}>Try again</button>
			</div>
		{/if}
		{#if present.has(candidate.id)}
			<div class="action">In your library</div>
		{:else if downloading.has(candidate.id)}
			<div class="action">
				Downloading: it will show under <a href={resolve('/')}>New from Termux</a>
			</div>
		{:else}
			<button class="action" onclick={() => choose(candidate)}>Download</button>
		{/if}
	</li>
{/snippet}

{#if candidates.length > 0}
	<section aria-label="Videos that fit">
		<h2>Known at least {percent} % ({groups.fits.length})</h2>
		{#if groups.fits.length === 0 && !searching}<p class="meta">None yet.</p>{/if}
		<ul>
			{#each groups.fits as candidate (candidate.id)}{@render result(candidate)}{/each}
		</ul>
	</section>
	{#if groups.pending.length > 0}
		<section aria-label="Still to score">
			<h2>Still to score ({groups.pending.length})</h2>
			<ul>
				{#each groups.pending as candidate (candidate.id)}{@render result(candidate)}{/each}
			</ul>
		</section>
	{/if}
	{#if groups.below.length > 0}
		<details>
			<summary>Below {percent} % known ({groups.below.length})</summary>
			<ul>
				{#each groups.below as candidate (candidate.id)}{@render result(candidate)}{/each}
			</ul>
		</details>
	{/if}
	{#if groups.noChinese.length > 0}
		<details>
			<summary>No Chinese subtitles ({groups.noChinese.length})</summary>
			<ul>
				{#each groups.noChinese as candidate (candidate.id)}{@render result(candidate)}{/each}
			</ul>
		</details>
	{/if}
{:else if searching}
	<p class="meta">Searching YouTube…</p>
{/if}

<style>
	.search {
		display: flex;
		gap: 0.5rem;
	}
	.search input {
		flex: 1;
		min-width: 0;
	}
	.recent {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.75rem;
		font-size: 0.9rem;
	}
	.bar {
		display: flex;
		flex-direction: column;
		margin: 0.75rem 0;
	}
	ul {
		list-style: none;
		padding: 0;
	}
	.result {
		padding: 0.6rem 0;
		border-bottom: 1px solid var(--rule);
	}
	.title {
		font-weight: 600;
	}
	.meta,
	.figures {
		font-size: 0.9rem;
		color: var(--muted);
	}
	.figures {
		color: inherit;
		margin-top: 0.2rem;
	}
	.action {
		margin-top: 0.4rem;
		font-size: 0.9rem;
	}
	.notice {
		padding: 0.5rem 0.75rem;
		border-radius: 0.5rem;
		background: var(--accent-soft);
	}
	details {
		margin-top: 1rem;
	}
</style>
