/**
 * A word's evidence replayed with fsrs6.ts instead of ts-fsrs: the same predictions as
 * `reviewPredictions` (tests/domain/replay.test.ts), about a hundred times faster, which is what
 * makes fitting possible (spec 013, research R4: 0.7 ms against 75 ms for 5,000 events).
 *
 * `prepare` runs the evidence rule once; `replay` then only does arithmetic, so the fit calls it
 * for every candidate without redoing anything that does not depend on the parameters.
 */

import { nextState, retrievability, type MemoryState } from './fsrs6';
import { evidenceFor, strengthened, type RuleStrengths, type WordHistory } from './memory';
import type { Skill } from './encounter';

const DAY_MS = 86_400_000;

export interface PreparedStep {
	at: number;
	grade: 1 | 2 | 3 | 4;
	from?: 'tap' | 'seen';
	/** Scored here: a card answer or an in-context observation. */
	type?: 'card' | 'in-context';
}

export interface PreparedSkill {
	skill: Skill;
	seed?: { memory: MemoryState; lastReview: number; dateKnown: boolean };
	steps: PreparedStep[];
}

export interface Observation {
	type: 'card' | 'in-context';
	skill: Skill;
	at: number;
	/** 0 for Again, else 1. */
	label: 0 | 1;
	probability: number | null;
	excluded?: 'no-prior-memory' | 'undated-seed' | 'short-delay';
}

export function prepare(history: WordHistory): PreparedSkill[] {
	const found = evidenceFor(history);
	return (['reading', 'listening'] as const).map((skill) => {
		const { seed, evidence } = found[skill];
		return {
			skill,
			...(seed
				? {
						seed: {
							memory: { stability: seed.stability, difficulty: seed.difficulty },
							lastReview: Date.parse(seed.lastReview),
							dateKnown: seed.dateKnown
						}
					}
				: {}),
			steps: evidence.map((e) => ({
				at: Date.parse(e.at),
				grade: e.rating as 1 | 2 | 3 | 4,
				...(e.from ? { from: e.from } : {}),
				...(e.review ? { type: 'card' as const } : e.context ? { type: 'in-context' as const } : {})
			}))
		};
	});
}

/** UTC calendar days between two moments, as ts-fsrs counts them for a memory update. */
function calendarDays(from: number, to: number): number {
	const day = (ms: number) => {
		const d = new Date(ms);
		return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
	};
	return Math.floor((day(to) - day(from)) / DAY_MS);
}

/** Replays prepared evidence under weights `w` and `rule`, observing each scored step before it. */
export function replay(
	prepared: PreparedSkill[],
	w: readonly number[],
	rule: RuleStrengths | undefined,
	observe: (observation: Observation) => void
): void {
	for (const { skill, seed, steps } of prepared) {
		let memory = seed?.memory;
		let last = seed?.lastReview;
		let latest = last ?? -Infinity;
		let dated = seed?.dateKnown ?? true;
		for (const step of steps) {
			latest = Math.max(latest, step.at);
			const now = latest;
			if (step.type) {
				const excluded =
					memory === undefined || last === undefined
						? 'no-prior-memory'
						: !dated
							? 'undated-seed'
							: now - last < DAY_MS
								? 'short-delay'
								: undefined;
				observe({
					type: step.type,
					skill,
					at: step.at,
					label: step.grade === 1 ? 0 : 1,
					// Whole 24-hour days for a prediction, as ts-fsrs's get_retrievability counts them.
					probability: excluded
						? null
						: retrievability(w, Math.max(Math.floor((now - last!) / DAY_MS), 0), memory!.stability),
					...(excluded ? { excluded } : {})
				});
			}
			const t = last === undefined ? 0 : calendarDays(last, now);
			const next = nextState(w, memory, Math.max(t, 0), step.grade);
			if (rule && step.from)
				next.stability = strengthened(
					memory?.stability ?? 0,
					next.stability,
					step.from,
					skill,
					rule
				);
			memory = next;
			last = now;
			dated = true;
		}
	}
}
