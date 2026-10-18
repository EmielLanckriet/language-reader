<script lang="ts">
	import { resolve } from '$app/paths';
	import { readDayEnd } from '$lib/ui/hardcore';
	import { session } from '$lib/storage/session';
	import type { StudyOverview } from '$lib/domain/study';
	import type { AttentionAnswer, Engagement, Encounter } from '$lib/domain/encounter';
	import ErrorNotice from './ErrorNotice.svelte';
	import SessionQuestions from './SessionQuestions.svelte';

	// Past sessions and their optional questions, under More: rarely needed, so out of Progress.
	let sessions = $state<StudyOverview['sessions'] | null>(null);
	let problem = $state<unknown>(null);
	let saving = $state<number | null>(null);
	let saveProblem = $state<unknown>(null);
	let saved = $state('');
	let limit = $state(20);
	let expanded = $state<number[]>([]);
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
	async function load() {
		try {
			const { repository } = await session();
			const overview = await repository.studyOverview(
				Intl.DateTimeFormat().resolvedOptions().timeZone,
				readDayEnd()
			);
			if (sessions === null) {
				const firstPending = overview.sessions.find((entry) => !entry.answered)?.id;
				expanded = firstPending === undefined ? [] : [firstPending];
			}
			sessions = overview.sessions;
			problem = null;
		} catch (error) {
			problem = error;
		}
	}
	$effect(() => {
		void load();
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
{:else if !sessions}<p class="muted" role="status">Loading your sessions…</p>
{:else}
	{#if saved}<p role="status">{saved}</p>{/if}
	{#if saveProblem}<ErrorNotice error={saveProblem} />{/if}
	{#if sessions.length === 0}<p class="muted">
			Your sessions will appear here after you read or listen.
		</p>{/if}
	{#each sessions.slice(0, limit) as entry (entry.id)}
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
						href={resolve('/document/[id]', { id: String(entry.documentId) })}>Open again →</a
					>{/if}
			</div>
		</details>
	{/each}
	{#if sessions.length > limit}<button class="secondary" onclick={() => (limit += 20)}
			>Show older sessions</button
		>{/if}
{/if}

<style>
	.muted {
		color: var(--muted);
	}
	.text-link {
		font-size: 0.85rem;
		color: var(--accent);
		font-weight: 600;
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
</style>
