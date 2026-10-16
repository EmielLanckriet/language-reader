<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { session } from '$lib/storage/session';
	import { activeAnalyzer, fallbackAnalyzer } from '$lib/analyzer/active';
	import { resolveTokens, stampOf } from '$lib/analyzer/resolve';
	import { pasteSource } from '$lib/content/paste';
	import { scoreText } from '$lib/content/find';
	import { chooseWords, writeStory, type Draft, type Message } from '$lib/content/story';
	import { SERVICE } from '$lib/media/service-address';
	import StartTermux from '$lib/ui/StartTermux.svelte';
	import ErrorNotice from '$lib/ui/ErrorNotice.svelte';

	/**
	 * Stories with your due words (spec 016, issue #10). Written by the laptop when it answers, else
	 * by the phone, through the Termux service; nothing is saved until Read it (FR-008).
	 */

	const LENGTHS = [
		{ label: 'Short', characters: 150 },
		{ label: 'Normal', characters: 300 },
		{ label: 'Long', characters: 500 }
	];
	const SETTINGS = 'reader.story';

	function stored(): { length: number; topic: string } {
		try {
			return { length: 300, topic: '', ...JSON.parse(localStorage.getItem(SETTINGS) ?? '{}') };
		} catch {
			return { length: 300, topic: '' };
		}
	}

	const initial = stored();
	let length = $state(initial.length);
	let topic = $state(initial.topic);
	let writing = $state(false);
	let status = $state('');
	let story = $state<Draft | null>(null);
	let problem = $state<unknown>(null);
	let unreachable = $state(false);
	let saving = $state(false);
	let run = 0;

	function remember() {
		try {
			localStorage.setItem(SETTINGS, JSON.stringify({ length, topic }));
		} catch {
			// A convenience only.
		}
	}

	const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

	/** One draft through the reader service, polled until written. */
	async function write(messages: Message[], mine: number, draft: number) {
		const started = await fetch(`${SERVICE}/generate`, {
			method: 'POST',
			body: JSON.stringify({ messages, max_tokens: Math.round(length * 2.5), temperature: 0.7 })
		}).catch(() => null);
		if (!started?.ok) {
			unreachable = !started;
			throw new Error('Termux could not start writing the story.');
		}
		const { job } = await started.json();
		for (;;) {
			if (mine !== run) throw new Error('stopped');
			await sleep(2000);
			const state = await (await fetch(`${SERVICE}/generate/${job}`, { cache: 'no-store' })).json();
			const place = state.where === 'laptop' ? 'on the laptop' : 'on the phone';
			const which = draft === 1 ? 'first draft' : `rewrite ${draft - 1}`;
			if (state.state === 'waiting')
				status = `Waiting for the phone's model (a translation is using it)…`;
			else if (state.state === 'writing') status = `Writing the ${which} ${place}…`;
			else if (state.state === 'done')
				return { text: String(state.text), where: state.where as 'laptop' | 'phone' };
			else throw new Error(state.error ?? 'The story could not be written.');
		}
	}

	async function start() {
		const mine = ++run;
		remember();
		writing = true;
		story = null;
		problem = null;
		unreachable = false;
		status = 'Choosing your words…';
		try {
			const { repository } = await session();
			const vocabulary = await repository.vocabulary();
			const ids = vocabulary.map((w) => w.id);
			const [states, memory] = await Promise.all([
				repository.getStates(ids),
				repository.getMemory(ids)
			]);
			const words = chooseWords(vocabulary, states, memory.memory, new Date(), memory.parameters);
			const analyzer = await activeAnalyzer();
			let draft = 0;
			const result = await writeStory(
				words,
				{ length, topic },
				{ write: (messages) => write(messages, mine, ++draft) },
				(text) => scoreText(text, analyzer, repository)
			);
			if (mine === run) story = result;
		} catch (error) {
			if (mine === run && !(error instanceof Error && error.message === 'stopped')) problem = error;
		} finally {
			if (mine === run) writing = false;
		}
	}

	async function readIt() {
		if (!story) return;
		saving = true;
		try {
			const { repository } = await session();
			const document = await pasteSource.ingest(story.text);
			const title = `Story · ${new Date().toLocaleDateString()}`;
			const analyzed = await fallbackAnalyzer.analyze(document.rawContent);
			const tokens = resolveTokens(document.rawContent, analyzed, fallbackAnalyzer);
			const id = await repository.saveDocument(
				{ ...document, title },
				tokens,
				stampOf(fallbackAnalyzer)
			);
			await goto(resolve('/read/[id]', { id: String(id) }));
		} catch (error) {
			problem = error;
		} finally {
			saving = false;
		}
	}

	function discard() {
		run++;
		story = null;
		writing = false;
	}
</script>

<p><a href={resolve('/texts')}>← Texts</a></p>
<h1>A story with your due words</h1>
<p class="lede">
	An everyday story using some of the words you are reviewing, built from words you know. Written on
	the laptop when it is on, otherwise on the phone (a few minutes).
</p>

<fieldset class="length" disabled={writing}>
	<legend>Length</legend>
	{#each LENGTHS as option (option.characters)}
		<label
			><input type="radio" bind:group={length} value={option.characters} />
			{option.label} (~{option.characters} characters)</label
		>
	{/each}
</fieldset>
<label class="topic"
	>Topic (optional)
	<input bind:value={topic} placeholder="e.g. at the market" disabled={writing} /></label
>

{#if !writing && !story}
	<button class="primary" onclick={start}>Write me a story</button>
{/if}

{#if writing}
	<p role="status">{status}</p>
	<button onclick={discard}>Stop</button>
{/if}

{#if unreachable}
	<p class="notice" role="status">
		Termux isn't answering, so nothing can be written. <StartTermux onstarted={start} />
	</p>
{/if}
{#if problem}<ErrorNotice error={problem} />{/if}

{#if story}
	<article class="story" lang="zh-Hans">{story.text}</article>
	<p class="figures">
		<strong>{Math.round((story.score.known ?? 0) * 1000) / 10} % known</strong>
		· {story.score.neverMet} never met
		{#if story.score.due.length > 0}· due: <span lang="zh-Hans">{story.score.due.join(' ')}</span
			>{:else}· no due words{/if}
		· written {story.where === 'laptop' ? 'on the laptop' : 'on the phone'}, {story.drafts}
		{story.drafts === 1 ? 'draft' : 'drafts'}
	</p>
	<div class="actions">
		<button class="primary" onclick={readIt} disabled={saving}>Read it</button>
		<button onclick={start} disabled={saving}>Another</button>
		<button onclick={discard} disabled={saving}>Discard</button>
	</div>
{/if}

<style>
	.length {
		border: none;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.topic {
		display: flex;
		flex-direction: column;
		margin: 0.75rem 0;
	}
	.story {
		font-size: 1.2rem;
		line-height: 1.8;
		margin: 1rem 0;
		white-space: pre-wrap;
	}
	.figures {
		font-size: 0.9rem;
		color: var(--muted);
	}
	.actions {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.notice {
		padding: 0.5rem 0.75rem;
		border-radius: 0.5rem;
		background: var(--accent-soft);
	}
</style>
