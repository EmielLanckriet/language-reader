# Implementation Plan: Study time sent to the Taal challenge

**Branch**: main, existing checkout | **Date**: 2026-10-26 | **Spec**: [spec.md](spec.md)

## Summary

A pure function turns the history into a daily share per mode (Input and Study minutes, Cards
reviews) by the reader's mapping; another compares it with what was already sent (`taal_sent`, a
new table that travels in the copy) and gives the change for each day and mode. A send signs in
with Firebase's auth module (the only part of Firebase in the app), reads the reader's Taal log
over the database's REST interface, adds the changes, clamped at zero, and commits only those
fields under the read's precondition. Sends run in the background on open, on reconnecting to the
network and after study; Progress shows the last one. See [research](research.md),
[data model](data-model.md), [contract](contracts/taal-log.md).

## Technical Context

TypeScript 6, Svelte 5 / SvelteKit 2, SQLite in a worker (OPFS), Vitest 4 + fast-check 4. New
dependency `firebase` 12.19.0, `firebase/app` and `firebase/auth` only, in a chunk loaded when
connecting or sending (139 KB minified measured with 13.1.0). One migration (`007-taal-sent.sql`).
Copy format 4 → 5. No new background recompute; the shares query reads at most 70 days.

Outside dependency: the friend adds `emiellanckriet.github.io` to Taal's authorized domains, and
Taal's database rules must allow the reader to update their own log as Taal's page does —
unchecked until the first send from the phone.

## Constitution Check

- I: one deploy and one phone round; the phone round needs the friend's setting first. The popup
  sign-in from the installed app is the first thing tried on the phone (research R2).
- II: the mandatory list does not name this; the shares, the difference and the zero clamp are
  written test-first anyway (they decide what an outside system holds, SC-002), with a property
  over send/edit/answer/withdraw sequences and mutation checks. The sync gets one plumbing test;
  UI exempt.
- III: Anki untouched.
- IV: storage, domain, sync, More and Progress, deployable as one.
- V: no new seam; Taal is one module (`src/lib/taal/`), not an interface. `firebase` justified in
  research R2. The domain functions import neither storage nor framework. Anticipated changes are
  in the spec.
- VI: ADR-0045 — the first outside service receiving reader data (an optional tier like the LLM
  key, so ADR-0007's no-server rule holds), the dependency, and the sent record as earned.
- VII: one mapping function, one difference function, one send path.
- VIII: nothing waits on a send; reading, Cards and drills work the same offline or signed out.
- Constraints: hosting and the repository are unchanged; only per-day numbers leave the device
  (FR-013).

The migration and the copy format are the irreversible surface (working rules): test-first, one
transaction per send's record.

Post-design re-check: passes. Open gates: the friend's setting; the phone round.

## Project Structure

- `src/lib/domain/study.ts`: `studyDayOf` exported from `studyDays`, unchanged behaviour.
- `src/lib/domain/taal.ts` (new): `dailyShares(input)`, `changes(shares, sent, since, today)`,
  `apply(current, changes)` (clamped values for the commit).
- `src/lib/storage/migrations/007-taal-sent.sql` (new); `db.ts` registers it.
- `src/lib/storage/repository.ts` (+ `client.ts`, `protocol.ts`, `worker.ts`): `taalInputs(since)`
  (the encounters, sessions and answers R4 names), `taalSent()`, `recordTaalSent(rows)`; export and
  restore of `taalSent`.
- `src/lib/backup/format.ts`: format 5, `taalSent`, validation.
- `src/lib/taal/firebase.ts` (new): Taal's public config, the lazy auth chunk: `connect`,
  `disconnect`, `token`.
- `src/lib/taal/log.ts` (new): the REST read and the commit with mask and precondition, the
  contract's `format` checks.
- `src/lib/taal/sync.ts` (new): `requestSend()` — debounce, one at a time, shares → changes →
  read → apply → commit → record → status; retry on precondition failure; connection and status in
  `localStorage`.
- Triggers: `src/routes/+layout.svelte` (open, `online`), `routes/read/[id]/+page.svelte` (session
  end, answers), `lib/ui/SessionList.svelte` (answers), `routes/cards/+page.svelte` (grade),
  `routes/hardcore/[session]/+page.svelte` (drill end).
- Restore turns sending off: `src/lib/backup/destination.ts` `restore` and the file restore.
- UI: Taal under More (connect, disconnect, account, turn on after a restore);
  `lib/ui/StudyOverview.svelte` on Progress: the status line with retry or sign in.
- Verification mode: a fake account and the stub base URL; `scripts/verify-in-browser/serve.mjs`
  stubs the GET and the commit; new scenario `taal` in `run.mjs` and the README.
- Tests: `tests/domain/taal.test.ts`, `tests/storage/taal.test.ts`, `tests/ui/taal-sync.test.ts`
  (new); `tests/domain/study.test.ts`, backup and migration tests updated.
- Docs: ADR-0045; `docs/anticipated-changes.md` (spec 020 rows); `docs/current-state.md` at the
  end; the install size re-measured in `check-bundle.mjs` if the chunk counts against it.

## Validation

See [quickstart](quickstart.md). Domain and storage tests fail before implementation; each rule
mutated once. Browser `taal`, plus `study`, `leaving`, `hardcore`. Phone: Taal's numbers for
today before and after, with a hand entry kept.
