<script lang="ts">
	import { DAY_END_HOURS, readDayEnd } from '$lib/ui/hardcore';
	import { resolve } from '$app/paths';
	import { session } from '$lib/storage/session';
	import { replacements } from '$lib/media/store';
	import { EARNED_CHANGE } from '$lib/storage/client';
	import type { StudyOverview } from '$lib/domain/study';
	import ErrorNotice from './ErrorNotice.svelte';
	let { full = false }: { full?: boolean } = $props();
	let overview = $state<StudyOverview | null>(null);
	let problem = $state<unknown>(null);
	/** Study days still needed this week to carry the streak on, when it comes from weeks before. */
	const toKeep = $derived.by(() => {
		if (!overview || overview.streak <= overview.week.completed) return 0;
		const needed = overview.week.target - overview.week.completed;
		const open = overview.week.days.filter((d) => d.date >= overview!.week.today && !d.done);
		return needed > 0 && needed <= open.length ? needed : 0;
	});
	let dayEndHour = $state(readDayEnd());
	function setDayEnd(hour: number) {
		dayEndHour = hour;
		try {
			localStorage.setItem('reader.dayEndHour', String(hour));
		} catch {
			// Not kept: this visit still uses it.
		}
		void load();
	}
	const hourLabel = (hour: number) => (hour === 0 ? 'Midnight' : `${hour} AM`);
	const duration = (ms: number) =>
		ms < 60000
			? `${Math.floor(ms / 1000)} sec`
			: `${Math.floor(ms / 60000)} min ${Math.floor((ms % 60000) / 1000)} sec`;
	let generation = 0;
	let disposed = false;
	async function load() {
		const request = ++generation;
		try {
			const { repository } = await session();
			const [result, moved] = await Promise.all([
				repository.studyOverview(Intl.DateTimeFormat().resolvedOptions().timeZone, dayEndHour),
				replacements()
			]);
			// A video given new subtitles (issue #9) is another document now: continue in that one.
			const resume = result.sessions.find((s) => s.available || moved.has(s.documentId));
			result.resume = resume
				? {
						documentId: moved.get(resume.documentId) ?? resume.documentId,
						title: resume.title,
						modality: resume.modality
					}
				: null;
			if (!disposed && request === generation) {
				overview = result;
				problem = null;
			}
		} catch (error) {
			if (!disposed && request === generation) problem = error;
		}
	}
	$effect(() => {
		disposed = false;
		void load();
		const refresh = () => void load();
		const visible = () => {
			if (document.visibilityState === 'visible') refresh();
		};
		window.addEventListener(EARNED_CHANGE, refresh);
		document.addEventListener('visibilitychange', visible);
		const timer = setInterval(visible, 60000);
		return () => {
			disposed = true;
			generation++;
			window.removeEventListener(EARNED_CHANGE, refresh);
			document.removeEventListener('visibilitychange', visible);
			clearInterval(timer);
		};
	});
</script>

