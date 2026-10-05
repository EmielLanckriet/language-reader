<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { session } from '$lib/storage/session';
	import { replacements } from '$lib/media/store';
	import { EARNED_CHANGE } from '$lib/storage/client';
	import type { StudyOverview } from '$lib/domain/study';
	import type { AttentionAnswer, Engagement, Encounter } from '$lib/domain/encounter';
	import ErrorNotice from './ErrorNotice.svelte';
	import SessionQuestions from './SessionQuestions.svelte';
	let { full = false }: { full?: boolean } = $props();
	let overview = $state<StudyOverview | null>(null);
	let problem = $state<unknown>(null);
	let saving = $state<number | null>(null);
	let saveProblem = $state<unknown>(null);
	let saved = $state('');
	let limit = $state(20);
	let expanded = $state<number[]>([]);
	const pending = $derived(overview?.sessions.filter((s) => !s.answered) ?? []);
	const selected = $derived(Number(page.url.searchParams.get('session')));
	/** When a study day ends, on this device only (asked for 2026-10-04; 4 AM unless changed). */
	const DAY_END_HOURS = [0, 1, 2, 3, 4, 5, 6];
	let dayEndHour = $state(readDayEnd());
	function readDayEnd(): number {
		try {
			const kept = Number(localStorage.getItem('reader.dayEndHour'));
			return localStorage.getItem('reader.dayEndHour') !== null && DAY_END_HOURS.includes(kept)
				? kept
				: 4;
		} catch {
			return 4;
		}
	}
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
	const when = (at: string) =>
		new Date(at).toLocaleString(undefined, {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
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
				if (overview === null) {
					const firstPending = result.sessions.find((entry) => !entry.answered)?.id;
					expanded = result.sessions
						.filter((entry) => entry.id === selected || entry.id === firstPending)
						.map((entry) => entry.id);
				}
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
	async function save(id: number, encounter: Omit<Encounter, 'at'>) {
		if (saving !== null) return;
		saving = id;
		saveProblem = null;
		saved = '';
		try {
			await (
				await session()
			).repository.recordEncounters(id, [{ ...encounter, at: new Date().toISOString() }]);
			await load();
			saved = 'Saved. You can change this answer whenever you need to.';
		} catch (error) {
			saveProblem = error;
		} finally {
			saving = null;
		}
	}
	const answer = (id: number, value: AttentionAnswer) =>
		save(id, { kind: 'attention', detail: { answer: value } });
	/** Both fields each time, so the latest engagement alone says the whole answer. */
	const engage = (id: number, current: Engagement | null, change: Partial<Engagement>) =>
		save(id, {
			kind: 'engagement',
			detail: { mode: null, attentive: null, ...current, ...change }
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
				>View your sessions <span aria-hidden="true">↗</span></a
			>{/if}
	</section>
	{#if !full}
		{#if pending.length}<a class="pending-card" href={resolve('/progress')}
				><strong>Finish your last session</strong><span>{pending[0].title}</span><small
					>{pending.length}
					{pending.length === 1 ? 'session has' : 'sessions have'} optional feedback waiting</small
				><span aria-hidden="true">→</span></a
			>{/if}
		{#if overview.resume}<a
				class="continue-card"
				href={resolve('/read/[id]', { id: String(overview.resume.documentId) })}
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
			Aim for five days, with room for life. Missed days never erase your history. Time is an
			activity estimate, not a focus score. All card answers count equally.
		</p>
		{#if overview.sessions.some((s) => s.id === selected && s.ended)}<p
				class="session-saved"
				role="status"
			>
				Session saved. That’s a good place to stop, or choose something else when you’re ready.
			</p>{/if}
		<div class="section-heading">
			<h2>Your sessions</h2>
			<button class="secondary" onclick={load}>Refresh</button>
		</div>
		{#if saved}<p role="status">{saved}</p>{/if}
		{#if saveProblem}<ErrorNotice error={saveProblem} />{/if}
		{#if overview.sessions.length === 0}<p class="empty">
				Your sessions will appear here after you read or listen. Use Finish session in the reader
				whenever you’re done.
			</p>{/if}
		{#each overview.sessions.slice(0, limit) as entry (entry.id)}
			<details
				class="session-card"
				open={expanded.includes(entry.id)}
				ontoggle={(event) => {
					if (event.currentTarget.open) {
						if (!expanded.includes(entry.id)) expanded = [...expanded, entry.id];
					} else expanded = expanded.filter((id) => id !== entry.id);
				}}
			>
				<summary
					><strong>{entry.title}</strong><span
						>{when(entry.lastAt)} · {duration(entry.activityMs)} recorded</span
					><small
						>{entry.answered || entry.engagement
							? 'Feedback saved · edit'
							: 'Optional feedback'}</small
					></summary
				>
				<div class="session-body">
					<SessionQuestions
						modality={entry.modality}
						engagement={entry.engagement}
						answered={entry.answered}
						answer={entry.answer}
						disabled={saving !== null}
						onengage={(change) => engage(entry.id, entry.engagement, change)}
						onanswer={(value) => answer(entry.id, value)}
					/>
					{#if entry.available}<a
							class="text-link"
							href={resolve('/read/[id]', { id: String(entry.documentId) })}>Open again →</a
						>{/if}
				</div>
			</details>
		{/each}
		{#if overview.sessions.length > limit}<button class="secondary" onclick={() => (limit += 20)}
				>Show older sessions</button
			>{/if}
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
	.week-heading,
	.section-heading {
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
	.pending-card {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.7rem;
		padding: 1rem;
		border: 1px solid var(--rule);
		border-radius: 16px;
		text-decoration: none;
		color: var(--ink);
		margin: 1rem 0;
	}
	.pending-card strong,
	.pending-card small {
		width: 100%;
	}
	.pending-card small {
		color: var(--muted);
	}
	.session-card {
		border: 1px solid var(--rule);
		border-radius: 18px;
		background: var(--surface);
		margin: 0.8rem 0;
		overflow: hidden;
	}
	.session-card summary {
		padding: 1rem;
		cursor: pointer;
	}
	.session-card summary strong,
	.session-card summary span,
	.session-card summary small {
		display: block;
	}
	.session-card summary span,
	.session-card summary small {
		font-size: 0.8rem;
		color: var(--muted);
	}
	.session-body {
		padding: 0 1rem 1rem;
	}
	.session-saved {
		padding: 1rem;
		border-radius: 16px;
		background: var(--accent-soft);
	}
</style>
