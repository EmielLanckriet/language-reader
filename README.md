# Language Reader

A reading tool for Chinese: paste text, read it segmented into words, and mark what you know.
Inspired by LingQ and Language Reactor, built to run on a phone.

**There is no server.** Everything you save lives in your own browser, in the origin-private file
system, in a SQLite database. Nothing is sent anywhere, there is nothing to log in to, and there is
no subscription that can lapse (see [ADR-0007](docs/adr/0007-no-server-browser-first.md)).

This is **slice 0**: the thinnest end-to-end path through every layer. It splits text one character
per token, which is not real segmentation and is not meant to be — the placeholder exists to prove
the seam it sits behind. See
[the specification](specs/001-reader-walking-skeleton/spec.md) for what is deliberately missing.

## Getting started

Requires **Node 24** (the current LTS).

```sh
nvm use            # honours .nvmrc
npm install
npm run dev
```

> **If `node --version` says 18**, your shell is finding the system Node rather than nvm's.
> Non-interactive shells do not source `~/.nvm/nvm.sh`, so `/usr/bin/node` wins. Either run
> `nvm use` first, or put nvm's bin directory on `PATH` explicitly. This is the same shape of
> problem as the `DOTNET_ROOT` note in [ADR-0005](docs/adr/0005-verified-kernels-in-dafny.md).

### Working against your phone

Constitution Principle I says a slice is not done until it has run on a real phone, and waiting for
a deploy to find that out is far too slow a loop. Serve to your local network instead:

```sh
npm run dev -- --host 0.0.0.0
```

Then open `http://<your-laptop-ip>:5173` on the phone, on the same wifi. This costs seconds rather
than a deploy, and it is the normal way to work — but it is **not** "done". Only the deployed app
counts.

## Tests

```sh
npm test           # once
npm run test:unit  # watch
npm run check      # types
npm run lint       # formatting and lint
```

Testing here is deliberately narrow (Constitution Principle II). Tests are mandatory for word state
transitions, history replay, and segmentation invariants — the parts with real invariants. UI and
glue are exempt, because tests there would be ceremony.

| Suite | What it holds to account |
| --- | --- |
| `tests/domain/offsets.test.ts` | Positions are Unicode code points, not UTF-16 code units |
| `tests/domain/tiling.test.ts` | Tokens tile every document exactly — **invariants only** |
| `tests/domain/state.test.ts` | The state set is configuration; the projection is a fold |
| `tests/domain/history.test.ts` | Replaying the history reproduces current state |
| `tests/storage/migration.test.ts` | The hedge columns exist and cannot be silently empty |
| `tests/storage/provenance.test.ts` | A real write populates them |
| `tests/storage/counts.test.ts` | 100 marks make exactly 100 states and 100 entries |
| `tests/storage/document.test.ts` | Offsets survive a round trip through SQLite |
| `tests/architecture/domain-purity.test.ts` | The domain imports no framework and no storage |

Two of these are worth understanding before changing them.

**`tiling.test.ts` never asserts an expected segmentation.** Word-hood in Chinese is undefined and
analyzer-dependent — reasonable people disagree about 北京大学 — so an expected value encodes one
analyzer's opinion and breaks on every upgrade. What is asserted is what stays true of every
analyzer: the tokens partition the text.

**`migration.test.ts` checks columns nothing uses.** That is exactly why it exists. Those columns
are hedges against changes that would otherwise mean fabricating history that was never recorded,
and an invisible column is precisely what a later refactor removes as dead weight.

## Deploying

Pushing to `main` builds and publishes to GitHub Pages via
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). The workflow runs `check`, `lint`
and `test` first and will not publish if any fail.

First time only:

1. Create the repository on GitHub and push.
2. **Settings → Pages → Source → GitHub Actions.**
3. Push to `main`, or run the workflow manually from the Actions tab.

`BASE_PATH` is derived from the repository name, because a project site is served from
`https://<user>.github.io/<repo>/` and every asset URL needs that prefix.

## Layout

```
src/lib/domain/     Pure. Imports no framework, no storage, no DOM.
src/lib/analyzer/   SEAM: language providers
src/lib/content/    SEAM: content sources
src/lib/storage/    The only place that knows SQLite exists
src/lib/diagnostics/ On-device failure record
src/routes/         Library, reader, diagnostics
```

The important boundary is not client against server — there is no server — but
`src/lib/domain/` against everything else. That boundary is what let the entire backend disappear
in ADR-0007 without the data model moving, and it is
[enforced by a test](tests/architecture/domain-purity.test.ts) rather than by intention.

## Governance

- [Constitution](.specify/memory/constitution.md) — seven principles, and what they forbid
- [Anticipated changes](docs/anticipated-changes.md) — the register that authorises seams
- [ADRs](docs/adr/) — what was decided, what was rejected, and why

Documents under `docs/`, `specs/` and `.specify/` are excluded from Prettier deliberately: they are
hand-wrapped prose, and reformatting them produces large diffs that say nothing.
