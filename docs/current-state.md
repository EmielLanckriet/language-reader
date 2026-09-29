# Current state

Updated 2026-09-29. Start here for project status; consult the relevant spec and ADR for detail.
This describes repository behavior and recorded results, not a fresh certification of every feature.

## Product and architecture

Reader is a personal Chinese reading and listening app for an Android phone. TypeScript/SvelteKit
builds to a static, offline-capable PWA on GitHub Pages. SQLite in a worker stores learning history
in browser OPFS; media and downloaded models also live on the device. There is no hosted backend.
Termux's local reader service downloads media, retains backup copies, and runs the better English
translation pass. It is a real operational dependency even though hosting is static.

- Dictionary segmentation is immediately usable; the contextual model improves it in the
  background. Pinyin and CC-CEDICT meanings are displayed. Manual join/split corrections persist.
- Texts and offline videos feed a shared encounter history. In-app FSRS reviews maintain reading
  and listening memory. Anki is a read-only seed; Reader does not modify the Anki collection.
- SenseVoice transcribes videos inside Reader, saving each window for resume. Termux no longer
  transcribes. Quick English and the better translation pass share limited phone resources.
- Automatic copies to Termux and restore protect earned history. Deleting a document with history
  hides it while retaining its source text. Sessions can be withdrawn without deleting encounters.
- Recent changes include manual sentence joins, playback progress, session withdrawal, and the
  nested-transaction fix when forgetting a deleted document's sessions.

## Latest maintenance changes

- Spec Kit now has both Claude and Codex integrations installed, with Codex as the default.
  Codex skills live in `.agents/skills`; the existing specs and templates are retained.
- Shared Claude/Codex working rules and the proportionate workflow are recorded in ADR-0031.
- `npm run verify:isolated -- --phone` provides a separate test origin and disposable service;
  synthetic activity must use that setup, not the daily reader.
- A failed transcription checkpoint write now reaches the bounded retry handler instead of
  hanging. Focused regressions cover transient and repeated failures. Real-audio equivalence
  remains a separate open question below.

## Validation of the maintenance changes

Local checks on 2026-09-29: 59 test files / 422 tests passed; type checking and lint passed;
verification and production builds passed. The final recovery adjustment also passed its eight
focused recovery/isolation checks. The isolated browser saved a synthetic text and the disposable
service received its backup; its downloads directory was not linked to personal downloads.
Built bundles were checked for the correct service address in each mode.

The isolated setup was checked on the connected Android phone on 2026-09-29: the test banner
appeared, the built-in 52-character sample saved, and the disposable service received a backup
containing that document. USB reverse mappings worked. Deployment/update verification is pending.
The smoke check does not prove the checkpoint failure path on physical storage; that path is
covered by injected-failure regressions.

## Recorded validation and open limits

- Spec 008 records a phone check on 2026-09-29: about 22.4 s per 28 s transcription window in the
  measured setup. Concurrent playback/translation can slow it; see ADR-0029.
- Resumed real-audio transcription differed by two characters in a recorded comparison. The fake
  worker regression proves orchestration, not bit-exact audio decoding. Root cause remains open.
- Long-video Chrome memory growth was not measured in the recorded phone check.
- Segmentation corrections are built; the backlog still lists the real-phone join-and-sweep check
  as pending. The old Claude memory saying spec 004 is on hold is superseded.
- The original browser storage wipe's cause is still unconfirmed. Backup resilience does not
  establish that cause or guarantee every copy is current.
- Sense selection, heteronym readings, listening cards, and learning evidence weights remain
  areas for improvement. See [backlog](backlog.md); weights are hypotheses, not validated learning
  outcomes.

## How to work

Read [working rules](working-rules.md), then the affected feature's documents. The constitution
defines product constraints; this page owns current status. Historical specs and Claude memories
are context, not evidence that a feature is still absent or that a check passed today.

Use Spec Kit for substantial features and earned-data changes. Use a short plan and focused checks
for small reversible work (ADR-0031). Keep decision records when a lasting tradeoff changes.

Run automated phone interactions in the isolated verification setup described in
[browser verification](../scripts/verify-in-browser/README.md). Do not create synthetic learning
events in the daily reader. Keep runs short, batch device checks, and report unverified device
behavior explicitly. Update this page when capabilities or their validation status change.
