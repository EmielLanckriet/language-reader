# ADR-0008: SQLite-WASM In OPFS For On-Device Storage

**Status**: Accepted
**Date**: 2026-09-01
**Relates to**: ADR-0002, ADR-0003, ADR-0007; Constitution Additional Constraints (Storage);
slice 0 plan

## Context

ADR-0007 put all reader data on the device and removed the server. It did not say *how* data is
stored, and the browser offers materially different options.

The data is relational. Lexemes have states; states have an append-only history; documents have
tokens that reference lexemes. FR-011 requires that replaying the history reproduce current state —
a fold over an ordered log, joined against the lexemes it refers to. An export file is required
soon, both as the only backup with no server and as the only route to a second device.

The storage engine sits below everything: the repository, the domain's persistence adapter, and
every query are written against whichever is chosen. And once earned data exists — from slice 1,
where slice 0's disposability expires — changing it is a migration of exactly the category ADR-0003
says to settle in advance.

## Decision

**SQLite compiled to WebAssembly (`@sqlite.org/sqlite-wasm`), persisted in the origin-private file
system (OPFS).** The schema is applied by **numbered plain-SQL migration files**, hand-written and
read directly, not generated.

`src/lib/storage/` is the only module permitted to know SQLite exists. The domain core imports
nothing from it (Principle V.4, enforced by test).

## Alternatives Rejected

**IndexedDB, directly or through a thin wrapper.** The strongest alternative and the closest call
in the slice-0 plan. It is simpler, ships no WebAssembly, and avoids OPFS entirely. Rejected on
three counts: joins and the replay fold become hand-written procedural code where SQL states them
declaratively; the export becomes a bespoke serialisation format that must then be versioned and
maintained; and moving to SQLite later would migrate earned data. Its simplicity is a real cost we
are choosing to pay.

**`localStorage`.** Synchronous, capacity-limited, string-only. Not a candidate.

**Deferring the decision because slice 0's data is disposable.** Rejected, and the reasoning is
worth keeping: disposability lowers the cost of a *schema shape* mistake, because the rows can be
wiped. It does nothing about the *engine*, because every layer above is written against it.
Deferring the decision would not defer the work of depending on one.

**An ORM or query builder over either.** Rejected under Principle VII and Principle V. The three
hedge columns — provenance, owner, device identity — must be visibly correct in a file that can be
read in ten seconds, not inferred from decorators. Generated migrations are the opposite of that.

## Consequences

**Easier.** The replay fold, the joins, and the eventual statistics are SQL rather than procedural
code. Export is a file copy. Migrations are readable artifacts that show the hedge columns
existing. And the model is conceptually familiar: an Anki collection is a SQLite database, and
`sentencegen` already manipulates one.

**Harder — and this is the real cost.** A WebAssembly dependency and OPFS wiring are the most
complex thing in a slice whose stated purpose is to be minimal. OPFS is best driven from a worker,
which adds asynchrony the rest of the application must accommodate. When it misbehaves, the failure
modes are unfamiliar and poorly signposted, and this project's developer is learning. This is a
genuine tension with the walking-skeleton principle, and it is accepted because the alternative
defers a decision that gets more expensive rather than less.

**Revisit if.** OPFS proves unreliable or awkward enough on Android Chrome that the slice stalls on
it. Slice 0's data is disposable, so falling back to IndexedDB at that point costs the storage
adapter and nothing above it — which is itself a reason the domain boundary is enforced by test
rather than trusted.
