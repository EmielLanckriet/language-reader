# Validation guide

Use Node 24 and existing npm dependencies. Synthetic interaction must use isolated data.

1. `npm test -- tests/domain/tuning.test.ts tests/domain/memory.test.ts tests/storage/tuning.test.ts`
2. `npm run check`
3. Run isolated browser verification per `scripts/verify-in-browser/README.md`.
4. Cards → Learning data: empty report explains missing data, export downloads valid JSON.
5. `node scripts/fsrs/evaluate.mjs /path/to/reader-fsrs-data.json`
6. Optionally supply a second file with `weights` (21 FSRS-6 values); compare on identical data.

No Reader/Anki parameters change. Assert implicit events alter state but never add outcome labels;
export never changes database contents. Report installed-phone validation separately.

## Recorded validation — 2026-09-30

- 51 tests passed across domain tuning/memory, storage tuning/memory/cards and domain purity.
- Seven mutations detected: answer leaked into own prediction; inferred ratings became labels;
  wrong success definition; tied timestamps split; undated seed accepted; invalid weights repaired;
  withdrawn reviews included. Each modified source restored before final test run.
- Type checking: zero errors/warnings. Scoped ESLint passed. Verification build passed.
- `npm run verify:browser -- tuning`: disposable origin/profile, empty Cards → Learning data →
  export passed (format 1, evidence-2, ts-fsrs@5.4.2, zero words). Browser check initially failed
  because the load callback did not run in the build; using a dependency-free rune effect fixed it.
- CLI synthetic 20 reviews: 19 eligible, 15 development / 4 later; baseline and candidate use
  identical outcomes. Invalid candidate checks are covered in the focused tests.
- Physical phone absent (only emulator attached). Not deployed or installed-phone validated.
