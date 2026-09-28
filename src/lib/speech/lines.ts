/**
 * Subtitle lines from the recognised tokens (research R8).
 *
 * With number normalisation off the transcript has no punctuation, so lines are cut at pauses: a
 * new line after every pause of PAUSE seconds, and a line still longer than LONGEST characters
 * split at its longest pause, again and again. Subtitle lines on the videos measured run 10 to 25
 * characters; Termux's transcriber cut at 24 (ADR-0019). Computed from the tokens whenever needed,
 * so these numbers can change without transcribing again.
 */
import type { Token } from './windows';

export const PAUSE = 0.6;
export const LONGEST = 24;
/** How long a line stays up after its last token begins, at most, when a pause follows it. */
const TRAIL = 0.8;

export interface Line {
	text: string;
	from: number;
	to: number;
	tokens: Token[];
}

const length = (ts: Token[]) => ts.reduce((n, [text]) => n + text.length, 0);

function split(ts: Token[]): Token[][] {
	if (length(ts) <= LONGEST || ts.length < 2) return [ts];
	let at = 1;
	for (let i = 2; i < ts.length; i++)
		if (ts[i][1] - ts[i - 1][1] > ts[at][1] - ts[at - 1][1]) at = i;
	return [...split(ts.slice(0, at)), ...split(ts.slice(at))];
}

export function lines(tokens: Token[]): Line[] {
	const groups: Token[][] = [];
	for (const token of tokens) {
		const current = groups.at(-1);
		const last = current?.at(-1);
		if (current && last && token[1] - last[1] < PAUSE) current.push(token);
		else groups.push([token]);
	}
	const cut = groups.flatMap(split);
	return cut.map((ts, i) => {
		const from = ts[0][1];
		const next = cut[i + 1]?.[0][1];
		const end = ts.at(-1)![1] + TRAIL;
		return {
			text: ts
				.map(([x]) => x)
				.join('')
				.trim(),
			from,
			to: next === undefined ? end : Math.min(next, end),
			tokens: ts
		};
	});
}

function stamp(seconds: number): string {
	const ms = Math.round(seconds * 1000);
	const pad = (n: number, w = 2) => String(n).padStart(w, '0');
	return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}.${pad(ms % 1000, 3)}`;
}

export function toVtt(ls: Line[]): string {
	const cues = ls
		.filter((l) => l.text)
		.map((l) => `${stamp(l.from)} --> ${stamp(l.to)}\n${l.text}`);
	return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}
