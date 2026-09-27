/**
 * The reader's corrections to segmentation (spec 004), and applying them to an analyzer's tokens.
 *
 * A correction says how one written form divides: `一个 → [一个]` joins, `国人 → [国, 人]` splits,
 * and `一个人 → [一个, 人]` is both. It applies wherever a run of adjacent words exactly covers the
 * form, whatever the analyzer's own cuts inside it were — so a join and a split are one rule, and
 * the rule means the same thing under every analyzer (FR-010).
 *
 * Earned, and folded like marks: one rule per form, the latest in force; an undo leaves the form to
 * the analyzer again (FR-008, FR-009).
 */

import type { DeviceId, Occurrence } from './types';

/** One piece of a divided form, with the word identity the language provider gave it. */
export interface Part {
	surface: string;
	key: string;
}

export interface Correction {
	language: string;
	form: string;
	/** How the form divides; absent for an undo. */
	parts?: Part[];
	madeAt: string;
	deviceId: DeviceId;
	deviceSeq: number;
	userId: number;
	occurrence?: Occurrence;
}

/** A token as the analyzer produced it, identity decided (ResolvedToken, structurally). */
export interface KeyedToken {
	start: number;
	end: number;
	isWord: boolean;
	lexemeKey?: string;
}

/** Form → parts, for one language: what is in force now. */
export type Rules = Map<string, Part[]>;

export function rulesInForce(history: readonly Correction[], language: string): Rules {
	const rules: Rules = new Map();
	const ordered = [...history].sort((a, b) =>
		a.deviceId !== b.deviceId ? (a.deviceId < b.deviceId ? -1 : 1) : a.deviceSeq - b.deviceSeq
	);
	for (const correction of ordered) {
		if (correction.language !== language) continue;
		if (correction.parts) rules.set(correction.form, correction.parts);
		else rules.delete(correction.form);
	}
	return rules;
}

/** Why a correction cannot be recorded, or undefined when it can (FR-004). */
export function problemWith(form: string, parts: readonly Part[] | undefined): string | undefined {
	if (form.length === 0) return 'a correction needs a form';
	if (!parts) return undefined;
	if (parts.length === 0) return `no parts for ${form}`;
	if (parts.some((part) => part.surface.length === 0)) return 'a part would be empty';
	if (parts.map((part) => part.surface).join('') !== form) {
		return `the parts ${parts.map((part) => part.surface).join(' · ')} are not ${form}`;
	}
	return undefined;
}

/**
 * The analyzer's tokens with the rules applied. Tiles whatever the analyzer's tokens tiled.
 *
 * Left to right, longest form first. A run is made only of words, so a non-word token — punctuation,
 * a line break, a unit delimiter — is never inside one: no correction crosses a boundary the writer
 * put there (FR-003, ADR-0013), and so none crosses an upgrade batch edge either.
 */
export function applyCorrections(
	characters: readonly string[],
	tokens: readonly KeyedToken[],
	rules: Rules
): KeyedToken[] {
	if (rules.size === 0) return [...tokens];
	let longest = 0;
	for (const form of rules.keys()) longest = Math.max(longest, [...form].length);

	const out: KeyedToken[] = [];
	for (let i = 0; i < tokens.length;) {
		let match: { through: number; parts: Part[] } | undefined;
		let surface = '';
		for (let j = i; j < tokens.length && tokens[j].isWord; j++) {
			if (tokens[j].end - tokens[i].start > longest) break;
			surface += characters.slice(tokens[j].start, tokens[j].end).join('');
			const parts = rules.get(surface);
			if (parts) match = { through: j, parts };
		}
		if (!match) {
			out.push(tokens[i++]);
			continue;
		}
		let start = tokens[i].start;
		for (const part of match.parts) {
			const end = start + [...part.surface].length;
			out.push({ start, end, isWord: true, lexemeKey: part.key });
			start = end;
		}
		i = match.through + 1;
	}
	return out;
}

/** The form a join of token `index` with the one after it would make, or why there is none. */
export function joinWithNext(
	characters: readonly string[],
	tokens: readonly KeyedToken[],
	index: number
): { form: string; parts: string[] } | { refused: string } {
	const next = tokens[index + 1];
	if (!next) return { refused: 'This is the last word; there is nothing after it to join.' };
	if (!next.isWord) {
		return {
			refused:
				'Punctuation, a space or a line break comes next. A word cannot span a boundary the writer put there.'
		};
	}
	const form = characters.slice(tokens[index].start, next.end).join('');
	return { form, parts: [form] };
}

/** A form split after `at` characters, or why it cannot be (FR-004). */
export function splitAt(
	form: string,
	at: number
): { form: string; parts: string[] } | { refused: string } {
	const characters = [...form];
	if (at <= 0 || at >= characters.length) return { refused: 'That would leave an empty part.' };
	return { form, parts: [characters.slice(0, at).join(''), characters.slice(at).join('')] };
}
