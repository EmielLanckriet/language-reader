// Issue #29, step 4: how many in-context outcomes it takes to see an exposure kind's effect.
//
// The simulator is fit.test.ts's `simulate` (outcomes drawn from the chance FSRS gives at that
// moment, under a known truth, memory updated by the evidence rule), extended: the truth is the set
// in force, each word's starting memory, number of outcomes and gaps are drawn from the measured
// rows, and before a share of outcomes an exposure (say listen-only) happens that FSRS does not see.
// It raises the true recall by a planted logit shift. The test is the step-5 model: logistic
// regression with FSRS's prediction as offset plus the exposure indicator, Wald test with
// word-clustered (sandwich) errors, two-sided 5%. Power at each size; the smallest N with 80%.
//
//   node scripts/analysis-29/power.mjs EXPORT.json OUT_DIR [REPS=200]
// OUT_DIR must hold rows.json from build-rows.mjs (measured distributions); writes power.md.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const [exportPath, dir, repsArg] = process.argv.slice(2);
if (!exportPath || !dir)
	throw new Error('Usage: node scripts/analysis-29/power.mjs EXPORT OUT_DIR [REPS]');
const REPS = Number(repsArg ?? 200);
const root = fileURLToPath(new URL('../../', import.meta.url));
const server = await createServer({
	root,
	configFile: false,
	appType: 'custom',
	logLevel: 'error',
	server: { middlewareMode: true, watch: null, hmr: false, ws: false }
});
try {
	const { nextState, retrievability } = await server.ssrLoadModule('/src/lib/domain/fsrs6.ts');
	const { strengthened } = await server.ssrLoadModule('/src/lib/domain/memory.ts');
	const data = JSON.parse(await readFile(exportPath, 'utf8'));
	const rows = JSON.parse(await readFile(`${dir}/rows.json`, 'utf8')).filter((r) => r.scored);
	const w = data.parameters.weights,
		strengths = data.active.strengths;
	const fs = data.active.falseSuccess,
		ff = data.active.falseFailure;

	// Measured distributions to draw from.
	const perWord = new Map();
	for (const r of rows) perWord.set(r.word, [...(perWord.get(r.word) ?? []), r]);
	const words = [...perWord.values()];
	const firstStability = words.map((l) => l[0].stability_before);
	const counts = words.map((l) => l.length);
	const gaps = rows.map((r) => r.days_since_evidence);
	const treatedShare = rows.filter((r) => r.since_evidence_listen_only > 0).length / rows.length;

	function random(seed) {
		return () => {
			seed = (seed + 0x6d2b79f5) | 0;
			let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	}
	const logit = (p) => Math.log(p / (1 - p));
	const sig = (x) => 1 / (1 + Math.exp(-x));
	const normal = (next) =>
		Math.sqrt(-2 * Math.log(next() + 1e-12)) * Math.cos(2 * Math.PI * next());

	/** N outcomes from words drawn like the measured ones; `beta` the planted shift, `sigma` a per-word one. */
	function simulate(n, beta, share, sigma, next) {
		const out = [];
		let word = 0;
		while (out.length < n) {
			const pick = Math.floor(next() * words.length);
			let memory = { stability: firstStability[pick], difficulty: 5 };
			const u = sigma * normal(next);
			const k = counts[Math.floor(next() * counts.length)];
			for (let i = 0; i < k && out.length < n; i++) {
				const gap = gaps[Math.floor(next() * gaps.length)];
				const recall = retrievability(w, Math.max(Math.floor(gap), 0), memory.stability);
				const treated = next() < share ? 1 : 0;
				const trueRecall = sig(
					logit(Math.min(Math.max(recall, 1e-9), 1 - 1e-9)) + beta * treated + u
				);
				const y = next() < fs + (1 - fs - ff) * trueRecall ? 1 : 0;
				out.push({
					word,
					offset: logit(fs + (1 - fs - ff) * recall),
					treated,
					y,
					recall,
					trueRecall
				});
				const after = nextState(w, memory, Math.max(Math.floor(gap), 0), y ? 3 : 1);
				after.stability = strengthened(
					memory.stability,
					after.stability,
					y ? 'seen' : 'tap',
					'reading',
					strengths
				);
				memory = after;
			}
			word++;
		}
		return out;
	}

	/** Offset logistic regression [intercept, treated]; Wald z with word-clustered errors. */
	function test(list) {
		let b0 = 0,
			b1 = 0;
		for (let it = 0; it < 30; it++) {
			let g0 = 0,
				g1 = 0,
				h00 = 0,
				h01 = 0,
				h11 = 0;
			for (const r of list) {
				const p = sig(r.offset + b0 + b1 * r.treated);
				const v = p * (1 - p);
				g0 += r.y - p;
				g1 += (r.y - p) * r.treated;
				h00 += v;
				h01 += v * r.treated;
				h11 += v * r.treated;
			}
			const det = h00 * h11 - h01 * h01;
			if (!(det > 0)) return 0;
			const s0 = (h11 * g0 - h01 * g1) / det,
				s1 = (h00 * g1 - h01 * g0) / det;
			b0 += s0;
			b1 += s1;
			if (Math.abs(s0) + Math.abs(s1) < 1e-9) break;
		}
		let h00 = 0,
			h01 = 0,
			h11 = 0;
		const score = new Map();
		for (const r of list) {
			const p = sig(r.offset + b0 + b1 * r.treated);
			const v = p * (1 - p);
			h00 += v;
			h01 += v * r.treated;
			h11 += v * r.treated;
			const s = score.get(r.word) ?? [0, 0];
			s[0] += r.y - p;
			s[1] += (r.y - p) * r.treated;
			score.set(r.word, s);
		}
		const det = h00 * h11 - h01 * h01;
		const inv = [
			[h11 / det, -h01 / det],
			[-h01 / det, h00 / det]
		];
		let m00 = 0,
			m01 = 0,
			m11 = 0;
		for (const [a, c] of score.values()) {
			m00 += a * a;
			m01 += a * c;
			m11 += c * c;
		}
		// V = inv · M · inv, element [1][1].
		const r1 = [inv[1][0] * m00 + inv[1][1] * m01, inv[1][0] * m01 + inv[1][1] * m11];
		const v11 = r1[0] * inv[0][1] + r1[1] * inv[1][1];
		return b1 / Math.sqrt(v11);
	}

	// What a shift means in points, over the measured outcomes' recall (true, and observed with noise).
	const pilot = simulate(20000, 0, 1, 0, random(5));
	const points = (beta) => {
		let t = 0,
			o = 0;
		for (const r of pilot) {
			const shifted = sig(logit(Math.min(Math.max(r.recall, 1e-9), 1 - 1e-9)) + beta);
			t += shifted - r.recall;
			o += (1 - fs - ff) * (shifted - r.recall);
		}
		return { truePts: (100 * t) / pilot.length, obsPts: (100 * o) / pilot.length };
	};
	const baseObs = pilot.reduce((s, r) => s + fs + (1 - fs - ff) * r.recall, 0) / pilot.length;
	const baseFail = 1 - baseObs;

	const sinceDate = Date.parse('2026-10-03T22:00:00Z');
	const exported = Date.parse(data.exportedAt);
	const weekly =
		(rows.filter((r) => Date.parse(r.at) >= sinceDate).length /
			((exported - sinceDate) / 86_400_000)) *
		7;
	const recent = rows.filter((r) => Date.parse(r.at) >= exported - 7 * 86_400_000).length;

	const grid = [250, 500, 1000, 2000, 4000, 8000, 16000, 32000, 64000];
	const betas = [0, -1, -0.5, 0.25, 0.5, 1, 1.5];
	const scenarios = [
		{
			name: `A. as measured: ${(100 * treatedShare).toFixed(0)}% of outcomes had a listen-only exposure since the last evidence`,
			share: treatedShare,
			sigma: 0
		},
		{
			name: 'B. the same, with words differing beyond FSRS (σ = 0.7 logit per word)',
			share: treatedShare,
			sigma: 0.7
		},
		{ name: 'C. a rare kind: 5% of outcomes exposed', share: 0.05, sigma: 0 }
	];
	const lines = [];
	const L = (s = '') => lines.push(s);
	L('# Issue #29, step 4 — power simulation');
	L();
	L(
		`Simulator: fit.test.ts's \`simulate\`, extended (scripts/analysis-29/power.mjs). Truth = the set in force (${data.active.id}) with its label noise (falseSuccess ${fs.toFixed(3)}, falseFailure ${ff.toFixed(3)}). Starting stabilities, outcomes per word (clustering) and gaps drawn from the ${rows.length} measured scored outcomes. An exposure FSRS does not see raises true recall by a logit shift β before a share of outcomes. Test: offset logistic regression, word-clustered Wald, two-sided 5%; power from ${REPS} simulated histories per cell; N = total scored outcomes for 80% power, interpolated on the grid ${grid.join(', ')} (">" = not reached).`
	);
	L();
	L(
		`Measured base: predicted understanding ${(100 * baseObs).toFixed(1)}% observed-scale (failures ${(100 * baseFail).toFixed(1)}%); recall is near its ceiling, and the noise caps observed understanding at ${(100 * (1 - ff)).toFixed(1)}%. So effects are planted as logit shifts and shown in the points they come to here. Weeks at two rates: ${weekly.toFixed(0)} scored outcomes a week (mean since 2026-10-04) and ${recent} (the 7 days before the export). The exposure is assigned at random here, so this is the power of a randomised comparison or of an observational one whose confounders are fully modelled; confounding (bike listening falls on common, already-watched words) is not simulated. The test's false-positive rate is in each table's β = 0 row: with few exposed outcomes it is far above 5%, so a small-N "power" there means nothing.`
	);
	L();
	for (const sc of scenarios) {
		L(`## ${sc.name}`);
		L();
		L(
			`| β (logit) | true recall points | observed points | failures change | power at each N | N for 80% | exposed outcomes in it | weeks at ${weekly.toFixed(0)}/week | weeks at ${recent}/week |`
		);
		L('|---:|---:|---:|---:|---|---:|---:|---:|---:|');
		for (const beta of betas) {
			const { truePts, obsPts } = points(beta);
			const powers = [];
			for (const n of beta === 0 ? [250, 1000, 4000, 16000] : grid) {
				let hits = 0;
				for (let rep = 0; rep < REPS; rep++) {
					const z = test(
						simulate(
							n,
							beta,
							sc.share,
							sc.sigma,
							random(1000 * n + rep + Math.round(beta * 97) + Math.round(sc.share * 1e4))
						)
					);
					if (Math.abs(z) > 1.959964) hits++;
				}
				powers.push(hits / REPS);
				if (hits / REPS >= 0.95) break;
			}
			let need = null;
			for (let i = 0; i < powers.length; i++)
				if (powers[i] >= 0.8) {
					if (i === 0) need = grid[0];
					else {
						const [a, b] = [powers[i - 1], powers[i]];
						need = Math.round(
							Math.exp(
								Math.log(grid[i - 1]) +
									((0.8 - a) / (b - a)) * (Math.log(grid[i]) - Math.log(grid[i - 1]))
							)
						);
					}
					break;
				}
			const failChange = (-obsPts / (100 * baseFail)) * 100;
			if (beta === 0) {
				L(
					`| 0 (no effect: false positives) | 0 | 0 | 0 | ${powers.map((p, i) => `${grid[i]}:${(100 * p).toFixed(0)}%`).join(' ')} | — | — | — | — |`
				);
				continue;
			}
			L(
				`| ${beta} | ${truePts.toFixed(1)} | ${obsPts.toFixed(1)} | ${failChange > 0 ? '+' : '−'}${Math.abs(failChange).toFixed(0)}% | ${powers.map((p, i) => `${grid[i]}:${(100 * p).toFixed(0)}%`).join(' ')} | ${need ? need : `>${grid[powers.length - 1]}`} | ${need ? Math.round(need * sc.share) : '—'} | ${need ? (need / weekly).toFixed(1) : '—'} | ${need ? (need / recent).toFixed(1) : '—'} |`
			);
			console.error(`${sc.name.slice(0, 20)} beta ${beta}: ${need}`);
		}
		L();
	}
	// The issue's own estimate, for comparison: two proportions, no clustering, no label noise.
	const n2 = (p1, p2) =>
		Math.ceil(((1.959964 + 0.841621) ** 2 * (p1 * (1 - p1) + p2 * (1 - p2))) / (p1 - p2) ** 2);
	L('## The issue\'s estimate ("700 outcomes per group for 5 points")');
	L();
	L(
		`Two independent proportions, 80% power, two-sided 5%, no clustering and no label noise: 85% vs 90% needs ${n2(0.85, 0.9)} per group; 50% vs 55% needs ${n2(0.5, 0.55)}; 92.5% vs 97.5% needs ${n2(0.925, 0.975)}; 2 points at 85% vs 87% needs ${n2(0.85, 0.87)}. So "700 per group" matches a base near 85–90%. Here the base is ${(100 * baseObs).toFixed(1)}% with a noise ceiling of ${(100 * (1 - ff)).toFixed(1)}%: a 5-point gain cannot occur on average, and the simulation above gives the sizes that can.`
	);
	await writeFile(`${dir}/power.md`, lines.join('\n') + '\n');
	console.log(`wrote ${dir}/power.md`);
} finally {
	await server.close();
}
