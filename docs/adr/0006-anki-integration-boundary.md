# ADR-0006: Anki Integration Boundary

**Status**: Accepted
**Date**: 2026-09-01
**Relates to**: Constitution Principle III, Additional Constraints; ADR-0002

## Context

The developer already owns and runs `sentencegen`, a separate project in
`SideProjects/Anki`. It selects due notes from an HSK deck, generates a Chinese example
sentence with a local Qwen3-4B, derives pinyin and translation, synthesises audio with Kokoro
v1.1-zh, prunes stranded media, and syncs the result to AnkiWeb so AnkiDroid collects it. It runs
nightly under a systemd timer.

That project has already established, by building it, several facts this project had been
treating as open questions:

- **AnkiDroid cannot be written to directly.** It has no Python add-ons, and its JavaScript API
  is read/control only — it cannot write a note field or add a media file. Work must happen on a
  machine that can hold the collection, and reach the phone by sync.
- **A local collection copy is stale until it is pulled.** Their README records a case where a
  hand count said 69 cards were due, 70 had already been reviewed on the phone, and the true
  number was 9. Any read that has not synced down first is untrustworthy.
- **Anki desktop holds a lock**; a writer must refuse to run rather than contend for it.
- **Media must be pruned and its upload awaited**, or stranded clips sync to the phone forever.
- **Sync credentials can be read from Anki desktop's own profile**, so a second store of them is
  unnecessary.

The question this raises is whether the reader should hand vocabulary to `sentencegen` and let
the existing pipeline enrich and deliver it, or remain independent.

An additional data point: the developer previously built an equivalent desktop-only tool and did
not use it, because they do not use Anki on the desktop. That is Principle I with evidence
attached rather than argument.

## Decision

**The reader stays independent of `sentencegen`.** It does not call it, is not called by it, and
shares no code or database with it. The two projects may be brought closer later; that is a
decision to make deliberately, once both are known quantities, and not a coupling to inherit at
the start.

**Anki integration in this project remains as the constitution states it**: `.apkg` export via
genanki for v1, with a sync client on the official `anki` library as the successor, reachable
from the export seam. `sentencegen`'s existence does not change that; it only proves the
successor path is achievable.

**The facts above are treated as established** and are not to be re-derived. Any sync client
this project later builds MUST sync down before reading, back up before its first write, refuse
to run while Anki desktop holds the lock, prune media it strands, and wait for media upload
before exiting.

**Principle III is unchanged and now has a second reason.** The collection is irreplaceable, and
it is additionally the working surface of another live tool. This project writes nothing to it
that is not additive and reversible.

## Alternatives Rejected

**Hand vocabulary to `sentencegen` and let it enrich and deliver.** Rejected by the developer's
explicit instruction, and the reasoning is sound: the point of studying other projects is to
avoid reinventing solved problems, not to acquire dependencies. Coupling two projects that are
both still finding their shape makes each harder to change, which is the thing Principle V exists
to protect. Revisitable once both are stable.

**Copy `deck.py` into this project.** Rejected for now as a consequence of independence. Its
*lessons* are recorded above and are free to reuse; lifting the module would create a shared
component with no owner and two divergent copies.

**Drop `.apkg` and go straight to a sync client, since one demonstrably works.** Rejected as
premature. Anki export is slice 4 at the earliest, `.apkg` is materially simpler, and the
constitution's staging already accounts for the successor. Deciding now optimises a slice that
does not exist.

## Consequences

**Easier.** Both projects stay independently changeable. The reader's Anki surface remains small
and one-directional, which is what keeps Principle III cheap to honour. Every operational hazard
of writing to a live Anki collection is now documented before the first line of code touches one.

**Harder.** Some work will be duplicated if the reader later grows its own sync client —
knowingly, and at a time when the duplication is visible rather than assumed away. Two tools will
write to one collection, so the additive-and-reversible rule carries more weight than it would
for a single writer.

**Revisit if.** Both projects stabilise and the duplication becomes concrete rather than
hypothetical, or the reader's vocabulary output turns out to be exactly what `sentencegen`'s
input wants. Either is a reason to reconsider, and neither is visible yet.
