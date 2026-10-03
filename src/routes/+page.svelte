<script lang="ts">
	import StudyOverview from '$lib/ui/StudyOverview.svelte';
	import { resolve } from '$app/paths';
	import Library from '$lib/ui/Library.svelte';
	import { latest, restore } from '$lib/backup/destination';
	import {
		downloadState,
		fetchBundle,
		importJob,
		newFromTermux,
		reportChoice,
		type TermuxJob
	} from '$lib/media/termux';
	import { dismissJob, listPending, loadPending } from '$lib/media/store';
	import { planImport, titleIn, type ImportPlan, type TrackChoice } from '$lib/media/import';
	import TrackChoiceSheet from '$lib/ui/TrackChoice.svelte';
	import { transcriber } from '$lib/speech/app';
	import type { JobState } from '$lib/speech/transcriber';
	import Progress from '$lib/ui/Progress.svelte';
	import { goto } from '$app/navigation';

	/** How many documents the whole library holds, once known: an empty one may be a wipe. */
	let total = $state<number | null>(null);
	/** Bumped after a restore so the list reads the library again. */
	let generation = $state(0);

	// New videos waiting in Termux (ADR-0022): looked for on load and whenever the app comes back.
	let fresh = $state<TermuxJob[]>([]);
	let opening = $state<string | null>(null);
	let openProblem = $state<string | null>(null);

	/** A download the reader tapped before it finished: opened the moment it is ready. */
	let waitingFor = $state<string | null>(null);

	// Every few seconds while visible, so a share shows up here within moments, with its progress.
	$effect(() => {
		const look = async () => {
			if (document.visibilityState !== 'visible') return;
			const jobs = await newFromTermux();
			fresh = jobs === 'unreachable' ? [] : jobs;
			const wanted = fresh.find((job) => job.job === waitingFor && job.ready !== false);
			if (wanted && opening === null) {
				waitingFor = null;
				void openJob(wanted);
			}
		};
		void look();
		const timer = setInterval(() => void look(), 2000);
		const onVisible = () => void look();
		document.addEventListener('visibilitychange', onVisible);
		return () => {
			clearInterval(timer);
			document.removeEventListener('visibilitychange', onVisible);
		};
	});

	async function dismiss(job: TermuxJob) {
		await dismissJob(job.job);
		fresh = fresh.filter((other) => other.job !== job.job);
	}

	/** A download whose tracks the reader is choosing (spec 012): nothing is imported meanwhile. */
	let asking = $state<{ job: TermuxJob; bundle: Blob; plan: ImportPlan } | null>(null);

	async function openJob(job: TermuxJob) {
		opening = job.job;
		openProblem = null;
		try {
			const bundle = await fetchBundle(job);
			const plan = await planImport(bundle);
			if (plan.needed) {
				asking = { job, bundle, plan };
				return;
			}
			await finishImport(job, bundle);
		} catch (error) {
			openProblem = error instanceof Error ? error.message : String(error);
		} finally {
			opening = null;
		}
	}

	async function chooseTracks(choice: TrackChoice) {
		if (!asking) return;
		const { job, bundle } = asking;
		asking = null;
		opening = job.job;
		try {
			await finishImport(job, bundle, choice);
		} catch (error) {
			openProblem = error instanceof Error ? error.message : String(error);
		} finally {
			opening = null;
		}
	}

	async function finishImport(job: TermuxJob, bundle: Blob, choice?: TrackChoice) {
		const imported = await importJob(job, bundle, choice);
		// The import stands even if Termux missed the choice; it then translates nothing yet.
		if (choice) {
			await reportChoice(job.job, choice).catch((error) => {
				openProblem = error instanceof Error ? error.message : String(error);
			});
		}
		await goto(
			'pending' in imported
				? resolve('/live/[job]', { job: imported.pending })
				: resolve('/read/[id]', { id: String(imported.documentId) })
		);
	}

	// Videos Reader is still transcribing (spec 008): they run on any page, so they are listed here to
	// be opened again, with how far each has got.
	let transcribing = $state<{ job: string; title: string; state?: JobState }[]>([]);
	$effect(() => {
		let unsubscribe = () => {};
		void (async () => {
			const jobs = await listPending();
			transcribing = await Promise.all(
				jobs.map(async (job) => {
					const meta = (await loadPending(job)).find((file) => file.name === 'meta.json');
					return {
						job,
						title: meta ? titleIn(await meta.text(), 'Video') : 'Video',
						state: transcriber.state(job)
					};
				})
			);
			unsubscribe = transcriber.subscribe((job, state) => {
				transcribing = transcribing
					.map((entry) => (entry.job === job ? { ...entry, state } : entry))
					.filter((entry) => entry.state?.kind !== 'done');
			});
		})();
		return () => unsubscribe();
	});

	function describe(state: JobState | undefined): string {
		if (!state) return 'waiting';
		if (state.kind === 'transcribing' && state.total)
			return `${Math.round((100 * state.through) / state.total)}% transcribed`;
		if (state.kind === 'queued') return 'waiting for another video';
		if (state.kind === 'waiting-for-model') return 'needs the speech model';
		if (state.kind === 'failed') return `stopped: ${state.reason}`;
		return 'transcribing';
	}

	let found = $state<Awaited<ReturnType<typeof latest>> | null>(null);
	let restoring = $state(false);
	let restoreProblem = $state<string | null>(null);

	// Only asked for an empty library: that is when a copy is the thing the reader wants to see.
	$effect(() => {
		if (total === 0 && found === null) void latest().then((f) => (found = f));
	});

	async function restoreFound() {
		if (!found || typeof found === 'string') return;
		restoring = true;
		restoreProblem = null;
		try {
			restoreProblem = await restore(found.text);
			if (!restoreProblem) generation++;
		} catch (error) {
			restoreProblem = error instanceof Error ? error.message : String(error);
		} finally {
			restoring = false;
		}
	}
