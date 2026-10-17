/**
 * Glue between hardcore mode's pages and storage (spec 014): reading a document's words, a plan's
 * record, and a drill card's sentence. The rules themselves live in $lib/domain/hardcore.
 */

import type { CardSentence, StoredDocument } from '$lib/storage/repository';
import type { HardcoreStep } from '$lib/domain/encounter';
import type { Filters, LineSpan, Order, Part } from '$lib/domain/hardcore';
import type { Token } from '$lib/domain/types';

/** What a session's `hardcore-plan` records (contracts/hardcore-records.md). */
export interface PlanDetail {
	start: 'beginning' | 'continue' | 'range';
	fragment: LineSpan;
	cut: { size: number } | null;
	steps: HardcoreStep[];
	filters: Filters;
	order: Order;
	parts: Part[];
}

/** When a study day ends, on this device (asked for 2026-10-04; 4 AM unless changed). */
export const DAY_END_HOURS = [0, 1, 2, 3, 4, 5, 6];

export function readDayEnd(): number {
	try {
		const kept = Number(localStorage.getItem('reader.dayEndHour'));
		return localStorage.getItem('reader.dayEndHour') !== null && DAY_END_HOURS.includes(kept)
			? kept
			: 4;
	} catch {
		return 4;
	}
}

/** When the study day `now` falls in began, on the local clock. */
export function dayStart(now: Date, dayEndHour: number): Date {
	const start = new Date(now);
	start.setHours(dayEndHour, 0, 0, 0);
	if (start > now) start.setDate(start.getDate() - 1);
	return start;
}

/** A word's first occurrence on a line: what its drill card marks. */
export function occurrenceOn(
	tokens: Token[],
	range: [number, number],
	lexemeId: number
): Token | undefined {
	return tokens.find((t) => t.lexemeId === lexemeId && t.start >= range[0] && t.end <= range[1]);
}

/**
 * Each word's first occurrence within the part's lines, and its line, from tokens in order: one pass
 * per part. Asking `occurrenceOn` line by line for each card read every token for each line, up to
 * a second of each card on the phone (issue #41).
 */
export function firstOccurrences(
	tokens: Token[],
	lineRanges: [number, number][],
	lines: [number, number]
): Map<number, { token: Token; line: number }> {
	const found = new Map<number, { token: Token; line: number }>();
	let line = lines[0];
	for (const token of tokens) {
		while (line <= lines[1] && token.start >= lineRanges[line][1]) line++;
		if (line > lines[1]) break;
		const [start, end] = lineRanges[line];
		if (token.lexemeId === undefined || token.start < start || token.end > end) continue;
		if (!found.has(token.lexemeId)) found.set(token.lexemeId, { token, line });
	}
	return found;
}

/**
 * A drill card's sentence: the whole line, which for a video is the subtitle line, so the card's
 * audio is that line's (ADR-0035, `timedExample`).
 */
export function drillSentence(
	document: Pick<StoredDocument, 'id' | 'title'>,
	characters: string[],
	range: [number, number],
	line: number,
	word: Token
): CardSentence {
	const text = characters.slice(range[0], range[1]).join('');
	return {
		source: 'reader',
		sourceTitle: document.title,
		sourceKey: `reader:${document.id}:${word.start}`,
		available: true,
		documentId: document.id,
		lineText: text,
		lineFrom: range[0],
		from: range[0],
		to: range[1],
		text,
		wordFrom: word.start - range[0],
		wordTo: word.end - range[0],
		line
	};
}

/** m:ss, for a line's place in a video. */
export function clock(seconds: number): string {
	const whole = Math.max(0, Math.floor(seconds));
	return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
