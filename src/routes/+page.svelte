<script lang="ts">
	import { resolve } from '$app/paths';
	import Library from '$lib/ui/Library.svelte';
	import { latest, restore } from '$lib/backup/destination';
	import { downloadState, importJob, newFromTermux, type TermuxJob } from '$lib/media/termux';
	import { dismissJob } from '$lib/media/store';
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

	async function openJob(job: TermuxJob) {
		opening = job.job;
		openProblem = null;
		try {
			const imported = await importJob(job);
			await goto(
				'pending' in imported
					? resolve('/live/[job]', { job: imported.pending })
					: resolve('/read/[id]', { id: String(imported.documentId) })
			);
		} catch (error) {
			openProblem = error instanceof Error ? error.message : String(error);
		} finally {
			opening = null;
		}
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

<h1>Videos</h1>

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
							{Math.round(job.bytes / 1e6)} MB{job.transcribing
								? ' · subtitles still being made'
								: ''}
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
