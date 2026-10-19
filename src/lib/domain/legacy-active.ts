/**
 * Which words were active cards before spec 019 (ADR-0039, ADR-0040, ADR-0041): frozen, read only
 * by the switch to statuses, which makes these words active (research R4). Not a rule anything
 * else follows. It can go once no library from before the switch can be restored.
 *
 * The old rule: a card (a tap, a Cards review, an Anki seed, a `learning` mark) or a known word
 * (never tapped, met untapped in two attentive sessions with new sentences), active when reviewed
 * in Reader, seeded or known, or once its reading stability reached 14 days; never an `ignored`
 * word or one retired by hand; a set-aside word only from 14 days or a Cards review after the mark.
 */

import { evidenceFor, memoryWithTrajectory, type RuleStrengths, type WordHistory } from './memory';
import type { FsrsParameters } from './anki';

const KNOWN_SESSIONS = 2;
const STABLE_AT_DAYS = 14;

const byHistory = (
	a: { deviceId: string; deviceSeq: number },
	b: { deviceId: string; deviceSeq: number }
) => (a.deviceId !== b.deviceId ? (a.deviceId < b.deviceId ? -1 : 1) : a.deviceSeq - b.deviceSeq);

export function legacyActive(
	history: WordHistory,
	parameters?: FsrsParameters,
	strengths?: RuleStrengths
): boolean {
	const marks = [...history.marks].sort(byHistory);
	const events = [...history.events].sort(byHistory);
	const last = marks.at(-1);
	if (last?.asserted === 'ignored') return false;

	const { memory, trajectory } = memoryWithTrajectory(history, parameters, strengths);
	if (!memory.reading) return false;
	const seed = evidenceFor(history).reading.seed;

	const isTap = (e: (typeof events)[number]) => e.kind === 'lookup' || e.kind === 'check';
	const isCardReview = (e: (typeof events)[number]) =>
		e.kind === 'review' && e.detail.hardcore === undefined;
	let card =
		seed !== undefined ||
		events.some((e) => isTap(e) || isCardReview(e)) ||
		marks.some((m) => m.asserted === 'learning');

	const tappedIn = new Set(events.filter(isTap).map((e) => e.sessionId));
	const attentive = new Set(
		history.exposures
			.filter(
				(x) =>
					!(seed && x.at <= seed.lastReview) &&
					!x.helped &&
					history.answers.get(x.sessionId) === 'all' &&
					!tappedIn.has(x.sessionId) &&
					x.rewatchDays === undefined
			)
			.map((x) => x.sessionId)
	);
	let known = !events.some(isTap) && attentive.size >= KNOWN_SESSIONS;

	let setAside = false;
	let retired = false;
	if (last?.asserted === 'retired') {
		const aside = last.provenance.startsWith('set aside:');
		const reviewedSince = events.some(
			(e) => isCardReview(e) && e.detail.skill === 'reading' && byHistory(e, last) > 0
		);
		if (!aside) card = false;
		else setAside = !reviewedSince;
		retired = !aside;
		known = false;
	}

	const stable = !retired && trajectory.some((p) => p.stability >= STABLE_AT_DAYS);
	const isCard = card || stable;
	const reviewed = stable || events.some((e) => isCardReview(e) && e.detail.skill === 'reading');
	if (!(isCard || (known && !isCard))) return false;
	if (setAside && !stable) return false;
	return reviewed || seed !== undefined || (known && !isCard);
}
