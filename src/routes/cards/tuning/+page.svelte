<script lang="ts">
	import { resolve } from '$app/paths';
	import { session } from '$lib/storage/session';
	import type { TuningDataset, TuningReport } from '$lib/domain/tuning';
	import type { ParameterSet } from '$lib/domain/fit';
	import { fitOnThisDevice } from '$lib/fit-run';
	import { sweepStaleMemory } from '$lib/storage/sweep';
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

	type Entry = { at: string; action: 'apply' | 'rollback'; id: string; set: ParameterSet | null };
	/** A fitted set as fit.mjs writes it: the set, what it was compared with, and its report. */
	type Fitted = ParameterSet & {
		comparedWith?: string;
		report?: {
			applicable?: boolean;
			why?: string;
			comparison?: Record<string, { count: number; difference: number | null; verdict: string }>;
		};
	};
	let inForce = $state<{ id: string; set: ParameterSet | null } | null>(null);
	let changes = $state<Entry[]>([]);
	let imported = $state<Fitted | null>(null);
	let parameterProblem = $state<unknown>(null);
	let parameterNote = $state('');
	/** Why Apply is not offered for the imported set, or null when it is (FR-012). */
	const refusal = $derived.by(() => {
		if (!imported || !inForce) return null;
		if (imported.report?.applicable !== true)
			return `It ${imported.report?.why ?? 'has no report'}, so it is not applied.`;
		if (imported.comparedWith !== inForce.id)
			return 'It was fitted against a different set than the one in force: export and fit again.';
		return null;
	});

	async function loadParameters() {
		const { repository } = await session();
		[inForce, changes] = await Promise.all([
			repository.parametersInForce(),
			repository.parameterHistory()
		]);
	}

	async function importSet(event: Event) {
		parameterProblem = null;
		parameterNote = '';
		const file = (event.currentTarget as HTMLInputElement).files?.[0];
		if (!file) return;
		try {
			imported = JSON.parse(await file.text());
		} catch (error) {
			imported = null;
			parameterProblem = error;
		}
	}

	/** A fit running here: its progress, and how to stop it (spec 013 Story 4). */
	let fitting = $state<{ done: number; total: number; cancel: () => void } | null>(null);
	async function fitHere() {
		if (!analysis || fitting) return;
		parameterProblem = null;
		parameterNote = '';
		imported = null;
		const run = fitOnThisDevice($state.snapshot(analysis.data), (done, total) => {
			if (fitting) fitting = { ...fitting, done, total };
		});
		fitting = { done: 0, total: 1, cancel: run.cancel };
		const started = performance.now();
		try {
			const { set } = await run.result;
			imported = set;
			parameterNote = `Fitted here in ${Math.round((performance.now() - started) / 1000)} s.`;
		} catch (error) {
			parameterProblem = error;
		} finally {
			fitting = null;
		}
	}

	/**
	 * Apply or return, then bring memory up to the new set at once: the layout's sweep runs only
	 * when the app starts. Stops if the page is hidden; the next start finishes it.
	 */
	async function change(action: () => Promise<void>, note: string) {
		parameterProblem = null;
		try {
			await action();
			imported = null;
			await loadParameters();
			parameterNote = `${note} Updating your memory…`;
			const { repository } = await session();
			const started = performance.now();
			const words = await sweepStaleMemory(
				repository,
				() => document.visibilityState === 'visible'
			);
			const seconds = ((performance.now() - started) / 1000).toFixed(1);
			parameterNote = `${note} Memory updated: ${words} word rows in ${seconds} s.`;
		} catch (error) {
			parameterProblem = error;
		}
	}

	async function load() {
		if (busy) return;
		busy = true;
		problem = null;
		try {
			const { repository } = await session();
			analysis = await repository.tuningAnalysis();
			await loadParameters();
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
	and Easy mean you remembered. While reading, a tapped word counts as not understood, and an
	untapped one as understood only in sessions you answered "every unknown word" and only where no
	English was shown.
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
			A review count alone cannot tell whether there is enough varied evidence to improve your
			schedule: a fitted set is only applied when it predicted your later reading better.
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

<section aria-label="Parameters in force">
	<h2>Your parameters</h2>
	{#if inForce}
		<p>
			In force: {inForce.set
				? `a fitted set (${inForce.id})`
				: `your Anki weights under today's rule (${inForce.id})`}.
		</p>
		{#if inForce.set}
			<button
				class="secondary"
				onclick={() =>
					change(
						() => session().then(({ repository }) => repository.returnToParameters(null)),
						'Returned to your Anki weights.'
					)}>Return to your Anki weights</button
			>
		{/if}
	{/if}
	<p>
		Fit on your laptop with <code>node scripts/fsrs/fit.mjs</code> on an export, then import the set it
		writes. It can only be applied if it predicted your later reading better, with enough data, and your
		card answers no worse.
	</p>
	{#if fitting}
		<p role="status">
			Fitting on this device… {Math.round((100 * fitting.done) / fitting.total)}%
			<button class="secondary" onclick={() => fitting?.cancel()}>Cancel</button>
		</p>
	{:else}
		<button class="secondary" onclick={fitHere} disabled={!analysis}>Fit on this device</button>
		<p class="muted">
			Uses the phone for a few minutes; it stops if you leave the app, and after five minutes.
		</p>
	{/if}
	<label>
		Import a fitted set
		<input
			type="file"
			accept="application/json,.json"
			aria-label="Fitted set"
			onchange={importSet}
		/>
	</label>
	{#if imported}
		{@const reading = imported.report?.comparison?.inContext}
		{@const detail =
			reading && reading.difference !== null
				? ` (${reading.count} later observations while reading, log loss ${reading.difference > 0 ? '+' : ''}${reading.difference.toFixed(3)} per observation)`
				: ''}
		<p>Set {imported.id}: {imported.report?.why ?? 'no report'}{detail}.</p>
		{#if refusal}
			<p role="status">{refusal}</p>
		{:else}
			<button
				onclick={() =>
					change(
						() =>
							session().then(({ repository }) =>
								repository.applyParameters($state.snapshot(imported))
							),
						'Applied.'
					)}>Apply this set</button
			>
		{/if}
	{/if}
	{#if parameterNote}<p role="status">{parameterNote}</p>{/if}
	{#if parameterProblem}<ErrorNotice error={parameterProblem} />{/if}
	{#if changes.length > 0}
		<h3>Changes</h3>
		<ul>
			{#each changes as entry (entry.at + entry.id)}
				<li>
					{new Date(entry.at).toLocaleString()}: {entry.action === 'apply'
						? 'applied'
						: 'returned to'}
					{entry.set ? `fitted set ${entry.id}` : 'your Anki weights'}
					{#if inForce && entry.id !== inForce.id}
						<button
							class="secondary"
							onclick={() =>
								change(
									() =>
										session().then(({ repository }) =>
											repository.returnToParameters(entry.set ? entry.id : null)
										),
									'Returned.'
								)}>Return to this</button
						>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>

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
