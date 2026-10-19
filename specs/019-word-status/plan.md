# Implementation Plan: Word status

**Branch**: main, existing checkout | **Date**: 2026-10-19 | **Spec**: [spec.md](spec.md)

## Summary

Each word gets a stored status — retired, active or ignored — in its own log (`status_change`)
with a derived current table (`word_status`). Memory loses its card flags and is only memory. One
pure function decides when a retired word becomes active (stability reaches 14 days, or its first
Cards review as a budget pick) and one repository call site appends what it decides. Cards,
the library's due counts, hardcore and the word list read status; shares read recall only. A
one-time switch carries over every word active under the old rule and deletes the old hand,
`ignored` and `retired` marks. See [research](research.md),
[ADR-0044](../../docs/adr/0044-word-status.md).

## Technical Context

TypeScript 6, Svelte 5 / SvelteKit 2, SQLite in a worker (OPFS), ts-fsrs 5.4.2, Vitest 4 +
fast-check 4; no new dependency. One migration (`006-word-status.sql`, two new tables). Backup
format 3 → 4. One background recompute of every memory (rule `evidence-5`). The switch on the phone
is one query over current memory rows plus deletes (R4); a restore folds each word once.

## Constitution Check

- I: one deploy and one phone round, together with the "Just curious" chip.
- II (status transitions, status event replay, review scheduling): tests first — the domain
  activation rule with exact assertions and mutation checks, a property that `activation` never
  moves `active` or `ignored`, a replay test, the switch on a seeded library, characterization
  tests of today's rule before it changes; UI exempt.
- III: Anki untouched; the import writes Anki levels only and no status.
- IV: records, repository, domain and five screens, deployable as one.
- V: no new seam. The earned shape is settled in the [contract](contracts/status-records.md)
  before the first row. `status_change` and the `status-switch` encounter are earned;
  `word_status` and memory are derived. The domain module stays free of storage and framework.
- VI: ADR-0044, amending 0039, 0040, 0041.
- VII: one function decides activation; the old flags (`card`, `known`, `setAside`, `reviewed`)
  and their special cases go.
- VIII: the switch reads stored rows on the phone instead of refolding 2,800 words at open.

Deleting marks is the irreversible surface (working rules): one transaction, test-first, a backup
copy exists (the daily Termux copy) before the update.

Post-design re-check: passes. Open gate: phone round (Principle I).

## Project Structure

- `src/lib/storage/migrations/006-word-status.sql` (new); `db.ts` registers it.
- `src/lib/domain/status.ts` (new): statuses, causes, `activation`, `replayStatuses`, validation.
- `src/lib/domain/legacy-active.ts` (new): the old rule, frozen, for the switch only.
- `src/lib/domain/memory.ts`: card flags out of `Memory` and `WordEvidence`; marks read only for
  the seed; the reading fold's stability trajectory returned for `activation`; `RULE` `evidence-5`.
- `src/lib/domain/queue.ts`, `shares.ts`, `hardcore.ts`, `content/story.ts`: read status or recall.
- `src/lib/domain/encounter.ts`: `status-switch` kind.
- `src/lib/backup/format.ts`: format 4, `statuses`.
- `src/lib/storage/repository.ts` (+ `client.ts`, `protocol.ts`, `worker.ts`): `setStatus`,
  `getStatuses`, `rebuildStatuses`, `switchToStatuses`, activation after recompute, `cardsToday`,
  hardcore planning, word list, export/restore; `retireIgnored` and `setAsideAnki` removed.
- `src/routes/+layout.svelte`: no `retireIgnored`.
- UI: `routes/cards/+page.svelte` (Retire/Ignore + Undo), `routes/hardcore/[session]/+page.svelte`
  (same), `lib/ui/StateMenu.svelte` (Retire/Ignore toggles), `lib/ui/WordDetailSheet.svelte`
  (Retire/Ignore), `lib/ui/word-list.ts` (status column), `routes/read/[id]/+page.svelte` and the
  player's sheet wiring; `state.ts` keeps the names (they are history) but offers none of the
  removed ones; any More → Cards control for setting Anki words aside goes.
- Tests: `tests/domain/status.test.ts`, `tests/domain/legacy-active.test.ts`,
  `tests/storage/status.test.ts` (new); `tests/domain/memory.test.ts`, `queue`, `shares`,
  `hardcore`, `tests/storage/cards.test.ts`, backup and upgrade tests updated.
- Browser: `cards`, `study`, `hardcore`, `wordlist`, `sheet` scenarios updated.
- Docs: ADR-0044; ADR-0039/0040/0041 marked amended; `docs/anticipated-changes.md` (spec 019 rows);
  `docs/current-state.md` at the end.

## Validation

See [quickstart](quickstart.md). Earned-data tests fail before implementation; each rule mutated
once. On the 2026-10-16 backup: active after the switch = 2,111 + 丁. Phone: counts before and
after the update.
