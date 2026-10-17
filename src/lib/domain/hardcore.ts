/**
 * Hardcore mode (spec 014): one engine, not modes. A session is a fragment of a document cut into
 * parts; every part runs the chosen steps in one order. Pure: what the reader did is in the
 * session's records, and everything here is derived from them and the document.
 */

import type { HardcoreStep } from './encounter';
import type { FsrsParameters } from './anki';
import type { Memory } from './memory';
import { kindOf } from './shares';
import type { LexemeId, Token, WordState } from './types';

/** How a word stands for a drill (FR-004): no memory yet, due by its memory, or not due. */
export type WordClass = 'new' | 'due' | 'excluded';

export interface FragmentWord {
	lexemeId: LexemeId;
	class: WordClass;
	/** Known by the library shares' measure: what the coverage target counts as known. */
	known: boolean;
	/** Position in general Chinese frequency, 0 the most frequent; absent for an unlisted word. */
	rank?: number;
}

export interface Filters {
	minOccurrences?: number;
	/** Only words among the `topRank` most common in general Chinese. */
	topRank?: number;
	/** The fewest words that bring the fragment's known running words to this share (0–1). */
	coverage?: number;
}

export type Order = 'frequency' | 'story';

/** A word to drill and the line its card shows: the first it occurs on in the fragment. */
export interface DrillWord {
	lexemeId: LexemeId;
	line: number;
}

/** Inclusive line indices, as the plan records them. */
export type LineSpan = [number, number];

export interface Part {
	lines: LineSpan;
	words: LexemeId[];
}

export interface StepRecord {
	part: number;
	step: HardcoreStep;
	at: 'start' | 'end';
}

/**
 * How a word stands for a drill (FR-004): by its reading memory alone (issue #46). Whether it is a
 * card, set aside or retired does not matter: retiring only keeps a word off Cards.
 */
export function classify(
	state: WordState | undefined,
	reading: Memory | undefined,
	now: Date,
	parameters?: FsrsParameters
): { class: WordClass; known: boolean } {
	const known = kindOf(state?.state, reading, now, parameters) === 'known';
	if (!reading) return { class: 'new', known };
	return { class: Date.parse(reading.due) <= now.getTime() ? 'due' : 'excluded', known };
}

/** Where an Again puts the card: three cards later (FR-009). */
const AGAIN_LATER = 3;

/** The queue after grading its head: passed, or back three cards later on Again. */
export function afterGrade(queue: LexemeId[], grade: number): LexemeId[] {
	const [head, ...rest] = queue;
	if (grade > 1) return rest;
	return [...rest.slice(0, AGAIN_LATER), head, ...rest.slice(AGAIN_LATER)];
}

/**
 * The first step not yet ended, in plan order, from part `from` on. A step started and left (the
 * player closed, the app gone) is still to do.
 */
export function nextStep(
	steps: HardcoreStep[],
	parts: number,
	records: StepRecord[],
	from = 0
): { part: number; step: HardcoreStep } | undefined {
	const ended = new Set(records.filter((r) => r.at === 'end').map((r) => `${r.part} ${r.step}`));
	for (let part = from; part < parts; part++)
		for (const step of steps) if (!ended.has(`${part} ${step}`)) return { part, step };
	return undefined;
}

/** The line each running word of the fragment is on, in story order. */
function runningWords(
	lineRanges: [number, number][],
	fragment: LineSpan,
	tokens: Token[]
): { lexemeId: LexemeId; line: number }[] {
	const found: { lexemeId: LexemeId; line: number }[] = [];
	let line = fragment[0];
	const [from] = lineRanges[fragment[0]];
	const [, to] = lineRanges[fragment[1]];
	for (const token of tokens) {
		if (!token.isWord || token.lexemeId === undefined) continue;
		if (token.start < from || token.end > to) continue;
		while (token.start >= lineRanges[line][1]) line++;
		found.push({ lexemeId: token.lexemeId, line });
	}
	return found;
}

/** The fragment's words to drill (FR-004–FR-006), each with its card's line, in drill order. */
export function drillWords(
	lineRanges: [number, number][],
	fragment: LineSpan,
	tokens: Token[],
	words: Map<LexemeId, FragmentWord>,
	options: { order: Order; filters: Filters }
): DrillWord[] {
	const running = runningWords(lineRanges, fragment, tokens);
	const count = new Map<LexemeId, number>();
	const firstLine = new Map<LexemeId, number>();
	for (const { lexemeId, line } of running) {
		count.set(lexemeId, (count.get(lexemeId) ?? 0) + 1);
		if (!firstLine.has(lexemeId)) firstLine.set(lexemeId, line);
	}
	const { minOccurrences, topRank, coverage } = options.filters;
	// Map keys keep insertion order: story order is the order of first occurrence.
	let story = [...firstLine.keys()].filter((id) => {
		const word = words.get(id);
		if (word === undefined || word.class === 'excluded') return false;
		if (minOccurrences !== undefined && count.get(id)! < minOccurrences) return false;
		if (topRank !== undefined && !((word.rank ?? Infinity) < topRank)) return false;
		return true;
	});
	const byFrequency = (ids: LexemeId[]) => [...ids].sort((a, b) => count.get(b)! - count.get(a)!);
	if (coverage !== undefined) {
		// The fewest words that bring the fragment's known running words to the target, most
		// frequent first. A word already known adds nothing to it, so the target leaves it out.
		const total = running.length;
		let known = running.filter(({ lexemeId }) => words.get(lexemeId)?.known).length;
		const kept = new Set<LexemeId>();
		for (const id of byFrequency(story)) {
			if (words.get(id)!.known) continue;
			if (known >= coverage * total) break;
			kept.add(id);
			known += count.get(id)!;
		}
		story = story.filter((id) => kept.has(id));
	}
	const ordered = options.order === 'story' ? story : byFrequency(story);
	return ordered.map((lexemeId) => ({ lexemeId, line: firstLine.get(lexemeId)! }));
}

/**
 * Parts of about `n` words (FR-007, research R6), cut at line boundaries: cut before a line that
 * would take a part holding at least n/2 past 1.5 n, and after the line that brings it to n. A
 * last part under n/2 joins the one before when they fit 1.5 n together. A word belongs to the
 * part holding its line, which is its first line in the fragment.
 */
export function cutByLoad(fragment: LineSpan, words: DrillWord[], n: number): Part[] {
	const perLine = new Map<number, number>();
	for (const { line } of words) perLine.set(line, (perLine.get(line) ?? 0) + 1);
	const spans: { lines: LineSpan; count: number }[] = [];
	let start = fragment[0];
	let count = 0;
	for (let line = fragment[0]; line <= fragment[1]; line++) {
		const k = perLine.get(line) ?? 0;
		if (count >= n / 2 && count + k > 1.5 * n) {
			spans.push({ lines: [start, line - 1], count });
			start = line;
			count = 0;
		}
		count += k;
		if (count >= n) {
			spans.push({ lines: [start, line], count });
			start = line + 1;
			count = 0;
		}
	}
	if (start <= fragment[1]) {
		const last = spans.at(-1);
		if (last && count < n / 2 && last.count + count <= 1.5 * n) {
			last.lines = [last.lines[0], fragment[1]];
			last.count += count;
		} else spans.push({ lines: [start, fragment[1]], count });
	}
	return spans.map(({ lines }) => ({
		lines,
		words: words
			.filter(({ line }) => line >= lines[0] && line <= lines[1])
			.map(({ lexemeId }) => lexemeId)
	}));
}
