// Building the comparison report (T034-T036).
//
// **The metric (T034)**: for a segmentation unit of length L code points, there are L-1 "internal
// positions" — the gaps between adjacent characters, at code-point indices 1..L-1. Each candidate
// places a word boundary at some subset of those positions (wherever one of its tokens starts, other
// than at position 0). For a pair of candidates, the **disagreement proportion** is the number of
// internal positions where exactly one of the two places a boundary, divided by the total number of
// internal positions measured across every unit in the group. This is a literal reading of "the
// fraction of positions where the candidates disagree about whether a word boundary falls there" —
// not a count of disagreeing words, because words of different length make word-counting an
// apples-to-oranges comparison, while every unit has an unambiguous number of character positions.
//
// **Disagreeing spans (T035)**: a position where every available candidate places a boundary is a
// safe place to cut — every candidate's own tokens end exactly there. The set of such "universal
// cuts" (plus the unit's own start and end) divides a unit into cells. If every candidate reads a
// cell as a single token, every candidate agrees on that stretch and it is not reported. If any
// candidate splits a cell further, the candidates disagree somewhere inside it, and the whole cell —
// not just the contested position — is reported as one disagreeing span, together with what every
// candidate read it as, so the disagreement can be judged rather than merely counted.

import { codePointLength } from './lib/offsets.mjs';

/** The code-point positions, other than 0, where this candidate's tokens begin. */
function boundaryPositions(tokens) {
	const positions = new Set();
	for (const token of tokens) {
		if (token.start > 0) positions.add(token.start);
	}
	return positions;
}

/** Positions, including the unit's own ends, where every available candidate places a boundary. */
function universalCutPositions(unitLength, boundarySetsById) {
	const sets = Object.values(boundarySetsById);
	const cuts = new Set([0, unitLength]);
	for (let position = 1; position < unitLength; position++) {
		if (sets.every((set) => set.has(position))) cuts.add(position);
	}
	return [...cuts].sort((a, b) => a - b);
}

function tokensWithin(tokens, start, end) {
	return tokens.filter((token) => token.start >= start && token.end <= end);
}

function pairKey(a, b) {
	return [a, b].sort().join(' vs ');
}

/**
 * Precompute, once per unit, the boundary sets each available candidate produced. Both the
 * pairwise-proportion pass and the disagreeing-span pass read from this rather than recomputing it.
 */
function analyseUnit(unit, candidateIds) {
	const unitLength = codePointLength(unit.unitText);
	const boundarySetsById = {};
	for (const id of candidateIds) {
		if (id in unit.tokensByCandidate) {
			boundarySetsById[id] = boundaryPositions(unit.tokensByCandidate[id]);
		}
	}
	return { unit, unitLength, boundarySetsById, availableIds: Object.keys(boundarySetsById) };
}

function pairwiseDisagreement(analysedUnits) {
	const pairwise = new Map();

	for (const { unitLength, boundarySetsById, availableIds } of analysedUnits) {
		for (let i = 0; i < availableIds.length; i++) {
			for (let j = i + 1; j < availableIds.length; j++) {
				const a = availableIds[i];
				const b = availableIds[j];
				const key = pairKey(a, b);
				const entry = pairwise.get(key) ?? { disagreements: 0, totalPositions: 0 };

				entry.totalPositions += Math.max(unitLength - 1, 0);
				for (let position = 1; position < unitLength; position++) {
					if (boundarySetsById[a].has(position) !== boundarySetsById[b].has(position)) {
						entry.disagreements += 1;
					}
				}
				pairwise.set(key, entry);
			}
		}
	}

	return pairwise;
}

function disagreeingSpans(analysedUnits, candidates) {
	const spans = [];

	for (const { unit, unitLength, boundarySetsById, availableIds } of analysedUnits) {
		if (availableIds.length < 2) continue; // nothing to disagree about with one candidate

		const cuts = universalCutPositions(unitLength, boundarySetsById);
		for (let i = 0; i < cuts.length - 1; i++) {
			const start = cuts[i];
			const end = cuts[i + 1];

			const readings = availableIds.map((id) => ({
				id,
				label: candidates.find((c) => c.id === id)?.label ?? id,
				tokens: tokensWithin(unit.tokensByCandidate[id], start, end)
			}));

			const everyoneAgrees = readings.every((reading) => reading.tokens.length === 1);
			if (everyoneAgrees) continue;

			spans.push({ passage: unit.passage, unitText: unit.unitText, readings });
		}
	}

	return spans;
}

function renderGroup(title, groupUnits, candidates, candidateIds) {
	const lines = [`## ${title}`, ''];

	if (groupUnits.length === 0) {
		lines.push('_No material in this category was found in passages/._', '');
		return lines.join('\n');
	}

	const passageCount = new Set(groupUnits.map((u) => u.passage)).size;
	lines.push(
		`${groupUnits.length} segmentation unit(s) measured, drawn from ${passageCount} passage file(s).`,
		''
	);

	const analysedUnits = groupUnits.map((unit) => analyseUnit(unit, candidateIds));

	lines.push('**Disagreement between each pair, as a proportion of character positions:**', '');
	const pairwise = pairwiseDisagreement(analysedUnits);
	if (pairwise.size === 0) {
		lines.push('_Fewer than two candidates were available; no pair to compare._');
	} else {
		for (const [key, { disagreements, totalPositions }] of [...pairwise.entries()].sort()) {
			const proportion = totalPositions === 0 ? 0 : disagreements / totalPositions;
			lines.push(
				`- ${key}: ${(proportion * 100).toFixed(2)}% (${disagreements} of ${totalPositions} character positions disagree)`
			);
		}
	}
	lines.push('');

	lines.push("**Disagreeing spans, with every candidate's reading:**", '');
	const spans = disagreeingSpans(analysedUnits, candidates);
	if (spans.length === 0) {
		lines.push('_No disagreeing spans found in this category._');
	} else {
		for (const span of spans) {
			lines.push(`- \`${span.passage}\` — unit "${span.unitText}":`);
			for (const reading of span.readings) {
				lines.push(`    - ${reading.label}: ${reading.tokens.map((t) => t.text).join(' | ')}`);
			}
		}
	}
	lines.push('');

	return lines.join('\n');
}

export function buildReport({ candidates, units, shortLineThreshold }) {
	const candidateIds = candidates.map((c) => c.id);
	const lines = [];

	lines.push('# Segmenter comparison report', '');
	lines.push(`Generated ${new Date().toISOString()}.`, '');
	lines.push(`Candidates compared: ${candidates.map((c) => c.label).join('; ')}.`, '');
	lines.push(
		'**Method note**: every candidate is run one segmentation unit at a time, bounded by line ' +
			'breaks and Chinese sentence-final punctuation, using the delimiter set copied from ' +
			'`src/lib/analyzer/chinese.ts`. A short spoken-language line is a physical line of a ' +
			`passage file at or under ${shortLineThreshold} code points; anything longer is long ` +
			'prose (FR-028). See README.md for the exact metric definition.',
		''
	);

	lines.push(
		renderGroup(
			'Short spoken-language lines',
			units.filter((u) => u.category === 'short'),
			candidates,
			candidateIds
		)
	);
	lines.push(
		renderGroup(
			'Long prose',
			units.filter((u) => u.category === 'long'),
			candidates,
			candidateIds
		)
	);
	lines.push(
		renderGroup(
			'Overall (both categories combined — supplementary, not a substitute for the split above)',
			units,
			candidates,
			candidateIds
		)
	);

	return lines.join('\n');
}
