/**
 * Find videos (spec 015, issue #11): YouTube results scored as the library scores a document.
 *
 * A candidate is never saved: its subtitle text is segmented by the analyzer in force, its words
 * are looked up by written form (a lexeme's identity in Chinese), and the library's own functions
 * give its figures. A word with no lexeme gets a placeholder id with no state or memory, which the
 * library counts as new, as it would count it once saved (research R1).
 */
import { resolveTokens } from '$lib/analyzer/resolve';
import type { Analyzer } from '$lib/analyzer/types';
import { isDueWord, textShares, understood, type Noise } from '$lib/domain/shares';
import type { Memory } from '$lib/domain/memory';
import type { Skill } from '$lib/domain/encounter';
import type { FsrsParameters } from '$lib/domain/anki';
import type { LexemeId, WordState } from '$lib/domain/types';
import {
	classifyTracks,
	defaultChoice,
	parseSubtitles,
	type SubtitleTrack
} from '$lib/media/subtitles';
import { SERVICE } from '$lib/media/service-address';

/** What scoring reads from storage: the storage client in the app, a repository in tests. */
export interface ScoreStore {
	wordsByForm(
		language: string,
		forms: string[]
	): Promise<Map<string, { id: LexemeId; met: boolean }>>;
	getStates(ids: LexemeId[]): Promise<Map<LexemeId, WordState>>;
	getMemory(ids: LexemeId[]): Promise<{
		memory: Map<LexemeId, Partial<Record<Skill, Memory>>>;
		parameters?: FsrsParameters;
		noise?: Noise;
	}>;
}

export interface Score {
	/** Share of running words known, ignored words left out; undefined with none counted. */
	known: number | undefined;
	/** Due words by written form, most frequent in the text first. */
	due: string[];
	/** Distinct words never met: no mark, memory, review or encounter covering them. */
	neverMet: number;
	/** Those words, by written form, most frequent in the text first. */
	neverMetWords: string[];
	understood: number | undefined;
}

export async function scoreText(
	text: string,
	analyzer: Analyzer,
	store: ScoreStore,
	now: Date = new Date()
): Promise<Score> {
	const tokens = resolveTokens(text, await analyzer.analyze(text), analyzer);
	const byForm = new Map<string, number>();
	for (const token of tokens)
		if (token.lexemeKey !== undefined)
			byForm.set(token.lexemeKey, (byForm.get(token.lexemeKey) ?? 0) + 1);
	const forms = [...byForm.keys()];
	const found = await store.wordsByForm(analyzer.language, forms);

	const occurrences = new Map<LexemeId, number>();
	const formOf = new Map<LexemeId, string>();
	let placeholder = 0;
	const unmet: string[] = [];
	for (const form of forms) {
		const word = found.get(form);
		const id = word?.id ?? --placeholder;
		occurrences.set(id, byForm.get(form)!);
		formOf.set(id, form);
		if (!word?.met) unmet.push(form);
	}
	const neverMetWords = unmet.sort((a, b) => byForm.get(b)! - byForm.get(a)!);
	const known = [...occurrences.keys()].filter((id) => id > 0);
	const [states, memory] = await Promise.all([store.getStates(known), store.getMemory(known)]);
	const due = [...occurrences]
		.filter(([id]) =>
			isDueWord(states.get(id)?.state, memory.memory.get(id)?.reading, now, memory.parameters)
		)
		.sort((a, b) => b[1] - a[1])
		.map(([id]) => formOf.get(id)!);
	return {
		known: textShares(occurrences, states, memory.memory, now, memory.parameters)?.known,
		due,
		neverMet: neverMetWords.length,
		neverMetWords,
		understood: understood(occurrences, states, memory.memory, now, memory.parameters, memory.noise)
	};
}

/** One search result, and how far it got (data-model.md). */
export interface Candidate {
	id: string;
	url: string;
	title: string;
	channel: string;
	duration?: number;
	state: 'fetching' | 'scored' | 'no-chinese' | 'rate-limited' | 'failed';
	automatic?: boolean;
	score?: Score;
	/**
	 * Scored by the dictionary while the library's model has yet to score it (research R7): the
	 * model takes about 100 s for a 20-minute video on the phone, the dictionary milliseconds, and
	 * reads 2-10 points lower.
	 */
	rough?: boolean;
	/** The subtitle text scored, kept for the model's pass. */
	text?: string;
	problem?: string;
}

export type Found<T> =
	| { ok: true; value: T }
	| { ok: false; status: 'rate-limited' | 'unreachable' | 'failed'; message?: string };

async function ask<T>(path: string, init?: RequestInit): Promise<Found<T>> {
	let response: Response;
	try {
		response = await fetch(`${SERVICE}${path}`, { cache: 'no-store', ...init });
	} catch {
		return { ok: false, status: 'unreachable' };
	}
	const body = await response.json().catch(() => ({}));
	if (response.status === 429) return { ok: false, status: 'rate-limited' };
	if (!response.ok) return { ok: false, status: 'failed', message: body?.error };
	return { ok: true, value: body as T };
}

/** Up to 15 YouTube results for the query, through the reader service (contracts/service.md). */
export function search(query: string): Promise<Found<Omit<Candidate, 'state'>[]>> {
	return ask(`/search?q=${encodeURIComponent(query)}`);
}

/**
 * The text import would make from this video's Chinese subtitles: the same track choice and the
 * same parsing, so the score matches what importing it will show. Null without Chinese.
 */
export async function subtitleText(
	id: string
): Promise<Found<{ text: string; automatic: boolean } | null>> {
	const found = await ask<{ state: string; tracks?: Omit<SubtitleTrack, 'file'>[] }>(
		`/subtitles?id=${encodeURIComponent(id)}`
	);
	if (!found.ok) return found;
	if (found.value.state !== 'ok' || !found.value.tracks) return { ok: true, value: null };
	const tracks = classifyTracks(
		found.value.tracks.map((track) => ({ ...track, file: track.lang }))
	);
	const chosen = tracks.find((track) => track.file === defaultChoice(tracks).chinese);
	if (!chosen) return { ok: true, value: null };
	const text = parseSubtitles(chosen.text)
		.map((cue) => cue.text)
		.join('\n');
	return { ok: true, value: { text, automatic: chosen.kind === 'automatic' } };
}

/** Hands the video to Termux's download, as a share would; it then shows under New from Termux. */
export async function download(url: string): Promise<boolean> {
	const found = await ask('/download', { method: 'POST', body: JSON.stringify({ url }) });
	return found.ok;
}

/**
 * The page's groups (FR-007): at or above the bar by due words then fewest never met; below it by
 * known share; no Chinese apart. Still fetching ones and failures follow the scored ones.
 */
export function arrange(candidates: Candidate[], bar: number) {
	const scored = candidates.filter((c) => c.state === 'scored' && c.score?.known !== undefined);
	const fits = scored
		.filter((c) => c.score!.known! >= bar)
		.sort(
			(a, b) => b.score!.due.length - a.score!.due.length || a.score!.neverMet - b.score!.neverMet
		);
	const below = scored
		.filter((c) => c.score!.known! < bar)
		.sort((a, b) => b.score!.known! - a.score!.known!);
	return {
		fits,
		below,
		pending: candidates.filter((c) => ['fetching', 'rate-limited', 'failed'].includes(c.state)),
		noChinese: candidates.filter(
			(c) => c.state === 'no-chinese' || (c.state === 'scored' && c.score?.known === undefined)
		)
	};
}
