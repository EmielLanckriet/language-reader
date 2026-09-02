# Quickstart: Validating Slice 1

**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

Three things must be proved, and only the third can be proved on a laptop's terms. Principle I is
explicit that this slice is not complete until the phone says so — SC-008 says the same thing in
the spec's own words.

## Prerequisites

```bash
nvm use                 # Node 24.20.0, per .nvmrc
npm ci
```

## The gates that run everywhere

```bash
npm run check           # types
npm run lint            # formatting and lint
npm test                # vitest, including the Principle II state-transition tests
```

The availability state machine is a pure module, so its tests are ordinary unit tests. If they need
a browser to run, the seam has been drawn in the wrong place.

## Build and serve as it will actually be served

```bash
BASE_PATH=/language-reader npm run build
npm run preview
```

Serve **with** the base path locally. The whole class of bugs this slice guards against — an
absolute `start_url`, an absolute asset URL, a service worker scoped to the origin root — is
invisible when the base path is empty, which it is by default.

Service workers need a secure context. `localhost` counts, so preview is enough.

## Checks that can be made locally

| # | Check | How | Expects |
|---|---|---|---|
| 1 | No absolute manifest URLs | `cat build/manifest.webmanifest` | No member value begins with `/` |
| 2 | The manifest is reachable | open `/language-reader/manifest.webmanifest` | 200, valid JSON |
| 3 | The application qualifies for installation | DevTools → Application → Manifest | No "installability" errors listed |
| 4 | Everything is precached | DevTools → Application → Cache Storage | One entry per build artifact, including `sqlite3.wasm` |
| 5 | The duplicate is gone | `npm run build` (runs `check-bundle`) | Passes; build is ~1.5 MB across 26 files, not 2.6 MB across 28 |
| 6 | Offline works | DevTools → Network → Offline, then reload | Library renders; a saved document opens |
| 7 | A deep link works offline | Offline, hard-load `/language-reader/read/1` | Renders, from the cached shell |
| 8 | Version change does not interrupt | Rebuild, reload once | Old version still running; an offer appears |
| 9 | Version change keeps data | Accept the offer | Document and mark counts unchanged |
| 10 | A second copy is honest | Open the same URL in a second **visible** window | It says it cannot save, and says why |
| 11 | Refusal is real | In that copy, try to mark a word | Refused. Nothing appears to succeed. |
| 12 | Yielding works | Switch back to the first window, then to the second | The visible one accepts writes |

Checks 5 and 12 are the two most likely to regress silently, and both are cheap to run.

## Checks that require the phone (Principle I, SC-008)

Nothing below can be substituted with a desktop equivalent. Slice 0 is the evidence: the home-screen
icon opening in a browser was invisible until someone tapped it.

| # | Check | Requirement |
|---|---|---|
| P1 | The application offers to install itself, without going through a browser menu | FR-003a, FR-003b |
| P2 | The installed icon shows a real name and image, not a placeholder or a white box | FR-003 |
| P3 | Tapping the icon opens it with no address bar and no tab strip | FR-001, SC-002 |
| P4 | It opens on the library, not a missing page | FR-002 |
| P5 | Restart the phone, enable aeroplane mode, open the app | FR-004; the check slice 0 failed |
| P6 | With no network: open a document, mark words, close, reopen — marks are there | FR-004, SC-005 |
| P7 | With no network: paste and save new text | FR-006 |
| P8 | Reading a saved document starts within 30 seconds of tapping the icon | SC-001 |
| P9 | Open the installed app *and* the same URL in Chrome; the one in front works | FR-012, FR-014 |
| P10 | The device-information view states that marks are provisional and documents are not | FR-018 |
| P11 | Deploy a new version while the app is open; nothing changes until asked | FR-009, FR-010 |
| P12 | After accepting it, every document and mark is still there | FR-011, SC-003 |

**P5 is the one to run first.** It is the requirement the constitution calls non-negotiable, it is
the one slice 0 got wrong, and it is the only one that needs a phone restart — so it is the slowest
to discover late.

## Deliberately not checked here

- Segmentation quality. The analyzer is untouched; slice 2 owns it.
- Anything about a second device, export, or sync. Out of scope by the spec.
