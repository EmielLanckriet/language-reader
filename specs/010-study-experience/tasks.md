# Tasks: Study experience

- [x] T001 Specify and clarify approved scope in spec.md; design/ADR-0034 complete.
- [x] T002 [US1] Test validation, recorder activity/close and summary replay in tests/domain/study.test.ts and tests/storage/study.test.ts.
- [x] T003 [US1] Implement earned encounter validation and recording in src/lib/domain/encounter.ts and src/lib/ui/recorder.ts.
- [x] T004 [US1] Add overview query/API in src/lib/storage/{repository,client,protocol,worker}.ts and src/lib/domain/study.ts.
- [x] T005 [US1] Replace modal with src/routes/progress/+page.svelte and reader Finish action.
- [x] T006 [US2] Redesign src/lib/ui/Library.svelte, app.css, TabBar.svelte and home/text screens.
- [x] T007 [US3] Add weekly participation and continuation in src/lib/ui/StudyOverview.svelte.
- [x] T008 Verify focused tests/mutations and isolated mobile browser; record in quickstart.md.
- [x] T009 Update docs/current-state.md and docs/anticipated-changes.md.
- [x] T010 Deploy and validate on installed physical phone.

Dependencies: T002 before T003/T004, then US1 UI; US2/US3 follow the overview API. No parallel
agent work required. Each story has independent acceptance checks in spec.md. Phone gate remains
open if no physical phone is available; report it explicitly.
