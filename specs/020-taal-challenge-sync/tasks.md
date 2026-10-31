# Tasks: Study time sent to the Taal challenge

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/taal-log.md](contracts/taal-log.md)

**Tests**: the shares, the difference and the zero clamp decide what an outside system holds
(SC-002), so they are written test-first, run red, and each rule mutated once; the migration and
copy format are the irreversible surface. The sync gets one plumbing test; UI exempt.

**Blocked on the friend** (authorized domain): only T024, the phone round. Everything else runs
against fakes and the verification stub.

## Phase 1: Setup

- [X] T001 Add `firebase` at exactly `12.19.0` to `dependencies` in `package.json` (`npm install firebase@12.19.0 --save-exact`); nothing imports it yet.
- [X] T002 [P] Write `docs/adr/0045-study-time-to-taal.md`: Taal as the first outside service receiving reader data (optional tier like the LLM key; ADR-0007 holds), `firebase/auth` only with its named justification and the measured sizes (research R2), the REST read-then-commit (R3), the sent record as earned data in the copy (R5), alternatives and the phone risk.

## Phase 2: Foundational (blocks every story)

- [X] T003 Export `studyDayOf(timeZone, dayEndHour)` (a labeller `(date) => day`, cached per quarter hour) and `shiftDay` from `src/lib/domain/study.ts`, taken out of `studyDays` with no change of behaviour; add cases to `tests/domain/study.test.ts` (1:59 at end hour 2 → the day before, 2:00 → that day; a DST date).
- [X] T004 Write `tests/domain/taal.test.ts` for `dailyShares` (red): input is study-time events `{at, durationMs, sessionId|null}`, each session's latest look-up answer, Cards reviews `{at}`, drill parts `{start, end|null, lastGrade|null}`, time zone and end hour; cases: 12 min unanswered → 12 Input; answered `all` → Study; `some`/`none` → Input; a session-less study-time → Input; 25 Cards reviews → 25 cards; a drill part 14 min → 14 Study; no end → to the last grade; neither → 0; a drill crossing the day end split between the two days; minutes rounded once per day and mode (three 40 s sessions → 2, not 0 or 3).
- [X] T005 Implement `dailyShares` in `src/lib/domain/taal.ts` (no storage or framework import). T004 green; mutate the `all` check and the day split once each.
- [X] T006 Add to `tests/domain/taal.test.ts` (red): `changes(shares, sent, since, today)` gives `share − sent` per day and mode, only for days ≥ `since` and within 70 days of `today`, none for a zero difference; a sent row with no share now gives its negative; `apply(current, changes)` gives `max(0, current + change)`. Property (fast-check, `size: 'max'`, explicit `maxLength`): over random sequences of share changes, hand edits ≥ 0 and sends, after each send Taal's value = hand entries + share, and a send with nothing new changes nothing.
- [X] T007 Implement `changes` and `apply` in `src/lib/domain/taal.ts`. T006 green; mutate the clamp and the `since` bound once each.
- [X] T008 Add `src/lib/storage/migrations/007-taal-sent.sql` (`taal_sent` per data-model.md), register it in `src/lib/storage/db.ts`, extend `tests/storage/migration.test.ts` to version 7.
- [X] T009 Write `tests/storage/taal.test.ts` (red): `taalInputs(since)` on a seeded library returns the study-time of sessions not withdrawn with each session's latest `attention` answer, Cards reviews (no `hardcore` detail) and drill parts from `hardcore-step` marks and hardcore reviews, nothing before `since`; `recordTaalSent(rows)` upserts in one transaction and `taalSent()` returns them.
- [X] T010 Implement `taalInputs`, `taalSent`, `recordTaalSent` in `src/lib/storage/repository.ts` and expose them in `src/lib/storage/protocol.ts`, `worker.ts`, `client.ts`. T009 green.

## Phase 3: User Story 1 — minutes reach Taal without being entered (P1) 🎯 MVP

**Independent test**: in the verification build, connect, read a minute, answer "Yes, every unknown word": the stub's log shows 1 Study for today.

