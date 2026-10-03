<script lang="ts">
	import { resolve } from '$app/paths';
	import { session } from '$lib/storage/session';
	import type { TuningDataset, TuningReport } from '$lib/domain/tuning';
	import ErrorNotice from '$lib/ui/ErrorNotice.svelte';

	let analysis = $state<{ data: TuningDataset; report: TuningReport } | null>(null);
	let problem = $state<unknown>(null);
	let busy = $state(false);
	const report = $derived(analysis?.report);
	const percent = (n: number | null) => (n === null ? '—' : `${(n * 100).toFixed(1)}%`);
	const reasons: Record<string, string> = {
		'no-prior-memory': 'No earlier memory to predict from',
		'undated-seed': 'Imported memory without a known review date',
		'short-delay': 'Less than 24 hours since the previous update',
		'ambiguous-clock': 'Multiple devices or a clock that went backwards',
		'not-replayed-by-rule': 'Ignored word or review predating its imported memory'
	};

	async function load() {
		if (busy) return;
		busy = true;
		problem = null;
		try {
			const { repository } = await session();
			analysis = await repository.tuningAnalysis();
		} catch (error) {
			problem = error;
		} finally {
			busy = false;
		}
	}
	$effect(() => {
		// Initial load has no reactive dependencies; busy belongs only to manual refreshes.
		void Promise.resolve().then(load);
	});

	function download() {
		if (!analysis) return;
		const url = URL.createObjectURL(
			new Blob([JSON.stringify(analysis.data, null, 2)], { type: 'application/json' })
		);
		const link = document.createElement('a');
		link.href = url;
		link.download = 'reader-fsrs-data.json';
		link.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}
</script>

<p><a href={resolve('/cards')}>← Cards</a></p>
<h1>Learning data</h1>
<p>
	The goal is to understand words after a delay, in new contexts. For now, explicit card answers
	provide the clearest measure we have.
</p>
<p>
	Rate what you recalled <strong>before Show</strong>: Again means you needed the answer; Hard, Good
	and Easy mean you remembered. Attentive encounters still influence your schedule, but they do not
	count as measured recall here.
</p>

{#if problem}
	<ErrorNotice error={problem} onretry={load} />
{:else if !report}
	<p role="status">Reading your learning history…</p>
{:else}
	<section aria-label="Review evidence">
		<h2>Collecting evidence</h2>
		<p>
			{report.explicit} explicit reviews across {report.words} reviewed words.
			<strong>{report.eligible} delayed recall observations</strong> can be scored.
		</p>
		{#if report.eligible === 0}
			<p>
				Keep reviewing over time. We need answers at least 24 hours after the previous memory update
				to measure delayed recall. First reviews establish a starting point.
			</p>
		{/if}
		<p>
			Personalized fitting is not enabled yet. A review count alone cannot tell us whether there is
			enough varied evidence to improve your schedule.
		</p>
		{#if Object.keys(report.excluded).length}
			<details>
				<summary>Reviews left out of scores</summary>
				<ul>
					{#each Object.entries(report.excluded) as [reason, count] (reason)}
						<li>{reasons[reason] ?? reason}: {count}</li>
					{/each}
				</ul>
			</details>
		{/if}
	</section>
	<section aria-label="Recall prediction report">
		<h2>Later recall</h2>
		<p>
			The earlier period has {report.development.all.count} card answers and
			{report.development.inContext.count} observations while reading. The later period has
			{report.later.all.count} and {report.later.inContext.count}; it is reserved for checking
			predictions. Equal timestamps stay together.
		</p>
		{#if report.later.all.count + report.later.inContext.count === 0}
			<p>There are no separate later-period observations to compare yet.</p>
		{:else}
			{@const rows = [
				{ label: 'Cards, reading', scores: report.later.reading },
				{ label: 'Cards, listening', scores: report.later.listening },
				{ label: 'Reading in context', scores: report.later.inContext }
			]}
			<table>
				<caption>Later-period recall using your current parameters</caption>
				<thead><tr><th>Outcome</th><th>Count</th><th>Predicted</th><th>Observed</th></tr></thead>
				<tbody
					>{#each rows as row (row.label)}
						<tr
							><th>{row.label}</th><td>{row.scores.count}</td>
							<td>{percent(row.scores.meanPrediction)}</td><td
								>{percent(row.scores.observedRecall)}</td
							></tr
						>
					{/each}</tbody
				>
			</table>
		{/if}
		<p>
			Card answers are self-reported. Reading in context counts a tapped word as not understood, and
			an untapped word as understood only in sessions you answered "every unknown word" and only
			where no English was shown. This is a retrospective check using today's evidence rules, not a
			guarantee of improvement.
			{report.seeded} scored observations start from imported Anki memory.
		</p>
	</section>
	<section>
		<h2>Compare on your laptop</h2>
		<p>
			Export the review and encounter snapshot to evaluate candidate parameters later. It contains
			learning activity and local word identifiers, without document text or media. Nothing is
			uploaded and your schedule stays unchanged.
		</p>
		<button onclick={download}>Export learning data</button>
		<button onclick={load} disabled={busy}>{busy ? 'Refreshing…' : 'Refresh report'}</button>
	</section>
{/if}

<style>
	section {
		margin: 1.5rem 0;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.9rem;
	}
	caption {
		text-align: left;
		margin-bottom: 0.5rem;
	}
	th,
	td {
		text-align: left;
		padding: 0.4rem 0.25rem;
		border-bottom: 1px solid var(--rule);
	}
	button {
		margin: 0.25rem 0.5rem 0.25rem 0;
	}
</style>
