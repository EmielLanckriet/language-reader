# ADR-0046: Trim the process to the irreversible surface

Status: Accepted. Date: 2026-10-31. Amends the constitution and ADR-0031.

The reader, 2026-10-31, after a session spent more on process than on the change: a background
sync to Taal got 17 tests, a property test, two rounds of mutation checks, a fake server and a
browser scenario; a questionnaire wording change led to building a test video from scratch.
`docs/current-state.md`, read at the start of every session, had grown to 1,176 lines.

Decided:

- **Current state is short.** About 100 lines: the app, what waits for a phone check, what is
  open. The record up to today moved to `docs/history/current-state-2026-10-31.md`.
- **The short path is the default.** Spec Kit's full flow, anticipated-changes entries and new
  ADRs are for changes to earned data's shape, the architecture, or decisions likely to be
  revisited.
- **Test-first and mutation checks only on the irreversible surface** (constitution Principle II,
  now naming migrations and other earned-data writers). Derived data, UI, glue and sending to
  outside services get at most one plumbing test.
- **Browser scenarios only when a change is about what they test**; never fixtures for wording.
- **Stale constitution text removed**: Dafny (no Dafny code exists), whisper, the old status names,
  the API layer, the duplicated earned/derived definition, versioning and compliance gates.

Kept unchanged: no server, Anki is read-only, earned data rules, fast first, readable code, and the
phone as the final check, batched.

Alternatives: leaving the rules and relying on judgment (the heavier path kept winning by default);
dropping test-first entirely (earned data is irreplaceable, and its tests have caught real bugs).
