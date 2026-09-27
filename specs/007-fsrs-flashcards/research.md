# Research: Flashcards That Know What I Read And Watched

## R1 — Scheduler library: ts-fsrs 5.4.2, FSRS-6 defaults

**Decision**: `ts-fsrs` 5.4.2 (MIT, pure TypeScript, no dependencies), `enable_fuzz: false`,
`enable_short_term: true`. **Parameters: the reader's own, fitted by Anki** (the reader's choice,
2026-09-27): the 21 FSRS-6 weights and target recall of the preset their cards were scheduled with,
read from the collection by the export and kept in the history as an `anki-parameters` encounter.
ts-fsrs's defaults only when no import has brought any. Measured: the "Default" preset holds 21
weights with w20 = 0.2641, which is the `decay` all 2,128 studied cards carry, against the default's
0.154 — so the defaults would have given Anki words different recall and due dates than Anki does.
Reading fitted parameters is not fitting them, which stays out of scope.

**Measured** (scratchpad, 2026-09-27, not trusted from docs): `fsrs().parameters.w.length` is 21; a
card built from `{stability: 400, difficulty: 5, state: Review, last_review: 2026-03-01}` gives
`get_retrievability` 0.938 on 2026-09-27, and an `Again` on it gives stability 5.7 days. So seeding
from Anki's numbers works through the public API with no private fields. `dist/index.mjs` is the
file bundled; the 656 KB is mostly maps and the UMD copy.

**Why**: fuzz off makes a replay deterministic, which SC-007 (rebuild equals incremental) needs.
Short-term on gives learning steps in minutes, which is what makes an `Again` come back in the same
session (FR-022).

**Rejected**: `fsrs-rs`/`@open-spaced-repetition/binding` (WASM, only needed to fit parameters: out
of scope); writing FSRS ourselves (the formulas change per version; the library tracks them).

## R2 — Encounter log shape (the reader's choice, 2026-09-27)

**Decision**: two new earned tables, `session` and `encounter`. `encounter` has typed columns for
what every event has, a free-text `kind`, and a JSON `detail` for per-kind extras. Flashcard reviews
are `kind = 'review'`. See data-model.md.

**Why**: the same argument as free-text word states (FR-006a of spec 001): a new kind of encounter
is data, not a migration, and "recorded as facts, not conclusions" (FR-008) is easier to keep when
no column names a conclusion. The columns every consumer filters on (session, document, offsets,
lexeme, kind, device order) are typed and indexed, so nothing important is buried in JSON.

**Sessions are append-only too.** The attention answer arrives at the end, so it is an encounter
(`kind = 'attention'`) rather than an update to the session row. A session has no end column: its
end is its last encounter.

**Ordering**: encounters take their `device_seq` from the same `device.next_seq` counter as
`status_event`, so marks, imports and encounters on one device share one total order. The scheduler
replays them together.

**Rejected**: a typed table per kind (the reader's other option: stricter, but every new kind is a
migration); putting encounters in `status_event` (its `asserted` means a judgment, and
`projectStates` would read "lookup" as a state).

## R3 — Played and read ranges: appended chunks, flushed every 5 s

**Decision**: a stretch read or played is `kind = 'played'` (media) or `'read'` (text), with
`from_offset`/`to_offset` in the document and, for media, `media_ms`/`detail.toMs`. A long stretch
is written as consecutive chunks: flushed every 5 s of playback, on pause, on seek, on leaving, and
when the page is hidden. Each flush is one small transaction through the worker.

**Why**: the log is append-only, so a "current range" row cannot be extended in place; chunks can be
merged by any reader of the log. Five-second flushes bound the loss on a kill (SC-002). An hour of
video is ~720 rows: small.

**Read ranges in texts**: the lines on screen for at least 2 s, recorded when scrolling settles.
Rough on purpose: it says "this was in front of the reader", which is all the rule uses.

**Skips** (FR-003) are the gaps between played chunks. A seek is also recorded as `kind = 'seek'`
with from/to media time, because a gap alone cannot tell "sought past" from "app closed".

## R4 — What anchors an encounter

**Decision**: every encounter carries `document_id` and code-point offsets. Lookups, checks and
reviews also carry the `lexeme_id` the word had when it happened. Ranges carry no lexeme: which
words they covered is derived by intersecting them with the document's *current* tokens.

**Why**: the register's rule ("encounters derived by intersecting sessions with tokens, so
re-segmenting retroactively corrects history"). The lexeme on a lookup is what the reader actually
tapped. If the tokens change later, the offsets still say where; a future merge or split can
redistribute.

## R5 — The evidence rule, version `evidence-1`

**Decision**: one pure function in the domain core turns the history into, per (lexeme, skill), an
ordered list of `(moment, rating)`, which ts-fsrs folds. First version:

| Event | Reading | Listening |
|---|---|---|
| Anki seed (status_event with provenance `anki …`) | initial Review card from s, d, last review | — |
| lookup | Again | Again |
| check ("I knew it") | Hard, if the text was visible or it is a text | Hard, if media with the text hidden |
| review | its grade | its grade (none in this slice) |
| lookup, Anki seed, hand mark `learning` | **creates the card** (R8) | — |
| word in a `read`/`played` range of a session answered `all`, no lookup of it in that session, word already has a state in that skill | Hard, if text or text visible | Hard, if media with text hidden |
| anything else (dismissed or `some`/`none` answers, replays, translations, speed) | — | — |

