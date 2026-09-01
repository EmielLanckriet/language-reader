# Quickstart: Reader Walking Skeleton (Slice 0)

How to run, test, deploy and validate. Implementation belongs in `tasks.md`; this is the guide to
proving the slice works.

## Prerequisites

- **Node 24.20.0 LTS** — installed 2026-09-01 via `nvm`, set as the default and loaded from
  `~/.bashrc`. Replaces the Ubuntu 24.04 system Node 18, which was below SvelteKit 2's minimum. The
  system package is untouched; `nvm` shadows it on `PATH`.

  **`nvm` only shadows it in interactive shells.** A non-interactive shell — a script, a hook, an
  agent running commands — does not source `~/.nvm/nvm.sh`, so `/usr/bin/node` wins and `node
  --version` reports 18. Run `nvm use` (there is an `.nvmrc`) or put
  `~/.nvm/versions/node/v24.20.0/bin` on `PATH` explicitly. Same shape as ADR-0005's `DOTNET_ROOT`
  problem, and it will bite again.
- A GitHub repository with Pages enabled
- An Android phone on the same wifi as the development machine

Also installed on this machine, for slice 2 rather than slice 0: **.NET SDK 10.0.400 LTS with the
8.0 runtime** (user-local in `~/.dotnet`) and **Dafny 4.11.0** as a `dotnet tool`. Not needed here;
see [ADR-0005](../../docs/adr/0005-verified-kernels-in-dafny.md) for its two non-obvious
requirements — `DOTNET_ROOT`, and Z3 having to be placed by hand.

## Setup

```bash
npm install
npm run dev -- --host 0.0.0.0    # --host is what makes it reachable from the phone
```

`--host 0.0.0.0` matters more than it looks: it is what turns "check it on the phone" from a deploy
into a page refresh. Open `http://<laptop-ip>:5173` on the phone and the live-reloading development
build is there. Use this loop throughout; the deploy is for finishing the slice, not for iterating.

## Tests

```bash
npm test              # vitest, once
npm run test:unit     # while working
npm run check         # types
npm run lint          # formatting and lint
```

Test-first is mandatory for three of these (Constitution Principle II). They fail before their
implementations exist, and that failure is the point.

| Suite | Proves | Reference |
|---|---|---|
| `tests/domain/state.test.ts` | Transitions are legal; the projection is a function of history | [data-model.md](./data-model.md) § Projection |
| `tests/domain/history.test.ts` | Replaying history reproduces `word_state` exactly | FR-011, invariant 2 |
| `tests/domain/tiling.test.ts` | Tokens tile every document exactly — **invariants only, never expected segmentations** | FR-005, invariant 1 |
| `tests/domain/offsets.test.ts` | Code-point offsets survive astral-plane characters | FR-014, invariant 3 |
| `tests/architecture/domain-purity.test.ts` | No file under `src/lib/domain/` imports Svelte or storage | Principle V.4 |
| `tests/storage/migration.test.ts` | The hedge columns exist and cannot be left empty | invariant 5 |
| `tests/storage/provenance.test.ts` | A written state carries `provenance` and `user_id` on both tables | FR-012, FR-013, invariant 5 |
| `tests/storage/counts.test.ts` | 100 marks produce exactly 100 states and 100 history entries | SC-004 |

Two of these deserve their reasoning restated, because both look wrong at a glance:

- **`tiling.test.ts` never asserts an expected segmentation.** Word-hood in Chinese is undefined and
  analyzer-dependent, so an expected output encodes one analyzer's opinion and breaks on every
  upgrade. Generate inputs — mixed script, punctuation, newlines, Extension-B hanzi — and assert the
  properties.
- **`migration.test.ts` checks columns nothing uses.** That is exactly why it exists: invisible
  columns are what a later refactor removes as dead weight.

## Deploy

```bash
npm run build         # adapter-static → build/
npm run preview       # serve the production build locally first
```

Push to the branch GitHub Pages serves. **Check `paths.base` before the first deploy** — Pages
serves from `/<repo>/`, and a wrongly-rooted asset path gives a blank page that looks like a build
failure and is not.

## Validation

Run in order. The slice is not complete until step 5 passes **on the phone** (Principle I, SC-008).

1. **Save and reopen.** Paste a Chinese passage, save it, navigate away, return. Text intact,
   tokens in original order, nothing added or dropped. *(US1)*
2. **Mark and persist.** Tap a token, choose a state from the menu, reload. The mark survives.
   Open a different document containing the same character — it already shows that state, because
   state attaches to the word rather than the occurrence. *(US2, FR-007)*
3. **Survive everything.** Close the app, restart the phone, deploy a new version. Documents,
   states and history all intact. *(FR-015, SC-005)*
4. **Fail legibly.** Induce each of: empty input, input over the size limit, storage refused. Each
   must be identifiable from what the interface shows, without another device. *(SC-009)*
5. **The real test.** On your phone, away from the development machine, complete a full
   paste–read–mark cycle. *(SC-008)*

### Two checks that are easy to skip and shouldn't be

- **Astral-plane characters.** Paste a passage containing an Extension-B hanzi or an emoji, mark
  tokens on both sides of it, reload. If offsets are being counted in UTF-16 units anywhere, marks
  after that character land on the wrong token. This fails *silently* — no error, just wrong data —
  which is why it needs deliberate checking.
- **Rebuild the projection.** Call `rebuildProjection()` on a database with real marks and confirm
  nothing changes. This is the executable proof that `word_state` is a cache rather than a second
  source of truth.

## What "done" is not

- Working on the laptop. *(Principle I)*
- Looking finished. The analyzer is deliberately weak; a better placeholder validates nothing extra
  and makes the slice larger, which the spec defines as a defect.
- Passing tests without step 5.
