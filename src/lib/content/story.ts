/**
 * Stories with your due words (spec 016, issue #10): which words to ask for, the prompts, and the
 * draft loop. The model writes through the Termux service (the laptop when it answers, else the
 * phone); Reader checks each draft with the library's own scoring and asks for rewrites.
 */
import { isDueWord, kindOf } from '$lib/domain/shares';
import type { Memory } from '$lib/domain/memory';
import type { Skill } from '$lib/domain/encounter';
import type { FsrsParameters } from '$lib/domain/anki';
import type { LexemeId, WordState } from '$lib/domain/types';
import type { Score } from './find';

export interface StoryWords {
	/** Due cards, most frequent in the library first. */
	due: string[];
	/** Known words, most frequent first: the vocabulary the rest of the story is built from. */
	known: string[];
}

/** Due words as Cards counts them and known ones as the library does, most frequent first. */
export function chooseWords(
	vocabulary: { id: LexemeId; form: string; count: number }[],
	states: Map<LexemeId, WordState>,
	memory: Map<LexemeId, Partial<Record<Skill, Memory>>>,
	now: Date,
	parameters: FsrsParameters | undefined,
	limits = { due: 10, known: 300 }
): StoryWords {
	const byCount = [...vocabulary].sort((a, b) => b.count - a.count);
	const reading = (id: LexemeId) => memory.get(id)?.reading;
	const due = byCount
		.filter((w) => isDueWord(states.get(w.id)?.state, reading(w.id), now, parameters))
		.slice(0, limits.due)
		.map((w) => w.form);
	const dueSet = new Set(due);
	const known = byCount
		.filter(
			(w) =>
				!dueSet.has(w.form) &&
				kindOf(states.get(w.id)?.state, reading(w.id), now, parameters) === 'known'
		)
		.slice(0, limits.known)
		.map((w) => w.form);
	return { due, known };
}

/**
 * A story's lines for speaking (spec 018): one per sentence, each with its closing punctuation and
 * quotes, so a cue is a sentence and the player steps through it sentence by sentence.
 */
export function storyLines(text: string): string[] {
	return (text.match(/[^。！？!?\n]+[。！？!?]*[”』」]?/gu) ?? [])
		.map((line) => line.trim())
		.filter((line) => /\p{Script=Han}/u.test(line));
}

export interface Message {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

export interface Writer {
	write(messages: Message[]): Promise<{ text: string; where: 'laptop' | 'phone' }>;
}

export interface StoryOptions {
	/** Chinese characters, roughly. */
	length: number;
	topic?: string;
}

export interface Draft {
	text: string;
	score: Score;
	where: 'laptop' | 'phone';
	/** How many drafts were written to get it. */
	drafts: number;
}

/** Rewrites after the first draft, while it has never-met words (prototype: two were enough). */
const REWRITES = 2;

const SYSTEM =
	'You write short graded readers in simplified Chinese for one adult learner. Write natural, ' +
	'idiomatic Mandarin as a native speaker would tell a simple story.';

/** The prototype's "choose" prompt: free to leave out what doesn't fit (issue #10, 2026-10-16). */
export function firstPrompt(words: StoryWords, options: StoryOptions): string {
	const topic = options.topic?.trim()
		? `about ${options.topic.trim()}`
		: 'about ordinary daily life (family, friends, food, shopping, school, travel, a small problem solved)';
	const due =
		words.due.length > 0
			? `The reader is reviewing these words:\n${words.due.join('、')}\nUse the ones that fit naturally in one such story, each at least once, in its ordinary everyday meaning. Leave out any word that would sound forced.\n\n`
			: '';
	const known =
		words.known.length > 0
			? `The reader knows the words below. Build every other part of the story from them (and from particles, numbers and names). Avoid any word that is in neither list.\n${words.known.join('、')}\n\n`
			: '';
	return (
		`Write a short story in simplified Chinese, about ${options.length} Chinese characters long, ${topic}.\n\n` +
		due +
		known +
		'Rules:\n- Concrete events and people, told in order, with a little dialogue; plain spoken Mandarin as a native speaker would tell it; no slogans, no news or business-report language.\n' +
		'- Output only the story: no title, no pinyin, no English, no notes.'
	);
}

export function rewritePrompt(neverMet: string[], due: string[]): string {
	return (
		`The reader has never met these words in it: ${neverMet.join('、')}\n` +
		'Rewrite the story so that it no longer needs them: replace each with a word from the known list ' +
		`or rephrase, keeping the story natural${due.length ? ` and keeping the words from this list that it already uses: ${due.join('、')}` : ''}.\n` +
		'Output only the rewritten story.'
	);
}

/**
 * Writes a story: a first draft, then rewrites naming its never-met words, at most REWRITES of them
 * and only while there are any. Keeps the draft with the highest known share.
 */
export async function writeStory(
	words: StoryWords,
	options: StoryOptions,
	writer: Writer,
	score: (text: string) => Promise<Score>,
	progress?: (step: { draft: number; where: 'laptop' | 'phone' }) => void
): Promise<Draft> {
	const messages: Message[] = [
		{ role: 'system', content: SYSTEM },
		{ role: 'user', content: firstPrompt(words, options) }
	];
	let best: Draft | undefined;
	for (let draft = 1; draft <= 1 + REWRITES; draft++) {
		const { text, where } = await writer.write(messages);
		progress?.({ draft, where });
		const story = text.trim();
		const result = await score(story);
		if (!best || (result.known ?? 0) > (best.score.known ?? 0))
			best = { text: story, score: result, where, drafts: draft };
		best.drafts = draft;
		if (result.neverMetWords.length === 0) break;
		messages.push(
			{ role: 'assistant', content: story },
			{ role: 'user', content: rewritePrompt(result.neverMetWords.slice(0, 20), words.due) }
		);
	}
	return best!;
}