Limits: lookups of one word in one session count once. Passive evidence counts at most once per
word, skill and day. After a word's first in-app review, later Anki seeds are ignored (FR-015).
Words whose current hand mark is `ignored` get no memory at all.

**Why a lookup fails both skills**: not knowing the meaning when seeing the characters implies not
knowing it when hearing them. **Why passive success is Hard, not Good**: FSRS has no "weak" rating,
and Hard grows stability least. **Why only `all`**: only then does "not tapped" mean "understood".
These are guesses. The rule's name is stored on every memory row (FR-012), so a better one is a
background recompute (R6).

## R6 — Memory as a derived cache, recomputed per word

**Decision**: a derived table `memory(lexeme_id, skill, …, rule)`. Whenever an event touches a word,
that word's rows are recomputed by replaying its **whole** history through the rule, in the same
transaction as the event. A word's history is tens of events, and one ts-fsrs step takes
microseconds.

**Why whole-history replay rather than one incremental step**: it is the same code path as the full
rebuild, so SC-007 (rebuild equals incremental) holds by construction for everything except the
choice of which words to recompute, and that choice is what the test must catch. It also means the
passive-evidence condition ("already has a state") never depends on update order.

**Which words an event touches**: a lookup, check or review touches its lexeme. An attention answer
touches every word in that session's ranges that has a memory row. A new Anki seed touches its word.

**Rule change** (Principle VIII): rows whose `rule` is not the current one stay in use, and the
existing background sweep recomputes them a batch at a time. This is the same pattern as the
analyzer upgrade.

## R7 — Colouring by recall

**Decision**: pages get memory rows next to word states (`getStates` also returns
`stability`/`lastAt` per skill). The page computes today's recall with ts-fsrs's forgetting curve
when it draws. Four bands for the reading skill: ≥ 95 %, 85–95 %, 70–85 %, < 70 %. A word with no
memory row keeps its hand-mark class, as today. The four Anki-level classes stop being used for
display; the events that carry them stay.

**Why compute at draw time**: recall changes with the clock, not with events, so storing it would be
stale by tomorrow.

**A word still being learned is band 4 whatever its recall** (found in the browser, 2026-09-27): right
after a lookup FSRS puts recall at 100 %, because the answer was just shown, and it falls within
hours at a stability of 0.2 days. Coloured by recall alone, a word the reader did not know looked
solid. `colourBand` shows Learning and Relearning cards as fragile; recall decides from Review on.

## R8 — Cards and the queue: derived, nothing stored but reviews

**Decision** (corrected by the reader, 2026-09-27: a card is not made by its first review):
- A word **becomes a card** through a **card-creating event**, and the list of those is part of the
  rule (`evidence-1`): a lookup, an Anki seed, a hand mark of `learning`. Future ways (words in
  skipped lines, a "make a card" button) are added to the rule, and a recompute creates their cards.
  A word currently marked `ignored` is never a card.
- A card is **new** until its first in-app review, and **due** when its due date ≤ now.
- **New shown today** = new cards ranked by token count across the library, up to the day's cap
  (default 10, in `localStorage` like the playback speed) minus the cards first reviewed today. The
  rest stay cards and wait; the cap limits introductions, not creation.
- The queue is due cards that have been reviewed (most overdue first), then Anki-seeded due cards,
  then new ones. An Again answer's short-term step puts the card back within the session.

**Why card membership is derived, not stored**: every trigger is already an event, so a stored "card
created" row would be a second source of truth. It would also stop a new trigger from applying to
the history already recorded.

## R9 — The card's sentence and reveal

**Decision**:
- **Sentence**: the line (media) or sentence (text, split on 。！？ and newlines) containing the
  first lookup's offsets. On later reviews, the next other occurrence of the lexeme in the library
  whose line differs from the last review's `detail.sentence`. The review records the offsets it
  showed.
- **Reveal**: pinyin and meaning from the existing `lookUp`. The translation is the media line's
  stored English (LLM, else quick). Otherwise the in-browser quick model is asked for that one
  sentence. Otherwise it is left out.

## R10 — Anki export format 2

**Decision**: `export_words.py` adds `difficulty` (the card data's `d`) and `lastReview` (ISO time of
the card's newest `revlog` entry), still read-only from a copy. The provenance becomes
`anki <import> s=<s> d=<d> r=<lastReview>`. The format-1 provenance still parses, with difficulty 5
and the import's date as the last review, which is recorded as such (FR-014). `sameStrength`
compares `s=` as before, so a re-import of an unchanged collection still writes nothing.

## R11 — Deleting a document (the reader's choice, 2026-09-27)

**Decision**: delete removes the media files and sets `document.removed_at`. The library hides the
document; its text and tokens stay, so encounters, reviews and card sentences keep their context. A
document with no events of either kind is still deleted outright, as today.

## R12 — Copies carry encounters: copy format 2

**Decision**: `CopyBody` gains `sessions` and `encounters`, with words as `(language, surface)` as
events already are, and documents gain `removedAt`. `upgrade()` turns format 1 into 2 with empty
arrays. Restore re-links sessions and encounters by device and sequence.

## R13 — The attention question

**Decision**: on leaving a session with ≥ 30 s read or played, a small sheet asks with three answers
(`all`, `some`, `none`) and can be dismissed. A dismissal is recorded as `kind = 'attention'` with
`detail.answer = null`. The app's own estimate is not stored; it is derivable from lookups per
minute, and `evidence-1` does not use it.
