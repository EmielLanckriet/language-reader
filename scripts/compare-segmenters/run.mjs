#!/usr/bin/env node
// Entry point for the laptop-side segmentation comparison harness (ADR-0012, spec 003 FR-026 to
// FR-031). Never bundled, never imported by the application — see README.md for the boundary this
// script exists inside, and why.
//
// Usage: node scripts/compare-segmenters/run.mjs

import { readdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { splitIntoUnits, CHINESE_UNIT_DELIMITERS } from './lib/units.mjs';
import { codePointLength } from './lib/offsets.mjs';
import { buildReport } from './report.mjs';

import * as intlSegmenter from './candidates/intl-segmenter.mjs';
import * as cedictLongestMatch from './candidates/cedict-longest-match.mjs';
import * as frequencyPath from './candidates/frequency-path.mjs';
import * as bertWs from './candidates/bert-ws.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PASSAGES_DIR = join(HERE, 'passages');
const REPORT_PATH = join(HERE, 'report.md');

// A subtitle line rarely exceeds about 20 characters on the platforms this reader watches —
// professional Chinese subtitling guidance commonly caps a single line around 16-20 characters so
// it can be read at a comfortable pace. Twenty is used here as a round, slightly generous cut: a
// line at or under this length is treated as short spoken-language material (FR-028); anything
// longer is long prose. Passages are plain .txt files with no metadata, so line length is what is
// available to classify by (T036) — this threshold is a documented judgment call, not a measurement.
const SHORT_LINE_THRESHOLD = 20;

const CANDIDATE_MODULES = [intlSegmenter, cedictLongestMatch, frequencyPath, bertWs];

async function prepareCandidates() {
	const candidates = [];
	for (const candidateModule of CANDIDATE_MODULES) {
		try {
			const prepared = await candidateModule.prepare();
			candidates.push({ id: candidateModule.id, label: candidateModule.label, ...prepared });
			console.log(`  ready:   ${candidateModule.label}`);
		} catch (error) {
			// A candidate that cannot fetch its data must not take the rest of the comparison down
			// with it (network access to a data source is not guaranteed and is not this harness's to
			// require) — it is skipped, loudly, and the run continues with what is available.
			console.error(`  SKIPPED: ${candidateModule.label} — ${error.message}`);
		}
	}
	return candidates;
}

async function collectUnits(passageFiles, candidates) {
	const units = [];

	for (const fileName of passageFiles) {
		const text = readFileSync(join(PASSAGES_DIR, fileName), 'utf-8');

		for (const rawLine of text.split(/\r\n|\r|\n/)) {
			const line = rawLine.trim();
			if (line.length === 0) continue;

			const category = codePointLength(line) <= SHORT_LINE_THRESHOLD ? 'short' : 'long';

			// A unit never spans a line break (FR-002), so splitting per physical line first and then
			// splitting each line on sentence-final punctuation gives identical units to splitting the
			// whole passage at once — and it is what makes classifying by line length well-defined:
			// every unit derived from a short line inherits that line's category.
			for (const unit of splitIntoUnits(line, CHINESE_UNIT_DELIMITERS)) {
				const tokensByCandidate = {};
				for (const candidate of candidates) {
					// `await` on a plain array (every dictionary-based candidate's return value) resolves
					// to that same array immediately; only bert-ws's model inference is actually
					// asynchronous. One code path serves both without candidates needing to agree on
					// sync-versus-async among themselves.
					tokensByCandidate[candidate.id] = await candidate.segmentUnit(unit.text);
				}
				units.push({ passage: fileName, category, unitText: unit.text, tokensByCandidate });
			}
		}
	}

	return units;
}

async function main() {
	if (
		!existsSync(PASSAGES_DIR) ||
		readdirSync(PASSAGES_DIR).filter((n) => n.endsWith('.txt')).length === 0
	) {
		console.error(
			[
				'scripts/compare-segmenters/passages/ has no .txt passages yet.',
				'',
				'This harness compares candidates on the reader’s own material, never a benchmark',
				'corpus (FR-026) — word-hood is learner-dependent here, so agreement with someone',
				'else’s annotator is not the question being asked.',
				'',
				'Add at least five passages as .txt files under passages/, at least two of them subtitle-',
				'or transcript-like (SC-007), then run this again. See passages/README.md.'
			].join('\n')
		);
		process.exit(1);
	}

	const passageFiles = readdirSync(PASSAGES_DIR).filter((name) => name.endsWith('.txt'));

	console.log('Preparing candidates...');
	const candidates = await prepareCandidates();
	if (candidates.length === 0) {
		console.error(
			'No candidate could be prepared (every fetch failed or was unreachable). Nothing to compare.'
		);
		process.exit(1);
	}

	console.log(`\nSegmenting ${passageFiles.length} passage file(s)...`);
	const units = await collectUnits(passageFiles, candidates);

	const report = buildReport({
		candidates: candidates.map((c) => ({ id: c.id, label: c.label })),
		units,
		shortLineThreshold: SHORT_LINE_THRESHOLD
	});

	writeFileSync(REPORT_PATH, report, 'utf-8');
	console.log(`\nReport written to ${REPORT_PATH}\n`);
	console.log(report);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