{#if problem}<ErrorNotice error={problem} onretry={load} />
{:else if !overview}<p class="muted" role="status">Loading your week…</p>
{:else}
	<section class="week-card" aria-label="Weekly study progress">
		<div class="week-heading">
			<div>
				<span class="eyebrow">A little, often</span>
				<h2>This week</h2>
			</div>
			<span class="week-total"
				><strong>{overview.week.completed}</strong> / {overview.week.target} days</span
			>
		</div>
		<ol class="week-days">
			{#each overview.week.days as day (day.date)}
				<li
					class:complete={day.done}
					class:today={day.date === overview.week.today}
					aria-label={`${day.label}, ${day.date}: ${day.done ? 'goal reached' : `${duration(day.durationMs)}, ${day.reviews} reviews`}`}
				>
					<span>{day.label}</span><span class="day-mark" aria-hidden="true"
						>{day.done ? '✓' : new Date(`${day.date}T12:00:00Z`).getUTCDate()}</span
					>
				</li>
			{/each}
		</ol>
		{#if overview.streak}<p class="streak">
				<strong>{overview.streak}</strong>
				{overview.streak === 1 ? 'study day' : 'study days'} in your streak{#if toKeep}<span>
						&nbsp;· {toKeep} more {toKeep === 1 ? 'day' : 'days'} by Sunday keep it going</span
					>{/if}
			</p>{/if}
		<p class="week-note">
			{overview.week.completed >= 5
				? 'Your weekly goal is complete. Nicely done.'
				: 'One minute of reading or listening, or five card answers, makes a study day.'}
		</p>
		{#if full}<label class="day-end"
				>A day ends at <select
					value={dayEndHour}
					onchange={(event) => setDayEnd(Number(event.currentTarget.value))}
					>{#each DAY_END_HOURS as hour (hour)}<option value={hour}>{hourLabel(hour)}</option
						>{/each}</select
				></label
			>{/if}
		{#if !full}<a class="text-link" href={resolve('/progress')}
				>View your progress <span aria-hidden="true">↗</span></a
			>{/if}
	</section>
	{#if !full}
		{#if overview.resume}<a
				class="continue-card"
				href={resolve('/document/[id]', { id: String(overview.resume.documentId) })}
			>
				<span class="eyebrow">Pick up where you left off</span><strong
					>{overview.resume.title}</strong
				><span class="continue-action"
					>{overview.resume.modality === 'media' ? 'Continue watching' : 'Continue reading'}
					<span aria-hidden="true">→</span></span
				>
			</a>{/if}
	{:else}
		<p class="muted">
			Aim for five days, with room for life. Missed days never erase your history. Your streak
			counts study days and ends only when a week closes with fewer than five. Time is an activity
			estimate, not a focus score. All card answers count equally.
		</p>
	{/if}
{/if}

<style>
	.week-card {
		background: var(--surface);
		border: 1px solid var(--rule);
		border-radius: 22px;
		padding: 1.2rem;
		margin: 1rem 0 1.25rem;
	}
	.week-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}
	h2 {
		font-size: 1.15rem;
		margin: 0;
	}
	.week-total {
		color: var(--muted);
		font-size: 0.85rem;
		white-space: nowrap;
	}
	.week-total strong {
		font-size: 1.6rem;
		color: var(--accent);
	}
	.week-days {
		list-style: none;
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		gap: 0.3rem;
		padding: 0;
		margin: 1rem 0;
	}
	.week-days li {
		text-align: center;
		font-size: 0.7rem;
		color: var(--muted);
	}
	.day-mark {
		display: grid;
		place-items: center;
		width: 2rem;
		height: 2rem;
		margin: 0.35rem auto 0;
		border-radius: 50%;
		background: var(--paper);
		font-size: 0.85rem;
	}
	.complete .day-mark {
		background: var(--accent);
		color: var(--on-accent);
	}
	.today .day-mark {
		outline: 2px solid var(--accent);
		outline-offset: 3px;
	}
	.streak {
		font-size: 0.9rem;
		margin: 0.75rem 0 0;
	}
	.streak strong {
		color: var(--accent);
	}
	.streak span {
		color: var(--muted);
	}
	.week-note {
		font-size: 0.82rem;
		color: var(--muted);
		margin: 0.75rem 0;
	}
	.day-end {
		display: block;
		font-size: 0.82rem;
		color: var(--muted);
		margin: 0 0 0.75rem;
	}
	.day-end select {
		font: inherit;
		color: var(--ink, inherit);
		background: var(--surface, transparent);
		border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
		border-radius: 6px;
		padding: 0.2rem 0.4rem;
		margin-left: 0.25rem;
	}
	.text-link {
		font-size: 0.85rem;
		color: var(--accent);
		font-weight: 600;
	}
	.continue-card {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
		padding: 1.4rem;
		border-radius: 22px;
		background: var(--accent);
		color: var(--on-accent);
		text-decoration: none;
		margin: 1rem 0 1.8rem;
	}
	.continue-card strong {
		font-size: 1.25rem;
		line-height: 1.5;
	}
	.continue-card .eyebrow {
		color: inherit;
		opacity: 0.8;
	}
	.continue-action {
		font-size: 0.85rem;
		display: flex;
		justify-content: space-between;
	}
</style>