</script>

<span class="eyebrow">Make room for a little Chinese</span>
<div class="section-heading">
	<h1>Your library</h1>
	<a class="add-link" href={resolve('/add')}>＋ Add</a>
</div>
<StudyOverview />
<div class="section-heading"><h2>Videos</h2></div>

{#if transcribing.length > 0}
	<section class="fresh" aria-label="Being transcribed">
		<h2>Being transcribed</h2>
		<ul class="library">
			{#each transcribing as entry (entry.job)}
				<li>
					<a href={resolve('/live/[job]', { job: entry.job })}>{entry.title}</a>
					<small>{describe(entry.state)}</small>
				</li>
			{/each}
		</ul>
	</section>
{/if}

{#if asking}
	<TrackChoiceSheet
		title={asking.job.title}
		plan={asking.plan}
		onconfirm={chooseTracks}
		onclose={() => (asking = null)}
	/>
{/if}

{#if fresh.length > 0}
	<section class="fresh" aria-label="New from Termux">
		<h2>New from Termux</h2>
		{#if openProblem}<p role="alert">{openProblem}</p>{/if}
		<ul class="library">
			{#each fresh as job (job.job)}
				<li>
					{#if job.ready === false}
						<button onclick={() => (waitingFor = job.job)} disabled={waitingFor === job.job}>
							{waitingFor === job.job ? 'Opens when ready' : 'Open'}
						</button>
						{job.title}
						<Progress {...downloadState(job)} />
					{:else}
						<button onclick={() => openJob(job)} disabled={opening !== null}>
							{opening === job.job ? 'Opening…' : 'Open'}
						</button>
						{job.title}
						<small>
							{Math.round(job.bytes / 1e6)} MB
						</small>
						<button class="dismiss" aria-label="Don't offer this again" onclick={() => dismiss(job)}
							>✕</button
						>
					{/if}
				</li>
			{/each}
		</ul>
	</section>
{/if}

{#key generation}
	<Library kind="video" onloaded={(all) => (total = all)}>
		{#snippet empty(libraryEmpty)}
			{#if libraryEmpty && found && found !== 'none' && found !== 'unreachable'}
				<!-- An empty library with a copy in Termux is a wipe, not a fresh start (FR-006). -->
				<div class="notice restore">
					<p>
						<strong>Your work can be restored.</strong> Termux holds a copy from
						{new Date(found.createdAt).toLocaleString()}: {found.documents} documents and {found.words}
						marked words.
					</p>
					{#if restoreProblem}<p role="alert">{restoreProblem}</p>{/if}
					<button onclick={restoreFound} disabled={restoring}>
						{restoring ? 'Restoring…' : 'Restore'}
					</button>
				</div>
			{:else if libraryEmpty && found === 'unreachable'}
				<p class="empty">
					Nothing saved yet. If you had work here before, start Termux (above) so the app can look
					for your copy.
				</p>
			{:else if fresh.length === 0}
				<p class="empty">
					No videos yet. In YouTube, tap <strong>Share → Termux</strong>: the video appears here
					within seconds, and you can start watching while it downloads.
				</p>
			{/if}
		{/snippet}
	</Library>
{/key}
