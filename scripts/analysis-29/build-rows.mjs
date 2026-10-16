// Issue #29, step 2: one row per in-context outcome, with FSRS's prediction under the set in force
// and every attribute the history records. Reads a learning-data export (format 2) and a library
// backup (format 3) of the same library; writes rows.csv, sessions.csv and words.csv to OUT_DIR.
// Read-only; personal data stays in OUT_DIR. See README.md for what each column means.
//
//   node scripts/analysis-29/build-rows.mjs EXPORT.json BACKUP.json OUT_DIR

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const [exportPath, backupPath, outDir] = process.argv.slice(2);
if (!exportPath || !backupPath || !outDir)
	throw new Error('Usage: node scripts/analysis-29/build-rows.mjs EXPORT BACKUP OUT_DIR');
const root = fileURLToPath(new URL('../../', import.meta.url));
const TZ = 'Europe/Brussels';
const DAY = 86_400_000;
const HAN = /^[㐀-鿿豈-﫿]+$/u;

const server = await createServer({
	root,
	configFile: false,
	appType: 'custom',
	logLevel: 'error',
	server: { middlewareMode: true, watch: null, hmr: false, ws: false }
});
try {
	const load = (p) => server.ssrLoadModule(p);
	const { reviewPredictions, strengthened, evidenceFor } = await load('/src/lib/domain/memory.ts');
	const { validateDataset, clockAmbiguous } = await load('/src/lib/domain/tuning.ts');
	const { prepare } = await load('/src/lib/domain/replay.ts');
	const { nextState, retrievability } = await load('/src/lib/domain/fsrs6.ts');
	const { ankiSeedOf } = await load('/src/lib/domain/anki.ts');
	const { helpOf, isHelped, lineRangesOf } = await load('/src/lib/domain/helped.ts');

	const data = JSON.parse(await readFile(exportPath, 'utf8'));
	validateDataset(data);
	const backup = JSON.parse(await readFile(backupPath, 'utf8'));
	const weights = data.parameters.weights;
	const strengths = data.active?.strengths;
	const fs = data.active?.falseSuccess ?? 0;
	const ff = data.active?.falseFailure ?? 0;

	// ---------- lexicon files
	const lines = async (p) => (await readFile(root + p, 'utf8')).split('\n');
	const wordlist = new Set(
		(await lines('static/wordlist-zh.txt'))
			.filter((l) => l && !l.startsWith('#'))
			.map((l) => l.split('\t')[0])
	);
	const freqRank = new Map();
	(await lines('src/lib/domain/frequency-zh.txt'))
		.slice(1)
		.forEach((w, i) => w && freqRank.set(w, i + 1));

	// ---------- backup indexes
	const encBySeq = new Map(backup.encounters.map((e) => [e.deviceSeq, e]));
	const evBySeq = new Map(backup.events.map((e) => [e.deviceSeq, e]));
	const docs = new Map(
		backup.documents.map((d) => [d.id, { ...d, chars: Array.from(d.rawContent) }])
	);
	for (const d of docs.values()) {
		d.lineRanges = lineRangesOf(d.chars);
		d.text = d.chars.join('');
	}
	// A video's identity: its YouTube id, or for a removed document (no metadata) the title's.
	const byTitle = new Map();
	for (const d of docs.values()) if (d.media?.meta?.id) byTitle.set(d.title, d.media.meta);
	const metaOf = (d) => (d.media?.meta?.id ? d.media.meta : (byTitle.get(d.title) ?? {}));
	const videoOf = (docId) => metaOf(docs.get(docId)).id ?? `title:${docs.get(docId).title}`;
	const creatorOf = (docId) => metaOf(docs.get(docId)).uploader ?? 'unknown';
	const lineOf = (d, offset) => {
		const r = d.lineRanges;
		let lo = 0,
			hi = r.length - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (r[mid][0] <= offset) lo = mid;
			else hi = mid - 1;
		}
		return lo;
	};

	// ---------- sessions
	const withdrawn = new Set(
		backup.encounters.filter((e) => e.kind === 'withdrawn').map((e) => e.session.deviceSeq)
	);
	const sessions = new Map();
	for (const s of backup.sessions)
		sessions.set(s.deviceSeq, {
			seq: s.deviceSeq,
			doc: s.documentId,
			modality: s.modality,
			start: Date.parse(s.startedAt),
			encounters: [],
			answer: undefined,
			engagement: null,
			withdrawn: withdrawn.has(s.deviceSeq)
		});
	for (const e of backup.encounters) {
		if (!e.session) continue;
		const s = sessions.get(e.session.deviceSeq);
		if (!s) continue;
		s.encounters.push(e);
	}
	for (const s of sessions.values()) {
		s.encounters.sort((a, b) => a.deviceSeq - b.deviceSeq);
		const enc = s.encounters;
		for (const e of enc) {
			if (e.kind === 'attention') s.answer = e.detail.answer;
			if (e.kind === 'engagement') s.engagement = e.detail;
		}
		const played = enc.filter((e) => e.kind === 'played' || e.kind === 'read');
		s.activityMs = enc
			.filter((e) => e.kind === 'study-time')
			.reduce((t, e) => t + (e.detail.durationMs ?? 0), 0);
		s.end = Math.max(s.start, ...enc.map((e) => Date.parse(e.at)));
		s.played = played.length;
		// Media time played, from each chunk's start and end positions (study-time starts 2026-09-30).
		s.playedMin =
			played.reduce(
				(t, e) => t + Math.max(0, (e.detail.toMs ?? e.mediaMs ?? 0) - (e.mediaMs ?? 0)),
				0
			) / 60000;
		s.hiddenShare = played.length
			? played.filter((e) => e.textVisible === false).length / played.length
			: null;
		const speeds = played.map((e) => e.speed).filter((x) => x !== undefined);
		s.speed = speeds.length ? speeds.sort((a, b) => a - b)[speeds.length >> 1] : null;
		s.replays = enc.filter((e) => e.kind === 'replay').length;
		s.seeks = enc.filter((e) => e.kind === 'seek').length;
		s.translations = enc.filter((e) => e.kind === 'translation').length;
		s.lookups = enc.filter((e) => e.kind === 'lookup' || e.kind === 'check').length;
		s.reviews = enc.filter((e) => e.kind === 'review').length;
		const d = docs.get(s.doc);
		s.help = d
			? helpOf(
					enc.map((e) => ({ kind: e.kind, fromOffset: e.from, toOffset: e.to, detail: e.detail })),
					d.lineRanges
				)
			: { whole: false, spans: [] };
		s.video = d ? videoOf(s.doc) : `doc:${s.doc}`;
		s.creator = d ? creatorOf(s.doc) : 'unknown';
		s.linesPlayed = new Set();
		if (d)
			for (const e of played) {
				const a = lineOf(d, e.from),
					b = lineOf(d, Math.max(e.from, e.to - 1));
				for (let i = a; i <= b; i++) s.linesPlayed.add(i);
			}
		// The kind (choices recorded in README.md): the reader's latest answers decide.
		const mode = s.engagement?.mode ?? null;
		const att = s.engagement?.attentive ?? null;
		s.kind =
			s.modality === 'hardcore'
				? 'hardcore'
				: s.withdrawn
					? 'withdrawn'
					: mode === 'listened'
						? 'listen-only'
						: s.answer === 'all'
							? 'attentive'
							: s.answer === 'none' || att === 'no'
								? 'inattentive'
								: s.answer === 'some' || att === 'partly'
									? 'partial'
									: 'unanswered';
		s.hardcoreWatch = enc.some((e) => e.kind === 'hardcore-watch');
	}
	const ordered = [...sessions.values()].sort((a, b) => a.start - b.start);
	for (const s of ordered) {
		const earlier = ordered.filter((o) => o.start < s.start && o.video === s.video && o.played > 0);
		s.rewatch = earlier.length > 0;
		s.videoViewingsBefore = earlier.length;
		const seenLines = new Set(earlier.flatMap((o) => (o.doc === s.doc ? [...o.linesPlayed] : [])));
		s.linesSeenShare = s.linesPlayed.size
			? [...s.linesPlayed].filter((l) => seenLines.has(l)).length / s.linesPlayed.size
			: null;
	}

	// ---------- word surfaces: from marks and taps, else inferred from where the word was played
	const surfaceOf = new Map();
	const sourceOf = new Map();
	for (const w of data.words) {
		const s = new Set();
		for (const m of w.history.marks)
			if (evBySeq.get(m.deviceSeq)) s.add(evBySeq.get(m.deviceSeq).surface);
		for (const e of w.history.events)
			if (encBySeq.get(e.deviceSeq)?.surface) s.add(encBySeq.get(e.deviceSeq).surface);
		if (s.size === 1) {
			surfaceOf.set(w.id, [...s][0]);
			sourceOf.set(w.id, 'recorded');
		}
	}
	const used = new Set(surfaceOf.values());
	const playedByDoc = new Map();
	for (const e of backup.encounters)
		if ((e.kind === 'played' || e.kind === 'read') && !withdrawn.has(e.session?.deviceSeq)) {
			if (!playedByDoc.has(e.documentId)) playedByDoc.set(e.documentId, []);
			playedByDoc.get(e.documentId).push(e);
		}
	const occurrences = (text, c) => {
		const out = [];
		let i = -1;
		while ((i = text.indexOf(c, i + 1)) >= 0) out.push(i);
		return out;
	};
	// UTF-16 index → code point index differs only past astral characters; the texts are converted.
	const cpIndex = (d) =>
		d._cp ??
		(d._cp = (() => {
			const m = [];
			let cp = 0;
			for (let i = 0; i < d.text.length; i++) {
				m[i] = cp;
				if (d.text.codePointAt(i) > 0xffff) {
					i++;
					m[i] = cp;
				}
				cp++;
			}
			return m;
		})());
	const occCp = (d, c) => occurrences(d.text, c).map((i) => cpIndex(d)[i]);
	const expectedGroups = (c) => {
		const groups = new Map();
		for (const [id, ps] of playedByDoc) {
			const occ = occCp(docs.get(id), c);
			if (!occ.length) continue;
			for (const e of ps)
				for (const s of occ)
					if (e.from < s + [...c].length && e.to > s) {
						const k = `${e.session.deviceSeq} ${e.textVisible}`;
						if (!groups.has(k)) groups.set(k, new Set());
						groups.get(k).add(e.deviceSeq);
						break;
					}
		}
		return groups;
	};
	for (const w of data.words) {
		if (surfaceOf.has(w.id) || !w.history.exposures.length) continue;
		let cand = null;
		for (const x of w.history.exposures) {
			const e = encBySeq.get(x.deviceSeq);
			const d = docs.get(e.documentId);
			const c = new Set();
			for (let s = Math.max(0, e.from - 6); s < e.to; s++)
				for (let L = 1; L <= 6; L++) {
					if (s + L <= e.from) continue;
					const sub = d.chars.slice(s, s + L).join('');
					if ([...sub].length === L && HAN.test(sub)) c.add(sub);
				}
			cand = cand ? new Set([...cand].filter((z) => c.has(z))) : c;
		}
		const ranked = [...cand]
			.filter((z) => !used.has(z))
			.map((c) => {
				const g = expectedGroups(c);
				let hit = 0;
				for (const x of w.history.exposures) {
					const e = encBySeq.get(x.deviceSeq);
					if (g.get(`${e.session.deviceSeq} ${e.textVisible}`)?.has(x.deviceSeq)) hit++;
				}
				return {
					c,
					recall: hit / w.history.exposures.length,
					precision: w.history.exposures.length / g.size,
					wl: wordlist.has(c)
				};
			})
			.filter((r) => r.recall === 1)
			.sort((a, b) => b.precision - a.precision || b.wl - a.wl || b.c.length - a.c.length);
		if (!ranked.length) continue;
		const top = ranked[0];
		const tied = ranked.filter((r) => r.precision === top.precision && r.wl === top.wl).length;
		surfaceOf.set(w.id, top.c);
		sourceOf.set(
			w.id,
			top.precision === 1 && tied === 1
				? 'inferred'
				: `inferred-uncertain(p=${top.precision.toFixed(2)},ties=${tied})`
		);
	}

	// ---------- every word's reading memory over time, for coverage of a line
	const DAYF = (from, to) => Math.floor(to / DAY) - Math.floor(from / DAY);
	function trajectory(history) {
		const [reading] = prepare(history);
		const out = [];
		let memory = reading.seed?.memory;
		let last = reading.seed?.lastReview;
		if (memory) out.push({ at: last, s: memory.stability });
		let latest = last ?? -Infinity;
		for (const step of reading.steps) {
			latest = Math.max(latest, step.at);
			const t = last === undefined ? 0 : DAYF(last, latest);
			const next = nextState(weights, memory, Math.max(t, 0), step.grade);
			if (step.from)
				next.stability = strengthened(
					memory?.stability ?? 0,
					next.stability,
					step.from,
					'reading',
					strengths,
					step.rewatchDays
				);
			memory = next;
			last = latest;
			out.push({ at: latest, s: memory.stability, d: memory.difficulty });
		}
		return out;
	}
	const recallAt = (traj, t) => {
		let k = -1;
		for (let i = 0; i < traj.length && traj[i].at < t; i++) k = i;
		if (k < 0) return null;
		return retrievability(weights, Math.max(Math.floor((t - traj[k].at) / DAY), 0), traj[k].s);
	};
	const trajBySurface = new Map();
	const wordById = new Map();
	for (const w of data.words) {
		const h = { ...w.history, answers: new Map(w.history.answers) };
		wordById.set(w.id, h);
		const s = surfaceOf.get(w.id);
		if (s) trajBySurface.set(s, trajectory(h));
	}
	// Words outside the export: only an Anki seed can give them a memory (no tap, review or attentive reading).
	const seedBySurface = new Map();
	const ignored = new Set(backup.states.filter((s) => s.state === 'ignored').map((s) => s.surface));
	for (const e of [...backup.events].sort((a, b) => a.deviceSeq - b.deviceSeq)) {
		const seed = ankiSeedOf(e.provenance);
		if (seed)
			seedBySurface.set(e.surface, [{ at: Date.parse(seed.lastReview), s: seed.stability }]);
	}
	const lexicon = new Set([...wordlist, ...trajBySurface.keys(), ...seedBySurface.keys()]);
	const segment = (text) => {
		const out = [];
		const cs = [...text];
		for (let i = 0; i < cs.length;) {
			let L = Math.min(6, cs.length - i);
			while (L > 1 && !lexicon.has(cs.slice(i, i + L).join(''))) L--;
			out.push(cs.slice(i, i + L).join(''));
			i += L;
		}
		return out;
	};
	const coverage = (lineText, target, t) => {
		const parts = lineText.split(target);
		const toks = parts.flatMap(segment).filter((x) => HAN.test(x) && !ignored.has(x));
		let sum = 0,
			known = 0,
			fresh = 0;
		for (const tok of toks) {
			const traj = trajBySurface.get(tok) ?? seedBySurface.get(tok);
			const r = traj ? (recallAt(traj, t) ?? 0) : 0;
			if (!traj || recallAt(traj, t) === null) fresh++;
			sum += r;
			if (r >= 0.9) known++;
		}
		return {
			n: toks.length,
			mean: toks.length ? sum / toks.length : null,
			known90: toks.length ? known / toks.length : null,
			fresh
		};
	};
	const libraryCount = new Map();
	const libDocs = [...docs.values()].filter((d) => !d.removedAt);
	const libFreq = (s) => {
		if (!libraryCount.has(s)) {
			let n = 0,
				k = 0;
			for (const d of libDocs) {
				const c = occurrences(d.text, s).length;
				n += c;
				if (c) k++;
			}
			libraryCount.set(s, [n, k]);
		}
		return libraryCount.get(s);
	};

	// ---------- line viewings, per document line, by session
	const lineViews = new Map(); // `${doc} ${line}` → [{session, at, kind}]
	for (const s of ordered) {
		if (s.withdrawn) continue;
		const d = docs.get(s.doc);
		if (!d) continue;
		for (const e of s.encounters)
			if (e.kind === 'played' || e.kind === 'read') {
				const a = lineOf(d, e.from),
					b = lineOf(d, Math.max(e.from, e.to - 1));
				for (let i = a; i <= b; i++) {
					const k = `${s.doc} ${i}`;
					if (!lineViews.has(k)) lineViews.set(k, []);
					lineViews.get(k).push({
						session: s.seq,
						at: Date.parse(e.at),
						kind: s.kind,
						hidden: e.textVisible === false
					});
				}
			}
	}

	// ---------- the rows
	const local = new Intl.DateTimeFormat('en-GB', {
		timeZone: TZ,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		hour12: false,
		weekday: 'short'
	});
	const localParts = (ms) =>
		Object.fromEntries(local.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
	const weekOf = (ms) => {
		const p = localParts(ms);
		const date = Date.UTC(+p.year, +p.month - 1, +p.day);
		const dow = (new Date(date).getUTCDay() + 6) % 7;
		return new Date(date - dow * DAY).toISOString().slice(0, 10);
	};
	const sessionOfExport = new Map(); // export session id → backup session seq
	for (const w of data.words)
		for (const x of [...w.history.exposures, ...w.history.events])
			if (x.sessionId !== undefined && encBySeq.get(x.deviceSeq)?.session)
				sessionOfExport.set(x.sessionId, encBySeq.get(x.deviceSeq).session.deviceSeq);

	const rows = [];
	const scoredTimes = []; // every scored outcome, cards too: the fit's 80% cutoff is over all of them
	let checked = 0,
		mismatched = 0;
	for (const w of data.words) {
		const h = wordById.get(w.id);
		if (clockAmbiguous(h)) continue;
		const all = reviewPredictions(h, data.parameters, strengths);
		for (const p of all) if (p.probability !== null) scoredTimes.push(Date.parse(p.at));
		const preds = all.filter((p) => p.type === 'in-context');
		if (!preds.length) continue;
		const surface = surfaceOf.get(w.id) ?? '';
		const traj = trajectory(h);
		const evidence = evidenceFor(h).reading.evidence.map((e) => Date.parse(e.at));
		const exps = h.exposures.map((x) => ({
			...x,
			t: Date.parse(x.at),
			s: sessions.get(sessionOfExport.get(x.sessionId))
		}));
		const taps = h.events
			.filter((e) => e.kind === 'lookup' || e.kind === 'check')
			.map((e) => Date.parse(e.at));
		const reviews = h.events.filter((e) => e.kind === 'review' && !e.detail.hardcore);
		const drills = h.events.filter((e) => e.kind === 'review' && e.detail.hardcore);
		for (const p of preds) {
			const t = Date.parse(p.at);
			const enc = encBySeq.get(p.deviceSeq);
			const s = sessions.get(enc.session.deviceSeq);
			const d = docs.get(enc.documentId);
			// The occurrence: a tap's own offsets; for a played chunk, the word's first occurrence in it.
			let occ = enc.kind === 'lookup' || enc.kind === 'check' ? enc.from : null;
			if (occ === null && surface) {
				const L = [...surface].length;
				occ = occCp(d, surface).find((o) => enc.from < o + L && enc.to > o) ?? null;
			}
			const line = lineOf(d, occ ?? enc.from);
			const [ls, le] = d.lineRanges[line];
			const lineText = d.chars.slice(ls, le).join('');
			// Memory before this outcome: the last evidence strictly before it.
			let k = -1;
			for (let i = 0; i < traj.length && traj[i].at < t; i++) k = i;
			const stability = k >= 0 ? traj[k].s : null;
			const elapsed = k >= 0 ? (t - traj[k].at) / DAY : null;
			if (p.probability !== null && k >= 0) {
				checked++;
				const mine = retrievability(weights, Math.max(Math.floor(elapsed), 0), stability);
				if (Math.abs(mine - p.probability) > 1e-6) mismatched++;
			}
			const lastEvidence = evidence.filter((a) => a < t).at(-1) ?? null;
			const before = exps.filter((x) => x.t < t && x.s && x.s.seq !== s.seq);
			const since = before.filter((x) => lastEvidence === null || x.t > lastEvidence);
			const byKind = (list, kind) => list.filter((x) => x.s.kind === kind).length;
			const hiddenText = (list) => list.filter((x) => x.textVisible === false).length;
			const views = (lineViews.get(`${d.id} ${line}`) ?? []).filter(
				(v) => v.at < t && v.session !== s.seq
			);
			const viewSessions = new Map();
			for (const v of views) viewSessions.set(v.session, v);
			const videoBefore = ordered.filter(
				(o) => o.video === s.video && o.start < s.start && o.played > 0 && !o.withdrawn
			);
			// Whole-session counts: a seen outcome is timed at the line's first play and a tap later, so
			// counting only up to the outcome would favour taps by construction. Same-session counts are
			// partly consequences (a line not understood is replayed), not predictors to plan by.
			const linePlayed = s.encounters.filter(
				(e) =>
					(e.kind === 'played' || e.kind === 'read') &&
					lineOf(d, e.from) <= line &&
					lineOf(d, Math.max(e.from, e.to - 1)) >= line
			);
			const linePlays = linePlayed.length;
			const lineFirst = linePlayed.length
				? Math.min(...linePlayed.map((e) => Date.parse(e.at)))
				: t;
			const lineReplays = s.encounters.filter(
				(e) => e.kind === 'replay' && e.detail.line === line
			).length;
			const englishOnLine =
				isHelped(s.help, ls, le) ||
				s.encounters.some((e) => e.kind === 'translation' && e.detail.line === line);
			const cov = surface
				? coverage(lineText, surface, t)
				: { n: null, mean: null, known90: null, fresh: null };
			const lp = localParts(t);
			const lib = surface ? libFreq(surface) : [null, null];
			rows.push({
				word: w.id,
				surface,
				surface_source: sourceOf.get(w.id) ?? 'unknown',
				at: p.at,
				week: weekOf(t),
				local_date: `${lp.year}-${lp.month}-${lp.day}`,
				local_hour: +lp.hour,
				weekday: lp.weekday,
				outcome: p.rating === 1 ? 'tap' : 'seen',
				tap_kind: p.rating === 1 ? enc.kind : '',
				label: p.rating === 1 ? 0 : 1,
				scored: p.probability !== null ? 1 : 0,
				excluded: p.excluded ?? '',
				p_recall: p.probability,
				p_obs: p.probability === null ? null : fs + (1 - fs - ff) * p.probability,
				stability_before: stability,
				days_since_evidence: elapsed,
				seeded: p.seeded ? 1 : 0,
				session: s.seq,
				session_kind: s.kind,
				attention_answer: s.answer === undefined ? 'missing' : String(s.answer),
				engagement_mode: s.engagement?.mode ?? '',
				engagement_attentive: s.engagement?.attentive ?? '',
				hardcore_watch: s.hardcoreWatch ? 1 : 0,
				session_rewatch: s.rewatch ? 1 : 0,
				session_lines_seen_share: s.linesSeenShare,
				session_activity_min: s.activityMs / 60000,
				session_played_min: s.playedMin,
				session_span_min: (s.end - s.start) / 60000,
				minutes_into_session: (lineFirst - s.start) / 60000,
				session_start_hour: +localParts(s.start).hour,
				session_replays: s.replays,
				session_seeks: s.seeks,
				session_lookups: s.lookups,
				session_translations: s.translations,
				session_text_hidden_share: s.hiddenShare,
				english_whole_session: s.help.whole ? 1 : 0,
				english_on_line: englishOnLine ? 1 : 0,
				speed: enc.speed ?? s.speed,
				text_visible: enc.textVisible === undefined ? '' : enc.textVisible ? 1 : 0,
				document: d.id,
				video: s.video,
				creator: s.creator,
				title: d.title.slice(0, 60),
				line,
				line_text: lineText,
				line_chars: [...lineText].length,
				line_plays_in_session: linePlays,
				line_replays_in_session: lineReplays,
				line_view_sessions_before: viewSessions.size,
				line_listen_only_sessions_before: [...viewSessions.values()].filter(
					(v) => v.kind === 'listen-only'
				).length,
				days_since_line_seen: views.length ? (t - Math.max(...views.map((v) => v.at))) / DAY : null,
				rewatch_days:
					enc.kind === 'played'
						? (h.exposures.find((x) => x.deviceSeq === p.deviceSeq)?.rewatchDays ?? null)
						: null,
				video_sessions_before: videoBefore.length,
				video_listen_only_before: videoBefore.filter((o) => o.kind === 'listen-only').length,
				days_since_video: videoBefore.length
					? (t - Math.max(...videoBefore.map((o) => o.end))) / DAY
					: null,
				word_chars: surface ? [...surface].length : null,
				freq_rank: surface ? (freqRank.get(surface) ?? 50001) : null,
				library_count: lib[0],
				library_docs: lib[1],
				prior_exposures: before.length,
				prior_attentive: byKind(before, 'attentive'),
				prior_listen_only: byKind(before, 'listen-only'),
				prior_inattentive: byKind(before, 'inattentive'),
				prior_partial: byKind(before, 'partial'),
				prior_unanswered: byKind(before, 'unanswered'),
				prior_text_hidden: hiddenText(before),
				prior_helped: before.filter((x) => x.helped).length,
				prior_sessions_distinct: new Set(before.map((x) => x.s.seq)).size,
				prior_documents_distinct: new Set(before.map((x) => x.s.doc)).size,
				since_evidence_exposures: since.length,
				since_evidence_listen_only: byKind(since, 'listen-only'),
				since_evidence_inattentive:
					byKind(since, 'inattentive') + byKind(since, 'partial') + byKind(since, 'unanswered'),
				since_evidence_text_hidden: hiddenText(since),
				days_since_any_exposure: before.length
					? (t - Math.max(...before.map((x) => x.t))) / DAY
					: null,
				prior_taps: taps.filter((a) => a < t).length,
				prior_card_reviews: reviews.filter((r) => Date.parse(r.at) < t).length,
				prior_card_again: reviews.filter((r) => Date.parse(r.at) < t && r.detail.grade === 1)
					.length,
				prior_drill_grades: drills.filter((r) => Date.parse(r.at) < t).length,
				line_known_cov: cov.mean,
				line_known90_share: cov.known90,
				line_tokens: cov.n,
				line_new_tokens: cov.fresh
			});
		}
	}
	rows.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

	const csv = (list) => {
		const cols = Object.keys(list[0]);
		const cell = (v) =>
			v === null || v === undefined
				? ''
				: typeof v === 'number'
					? String(Math.round(v * 1e6) / 1e6)
					: /[",\n]/.test(String(v))
						? `"${String(v).replace(/"/g, '""')}"`
						: String(v);
		return (
			[cols.join(','), ...list.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n') + '\n'
		);
	};
	await mkdir(outDir, { recursive: true });
	await writeFile(`${outDir}/rows.csv`, csv(rows));
	await writeFile(`${outDir}/rows.json`, JSON.stringify(rows));
	scoredTimes.sort((a, b) => a - b);
	const cutoff = scoredTimes[Math.floor(scoredTimes.length * 0.8)];
	await writeFile(
		`${outDir}/meta.json`,
		JSON.stringify({
			cutoff: new Date(cutoff).toISOString(),
			scoredAll: scoredTimes.length,
			inForce: data.active?.id,
			falseSuccess: fs,
			falseFailure: ff,
			exportedAt: data.exportedAt,
			timeZone: TZ
		})
	);
	const sessionRows = ordered.map((s) => ({
		session: s.seq,
		start: new Date(s.start).toISOString(),
		week: weekOf(s.start),
		local_hour: +localParts(s.start).hour,
		document: s.doc,
		video: s.video,
		creator: s.creator,
		title: (docs.get(s.doc)?.title ?? '').slice(0, 60),
		modality: s.modality,
		kind: s.kind,
		answer: s.answer === undefined ? 'missing' : String(s.answer),
		mode: s.engagement?.mode ?? '',
		attentive: s.engagement?.attentive ?? '',
		withdrawn: s.withdrawn ? 1 : 0,
		rewatch: s.rewatch ? 1 : 0,
		lines_seen_share: s.linesSeenShare,
		hardcore_watch: s.hardcoreWatch ? 1 : 0,
		activity_min: s.activityMs / 60000,
		played_min: s.playedMin,
		played_chunks: s.played,
		text_hidden_share: s.hiddenShare,
		speed: s.speed,
		replays: s.replays,
		seeks: s.seeks,
		lookups: s.lookups,
		translations: s.translations,
		reviews: s.reviews,
		english_whole: s.help.whole ? 1 : 0
	}));
	await writeFile(`${outDir}/sessions.csv`, csv(sessionRows));
	await writeFile(`${outDir}/sessions.json`, JSON.stringify(sessionRows));
	const reviewRows = backup.encounters
		.filter((e) => e.kind === 'review')
		.map((e) => ({
			at: e.at,
			week: weekOf(Date.parse(e.at)),
			hardcore: e.detail.hardcore ? 1 : 0,
			grade: e.detail.grade
		}));
	await writeFile(`${outDir}/reviews.json`, JSON.stringify(reviewRows));
	const sources = {};
	for (const w of data.words) {
		const k = (sourceOf.get(w.id) ?? 'unknown').split('(')[0];
		sources[k] = (sources[k] ?? 0) + 1;
	}
	console.log(
		JSON.stringify(
			{
				rows: rows.length,
				scored: rows.filter((r) => r.scored).length,
				sessions: sessionRows.length,
				predictionCheck: { checked, mismatched },
				surfaces: sources,
				noise: { falseSuccess: fs, falseFailure: ff },
				inForce: data.active?.id
			},
			null,
			1
		)
	);
} finally {
	await server.close();
}