- [X] T011 [US1] Create `src/lib/taal/firebase.ts`: Taal's public web config (apiKey, authDomain, projectId, appId as in Taal's published bundle), `connect()` (`signInWithPopup` with `GoogleAuthProvider`, returns `uid`), `disconnect()`, `token()`; `firebase/app` and `firebase/auth` imported dynamically so they form their own chunk; in `VERIFICATION` (`src/lib/media/service-address.ts`) a fixed fake account and token instead, never loading Firebase.
- [X] T012 [US1] Write `tests/ui/taal-sync.test.ts` (red), with a fake log in memory behind an injected `fetch`: a send commits only changed fields under the read's `updateTime`; a precondition failure is read and retried, and gives up after three; a refused commit or a `format` problem leaves `taal_sent` unchanged and sets the status reason; a successful one records the shares sent.
- [X] T013 [US1] Create `src/lib/taal/log.ts`: `readLog(uid, token, fetch)` and `commitLog(uid, token, values, updateTime|null, fetch)` per contracts/taal-log.md (field paths with backticked day keys, update mask, `updatedAt` as request time, `exists: false` for a new log, integer or double read, `format` errors); base URL `https://firestore.googleapis.com/v1/projects/language-81ef3/databases/(default)/documents`, or `${location.origin}/__taal/v1/…` in `VERIFICATION`.
- [X] T014 [US1] Create `src/lib/taal/sync.ts`: `requestSend()` debounced 20 s, one send at a time, doing nothing unless `reader.taal.on`; inputs from `taalInputs(since)`, `dailyShares` with `reader.dayEndHour`, `changes`, `readLog`, `apply`, `commitLog`, `recordTaalSent`, status in `reader.taalStatus`; offline → reason `offline` without a request. T012 green.
- [X] T015 [US1] `startSending()` in `src/lib/taal/sync.ts`, called from `src/routes/+layout.svelte` beside `startCopying()`: a send on opening, on `online`, and after every `EARNED_CHANGE` (study time, answers, Cards grades and drill steps all go through `recordEncounters`/`recordReview`, which fire it), debounced so a session still going puts it off; never awaited. One listener instead of a call in each page.

## Phase 4: User Story 2 — hand entries never lost or counted twice (P1)

**Independent test**: T006's property, and a format-5 copy restored sends nothing until turned on.

- [X] T016 [US2] Write tests in `tests/storage/taal.test.ts` and `tests/backup/` (red): a copy is format 5 with `taalSent`; restoring it replaces `taal_sent` exactly; a format-4 copy restores with none; a negative, fractional or unknown-mode row is refused.
- [X] T017 [US2] Format 5 in `src/lib/backup/format.ts` (`taalSent`, upgrade 4 → 5 adds `[]`, validation) and `exportBody`/`restoreCopy` in `src/lib/storage/repository.ts`. T016 green.
- [X] T018 [US2] `turnOffAfterRestore()` in `src/lib/taal/sync.ts`, called in `src/lib/backup/destination.ts` `restore` after the copy is accepted: both restores (Termux on the library and on More) go through it.

## Phase 5: User Story 3 — the reader sees that it works (P2)

- [X] T019 [US3] In `src/lib/ui/StudyOverview.svelte` (Progress only, when connected): "Sent to Taal at 14:02 · today 12 Input, 5 Study, 25 cards" or the reason with Retry (calls `requestSend` at once) or Sign in again; nothing when never connected.

## Phase 6: User Story 4 — connect and disconnect (P2)

- [X] T020 [US4] A "Taal challenge" group in `src/routes/diagnostics/+page.svelte` (More): Connect (sign-in, then `reader.taal = {uid, since: today's study day, on: true}` and a send), the account, Disconnect (`on: false`, sign-out, nothing taken back), and after a restore "Turn on sending here" (a connect, new `since`); one line on what is sent and that days before connecting are not.

## Phase 7: Polish & verification

- [X] T021 Stub `GET` and `:commit` of the log under `/__taal/` in `scripts/verify-in-browser/serve.mjs` (one in-memory document with `updateTime`, a seedable hand value, a switch to refuse); scenario `taal` in `scripts/verify-in-browser/run.mjs` per quickstart.md; a row in `scripts/verify-in-browser/README.md`.
- [X] T022 Run `npm test`, type check, lint, `npm run build` and `check-bundle.mjs` (record the Firebase chunk's size; re-baseline only if it is the cause, with the reason); verification build and scenarios `taal`, `study`, `leaving`, `hardcore`.
- [ ] T023 [P] `docs/anticipated-changes.md` (spec 020 rows from the spec), `docs/current-state.md` (built, browser-checked, phone round blocked on the authorized domain).
- [ ] T024 Phone round, **after the friend adds `emiellanckriet.github.io`**: deploy, connect on the installed app (the reader signs in; the popup is the first check, research R2), Taal's numbers for today before and after a session, Cards and a drill part, a hand entry kept; record in `docs/current-state.md`.

## Dependencies

T001 → T011. T003 → T004–T005. T005, T007 → T014. T008 → T009 → T010 → T014, T017. T013 → T014 → T015, T018, T019, T020. T017 → T018. T021 needs T014 and T020. T022 after all code; T024 last.

## Parallel

T002 with anything. T004/T006 (domain) with T008/T009 (storage). T019 and T020 together once T014 is done.

## Implementation strategy

Phase 1–3 is the MVP: minutes reach the stub with no hand entries in the way. Phases 4–6 make it
safe and visible; all of it ships in one deploy, then the phone round once the domain is allowed.
