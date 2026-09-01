# Phase 0 Research: Reader Walking Skeleton (Slice 0)

Decisions taken before design, each resolving something the Technical Context could not state
outright. Format: decision, rationale, alternatives considered.

---

## 1. Storage engine

**Decision**: SQLite compiled to WebAssembly (`@sqlite.org/sqlite-wasm`), persisted in the
origin-private file system (OPFS), with the schema applied by numbered plain-SQL migrations.
Recorded separately as **ADR-0008**.

**Rationale**: The data model is relational — lexemes, documents, tokens, states, and an
append-only history — and FR-011 requires that replaying the history reproduce current state, which
is a fold SQL expresses directly. An export file is required soon (ADR-0007) and with SQLite it is
a file copy rather than a bespoke serialisation. Storage engine is not cheap to change once earned
data exists, and slice 1's data is real, so ADR-0003 says decide it now. SQLite is also
conceptually familiar territory: Anki's collection is a SQLite database, and `sentencegen` already
manipulates one.

**Alternatives considered**:

- *IndexedDB, directly or via a thin wrapper.* Simpler API, no WebAssembly, no OPFS. Rejected
  because joins and the replay fold become hand-written code, export becomes a custom format, and
  switching to SQLite later would migrate earned data — precisely the category ADR-0003 says to
  settle in advance. Its simplicity is real and this is the closest call in the plan.
- *`localStorage`.* Rejected outright: synchronous, small, string-only.
- *Deferring the choice, since slice 0's data is disposable.* Rejected. Everything above the
  storage layer is written against whichever engine is chosen, so deferring the decision does not
  defer the work of depending on it.

## 2. Counting characters

**Decision**: All offsets are **Unicode code points**. A single module, `domain/offsets.ts`, owns
every conversion, and no other module measures or slices a string by position.

**Rationale**: JavaScript's `String.length` and index access count UTF-16 code units, so a rare
Chinese character outside the Basic Multilingual Plane counts as two. Mixing that with code-point
iteration corrupts every stored offset silently rather than throwing. Since offsets anchor reading
position, corrections and eventually statistics (ADR-0002), the corruption would reach earned data.
Confining the arithmetic to one module makes the rule enforceable rather than remembered.

It matters beyond this application: an export read by any tool that counts in code points — Python,
for instance — must agree about where a token starts.

**Alternatives considered**: *UTF-16 code units throughout*, which is what the language gives by
default and would be marginally faster. Rejected because it exports a JavaScript implementation
detail into a data format meant to outlive this application.

**Test obligation**: `tests/domain/offsets.test.ts` must include astral-plane characters — a
Extension-B hanzi, an emoji — and assert that a round trip through offsets reproduces the input.

## 3. Testing tools

**Decision**: `vitest` as runner, `fast-check` for property-based tests.

**Rationale**: Constitution Principle II mandates property-based tests where the state space makes
examples unconvincing, and names no tools since the core moved to TypeScript. `vitest` shares
Vite's configuration, so the test environment matches the build without a second toolchain.
`fast-check` is the established property-based library for TypeScript and includes a model-based
testing facility suited to the state machine.

**Alternatives considered**: *Jest*, which would need its own transform pipeline alongside Vite for
no gain. *Example-based tests only*, rejected by Principle II.

## 4. Build target and hosting

**Decision**: SvelteKit with `@sveltejs/adapter-static`, producing a fully static bundle, hosted on
GitHub Pages.

**Rationale**: ADR-0007 requires a host with no payment method and nothing that can lapse. GitHub
Pages requires no card and does not expire; the repository holds code only, and reader data never
leaves the device. `adapter-static` is the SvelteKit adapter that emits no server component, which
is the property being enforced rather than merely preferred.

**Alternatives considered**: *Cloudflare Pages*, comparable and arguably better tooling, but its
free tier still sits behind an account with billing attached. *Fly.io*, rejected in ADR-0007.

**Note**: The application must work from a subpath (`/<repo>/`) on GitHub Pages. Configure
`paths.base` and use SvelteKit's `base` helper for internal links, or a wrongly-rooted asset path
will produce a blank page that looks like a build failure.

## 5. Persistent storage

**Decision**: Request persistence via `navigator.storage.persist()` at first write, and record the
outcome in diagnostics. Do **not** block on it in slice 0.

**Rationale**: Browser storage is evictable by default. Chrome on Android generally grants
persistence to installed applications, which is why installation and this request belong together —
both arrive properly in slice 1. Slice 0's data is disposable by decision, so a refusal is not yet
harmful; recording the outcome now means slice 1 begins with evidence about what this browser
actually does rather than an assumption.

**Alternatives considered**: *Deferring the call entirely to slice 1.* Rejected because it costs
one line and the observation is useful early. *Blocking startup on it.* Rejected as
disproportionate for disposable data.

## 6. Enforcing the domain boundary

**Decision**: An automated test asserts that no file under `src/lib/domain/` imports from Svelte,
SvelteKit, or `src/lib/storage/`.

**Rationale**: Principle V.4 is the rule that let ADR-0007 remove the entire backend without moving
the data model. It is also the easiest rule to breach accidentally, because a single convenient
import compiles fine and is invisible in review. A test makes it a property of the codebase rather
than a habit of its author.

**Alternatives considered**: *A lint rule* such as `import/no-restricted-paths`, equivalent in
effect and arguably better placed; usable instead if configuring it proves simpler than the test.
*Convention and review*, rejected — this project has one reviewer, who is learning.

## 7. Ordering the history

**Decision**: Each history entry carries the device's wall-clock time, a device identifier
generated once and stored, and a per-device counter that increases with every entry. Ordering
within a device is by counter.

**Rationale**: FR-010c. With no server there is no authoritative clock, and a device clock drifts,
gets adjusted, and crosses time zones. A per-device counter is exact and immune to all three.
Device identity and the counter must exist from the first version because merging two histories
later requires knowing which device produced each entry and in what order, and neither can be
reconstructed after the fact.

**Alternatives considered**: *Wall-clock time alone*, rejected — two devices' clocks disagree and
nothing records by how much. *A UUID per entry with no ordering*, rejected: it identifies entries
without ordering them, which is the part that matters.

---

## Deliberately not researched

Choices that would be premature here, listed so their absence is visible rather than accidental:

- **Which real segmenter to use.** Slice 0's analyzer is a placeholder by design. The comparison
  between `Intl.Segmenter`, a frequency-scored path, and a small ONNX sequence tagger is slice 1's
  first investigation, and it is a measurement rather than an argument.
- **Offline caching strategy.** Slice 1, together with installation.
- **Export file format.** Slice 1 or soon after; SQLite makes the cheap option a file copy, but the
  format is a decision with its own consequences.
- **Anything about Anki.** Slice 4, and independent of `sentencegen` per ADR-0006.
