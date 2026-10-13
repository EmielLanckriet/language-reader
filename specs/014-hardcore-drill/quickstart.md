# Quickstart: validating spec 014

Synthetic activity only in the isolated setup (`scripts/verify-in-browser/README.md`), never in
the daily reader. Fixtures: the 45–90 s subtitled clip the `media`/`cards` scenarios import, and a
short text.

## Memory rule (earned data, test-first, exact)

`npx vitest run tests/domain/memory.test.ts` with new cases written red first:
- a new word drilled Good once has memory, `card` false, `reviewed` false, not due on Cards;
- a tapped candidate drilled stays a candidate; an untapped word drilled is no candidate;
- drills on later days reaching S ≥ 14 make it a reviewed card; a later Again keeps it active;
- reading after a first drill reaching S ≥ 14 drills it in too (clarified 2026-10-13);
- a set-aside word stays set aside after a drill until drilled in;
- a due active card drilled gets its due date from that grade, as from Cards.
Mutations: drop the hardcore exclusion from `reviewed`, from `card`, from `reviewedSince`; change
14 to 0; make drilled-in non-sticky. Each must go red.

Recorded 2026-10-13: 9 new cases red before the change (7 rule, the retired-by-hand case added,
and the rule key), green after; 605 tests. Mutations caught: drills counted for `card` (2 red),
for `reviewed` (4), ending set-aside (1), threshold 0 (4), drilled-in not sticky (1), a word
retired by hand drilled in (1). Encounter validation: 12 cases red first; widening the line check
caught by its case.

## Storage

`npx vitest run tests/storage/hardcore.test.ts tests/storage/rewatch.test.ts tests/storage/cards.test.ts`:
- a drilled line watched in a later session gives that exposure `rewatchDays` (FR-016); watched
  without a drill, none;
- `cardsToday`'s first reviews today ignore hardcore reviews (FR-015);
- withdrawing the document takes the drill grades back; a backup restores plan, steps and grades.

## Parts and words (derived, properties)

`npx vitest run tests/domain/hardcore.test.ts`: parts tile the fragment; each word in its first
part only; sizes within N/2–1.5 N unless one line holds more; filters monotone; the drill queue
ends only when every word passed and an Again returns 3 cards later. Mutate the cut rule once.

## Browser

`npm run verify:browser -- hardcore` (new): from the document page, start with defaults → preview
lines shown → watch first plays and stops at the part's end → Back → drill the words (one Again)
→ watch after → session ends; the records match the contract. Also `cards`, `cardaudio`,
`cardlayout` (card extraction), `documentpage`, `resume`, `leavingvideo`.

## Phone (one round, Principle I)

Deploy, then on the installed app with a real film: a cut-by-load session from Continue, 20-word
parts, all steps; time planning and SC-4/SC-5; check Cards shows none of the drilled new words due;
the "Before you go" sheet after each watch step.

## Recorded 2026-10-13 (laptop)

- 629 tests pass; type check and lint clean. Domain: drill queue, next step, word classes, word
  choice, filters and cut by load red first; mutations caught: Again offset, keeping excluded
  words, last line for first, least frequent first, a started step counted done, no cut-before,
  merging regardless, never merging, coverage overshooting its target, coverage keeping known
  words, rank and occurrence limits off by one (three of these only after exact boundary cases
  were added). Storage: budget (2 red first), drilled lines as sightings (red first; dropping
  them and counting any review's range both caught), session read-back, frequency ranks, passed
  today; withdrawal, backup round trip and study days needed no change. Recorder link red first.
- Browser (verification build, fixture service on 18765): `hardcore` passes — both watch steps
  stopped at 6.35–6.36 s for a part ending at 6.4 s; 14 words, 15 grades recorded with
  `hardcore` and `line`; 8 step records; both player sessions linked; a second session the same
  day had nothing left to drill. `media`, `autostop`, `leavingvideo`, `documentpage`, `stage`,
  `study`, `cardaudio`, `cardlayout` pass. `cards` fails waiting for a card answered Again to come
  back, identically with the Cards page from before this change (the scenario predates the
  no-steps schedule, under which that card is due hours later). `resume` continues at 11 s where
  it expects 9 s: this fixture's clip has a line starting at 11.0 s, so 11 is the right answer
  for it (the scenario's 9 belongs to another clip).
- Planning a synthetic 650-line, 7,800-word film (word choice with a coverage target, then cut
  by load): 3.3 ms median, 8.6 ms worst of 20 on the laptop. The page's storage reads (states,
  memory, ranks for ~2,500 words) are not in that figure; measure on the phone.
