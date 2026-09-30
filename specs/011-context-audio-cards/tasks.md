# Tasks: Context and audio cards
- [x] T001 Specify, clarify, research and plan in specs/011-context-audio-cards/; ADR-0035 recorded.
- [x] T002 [US1] Write failing encountered-selection/queue/review-source tests in tests/storage/cards.test.ts.
- [x] T003 [US1] Implement source-backed selection/queue and example identity in src/lib/storage/{repository,client,worker,protocol}.ts.
- [x] T004 [US2] Write import-validation/idempotence/backup tests in tests/storage/card-examples.test.ts and tests/anki/test_export_examples.py.
- [x] T005 [US2] Implement read-only exporter scripts/anki/export_examples.py, domain examples.ts, archive import/storage and More UI.
- [x] T006 [US3] Add bounded audio controller and tests in src/lib/media/card-audio.ts and tests/media/card-audio.test.ts.
- [x] T007 [US3] Wire source labels, cue audio and word pronunciation into src/routes/cards/+page.svelte.
- [ ] T008 Verify isolated browser/phone import and audio; update docs/current-state.md and quickstart.md.
- [ ] T009 Deploy and import actual Anki examples/audio on phone, preserving existing schedules.

Dependencies: T001→T002→T003; T004→T005; T006→T007 after source/import contracts. T008→T009.
Independent checks: US1 excludes unread/withdrawn ranges; US2 imports/reimports/restores examples;
US3 stops at clip end/visibility loss. T004 and T006 can be prepared independently, no parallel
implementation needed. MVP is encountered examples; deliver all three stories together for phone use.

T008 browser checks passed; physical-phone check awaits unlock. T009 deployment succeeded (`6958c4a`); bundle is in phone Downloads, daily-app import still pending.
