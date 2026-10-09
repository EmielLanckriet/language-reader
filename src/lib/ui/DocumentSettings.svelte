<script lang="ts">
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { session } from '$lib/storage/session';
	import {
		dismissJob,
		loadMedia,
		removeMedia,
		saveMedia,
		ENGLISH_SETTING,
		type EnglishSetting,
		type StoredMedia
	} from '$lib/media/store';
	import { reportChoice } from '$lib/media/termux';
	import { classifyTracks, parseSubtitles } from '$lib/media/subtitles';
	import { switchChinese } from '$lib/media/import';
	import { jobOf } from '$lib/media/translation';

	/**
	 * A document's English and Chinese subtitles and Delete, on its page and in the player (#31).
	 * The player closes its reading session first (`beforechange`) and leaves without asking its
	 * session questions (`leaving`).
	 */
	let {
		document,
		media = $bindable(),
		reopen,
		beforechange,
		leaving,
		onrefollow
	}: {
		document: { id: number; title: string };
		media: StoredMedia | null;
		/** Where a document opens after its Chinese changed. */
		reopen: '/read/[id]' | '/document/[id]';
		beforechange?: () => Promise<void> | void;
		leaving?: () => void;
		/** Machine English chosen after a person's: Termux translates the lines that track left. */
		onrefollow?: () => void;
	} = $props();

	const englishTracks = $derived(media?.tracks.filter((t) => /^en\b/i.test(t.lang)) ?? []);
	let englishProblem = $state<string | null>(null);

	/** The kept track whose lines are this document's lines: the Chinese it is read from. */
	function currentTrack(stored: StoredMedia): string | undefined {
		const lines = stored.cues.map((cue) => cue.text).join('\n');
		return stored.tracks.find(
			(t) =>
				parseSubtitles(t.text)
					.map((cue) => cue.text)
					.join('\n') === lines
		)?.file;
	}

	/** The video's other Chinese tracks, when it kept any (issue #9). */
	const chineseTracks = $derived(
		media ? classifyTracks(media.tracks).filter((t) => t.chinese && !t.duplicateOf) : []
	);
	let chineseProblem = $state<string | null>(null);
	let switchingChinese = $state(false);

	/**
	 * New Chinese subtitles: a new document in this one's place (switchChinese). A full load of the
	 * new page, so a reading session starts afresh on it.
	 */
	async function switchChineseTrack(file: string) {
		chineseProblem = null;
		switchingChinese = true;
		try {
			await beforechange?.();
			const id = await switchChinese(document.id, file);
			leaving?.();
			const params = { id: String(id) };
			location.replace(
				reopen === '/read/[id]' ? resolve('/read/[id]', params) : resolve('/document/[id]', params)
			);
		} catch (error) {
			chineseProblem = error instanceof Error ? error.message : String(error);
			switchingChinese = false;
		}
	}

	/** US4: which English this video shows. Derived data only: marks and history are untouched. */
	async function switchEnglish(value: string) {
		const id = document.id;
		if (!media) return;
		const setting: EnglishSetting =
			value === 'machine' || value === 'none'
				? { source: value }
				: { source: 'track', file: value };
		englishProblem = null;
		await saveMedia(id, [{ name: ENGLISH_SETTING, blob: new Blob([JSON.stringify(setting)]) }]);
		const job = jobOf(media.meta);
		// The Termux name of the track this document reads.
		const chinese = currentTrack(media);
		if (job && chinese && value === 'machine') {
			await reportChoice(job, { chinese, english: 'machine' }).catch((error) => {
				englishProblem = error instanceof Error ? error.message : String(error);
			});
			onrefollow?.();
		}
		media = await loadMedia(id);
	}

	let deleteProblem = $state<string | null>(null);

	/**
	 * The video file goes; the text stays, hidden, when marks or reading history point into it
	 * (Repository.removeDocument), so that history keeps its context.
	 */
	async function deleteDocument() {
		if (!confirm(`Delete “${document.title}”? Your marks and history in it are kept.`)) return;
		deleteProblem = null;
		try {
			const { repository } = await session();
			await beforechange?.();
			await repository.removeDocument(document.id);
			// Its Termux download stays in Termux; without this it would be offered as new again.
			const job = media && jobOf(media.meta);
			if (job) await dismissJob(job);
			await removeMedia(document.id);
			leaving?.();
			await goto(resolve('/'));
		} catch (error) {
			deleteProblem = error instanceof Error ? error.message : String(error);
		}
	}
</script>

{#if englishTracks.length > 0 && media}
	<p class="english-choice">
		<label>
			English
			<select
				value={media.english.source === 'track' ? media.english.file : media.english.source}
				onchange={(event) => void switchEnglish(event.currentTarget.value)}
			>
				{#each englishTracks as track (track.file)}
					<option value={track.file}>{track.name || track.lang} (the video's own)</option>
				{/each}
				<option value="machine">Machine translation</option>
				<option value="none">None</option>
			</select>
		</label>
		{#if englishProblem}<span role="alert">{englishProblem}</span>{/if}
	</p>
{/if}

{#if chineseTracks.length > 1 && media}
	<p class="english-choice">
		<label>
			Chinese
			<select
				value={currentTrack(media)}
				disabled={switchingChinese}
				onchange={(event) => void switchChineseTrack(event.currentTarget.value)}
			>
				{#each chineseTracks as track (track.file)}
					<option value={track.file}
						>{track.name || track.lang}{track.mixed
							? ', with pinyin or English'
							: ''}{track.kind === 'automatic' ? ', automatic' : ''}</option
					>
				{/each}
			</select>
		</label>
		{#if switchingChinese}<span role="status">Changing the subtitles…</span>{/if}
		{#if chineseProblem}<span role="alert">{chineseProblem}</span>{/if}
	</p>
{/if}

<p class="delete">
	<button class="secondary" onclick={deleteDocument}>Delete this document</button>
	{#if deleteProblem}<span role="alert">{deleteProblem}</span>{/if}
</p>

<style>
	.english-choice {
		margin-top: 2rem;
		font-size: 0.9rem;
	}

	.english-choice select {
		margin-left: 0.5rem;
		min-height: 44px;
	}

	.delete {
		margin-top: 3rem;
		font-size: 0.85rem;
	}
	.delete button {
		color: var(--muted);
	}
</style>
