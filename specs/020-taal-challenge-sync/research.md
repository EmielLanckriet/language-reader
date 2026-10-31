# Research: Study time sent to the Taal challenge

What Taal does was read from its published bundle (`/assets/index-ZAE9LY_4.js`, 2026-10-26), not
from a document or its source; it holds until Taal is rebuilt differently. Not checked: Taal's
database rules, and which domains its sign-in allows (asking Taal's server from here was refused,
and it is the friend's to tell).

## R1 — Taal's log, as its page uses it

- The log is one document, `users/{uid}/challenge/log` in project `language-81ef3`:
  `{ days: { "YYYY-MM-DD": { <key>: number } }, freeChoices: { "YYYY-MM-DD": mode }, updatedAt }`.
- Keys read: `cards`, `passive`, `review`, `input`, `output`, `study`, and aliases folded into them
  (`flashcards`→`cards`, `video`/`reading`→`input`, `study-video`/`focused`→`study`,
  `conversation`→`output`). Anything else, and any value ≤ 0, is dropped on reading. Review minutes
  are `review + cards / 5 + passive`.
- Taal's page saves the whole document (`setDoc`, no merge) when the reader changes a number or a
  free choice, from its copy kept current by a live listener. Unknown keys and fields do not
  survive that save; this app's numbers do, because they are in the keys Taal keeps.
- Taal shows and copies to groups only days within 70 days of today. The group leaderboard
  (`groups/{g}/members/{uid}`) is written by Taal's page, 2.5 s after its numbers change, while it
  is open.
- A day key is the local date of now minus Taal's day-reset hour: the same rule as this app's
  `dayEndHour` (`studyDays` in `src/lib/domain/study.ts`).
- Sign-in is Google only (`signInWithPopup` / redirect through `language-81ef3.web.app`).

## R2 — Sign in with Firebase's auth module, nothing else of Firebase

- Decision: `firebase` 12.19.0 (2026-09-09; 13.1.0 is five days old), importing only
  `firebase/app` and `firebase/auth`: `signInWithPopup` with `GoogleAuthProvider`, its own
  persistence for the session, `getIdToken()` before each send. Loaded as its own chunk, only when
  the reader connects or a send runs.
- Measured (esbuild, minified, firebase 13.1.0): auth alone 139 KB (35 KB gzipped); auth with
  the full Firestore client 602 KB (163 KB); with Firestore lite 261 KB (67 KB). The install
  ceiling (`scripts/check-bundle.mjs`) has room for 139 KB; the size is re-measured with 12.19.0
  in the build.
- What the friend does: add `emiellanckriet.github.io` to Authentication → Settings → Authorized
  domains. Nothing else.
- Rationale: sign-in is the security-sensitive part, and the library is Google's own; Principle V
  justification: no way to obtain Taal's Firebase session without it short of reimplementing the
  OAuth exchange.
- Alternatives: (a) no dependency — Google's OAuth redirect for an ID token, then the
  identity-toolkit REST exchange and token refresh written here: the friend must also add a
  redirect URI and origin to the project's OAuth client in Google Cloud, and token handling becomes
  this app's code; (b) the full Firebase SDK: 4× the size for one document; (c) a token copied by
  hand out of Taal's storage: unsupported, and a long-lived key to the whole account.
- Risk, measured first on the phone: the popup from the installed app (standalone display mode)
  on Android Chrome. Redirect sign-in is likely no fallback: Taal's auth domain is another
  origin, and Firebase's own guidance says browsers that partition third-party storage break
  redirect sign-in across origins (not checked here). If the popup fails, alternative (a) is the
  way, with the friend's second setting.

## R3 — Write through the database's REST interface, read then commit

- Decision: `fetch` to `firestore.googleapis.com/v1/projects/language-81ef3/databases/(default)`
  with the ID token as bearer. A send reads the log (`GET`, giving its fields and `updateTime`),
  computes the new values, and commits (`:commit`) one update with an update mask naming only the
  fields it changes (``days.`2026-10-26`.input`` …) and `updatedAt` set to the server time, under
  the precondition `currentDocument.updateTime` (or `exists: false` for a new log). A failed
  precondition reads and computes again, up to three times.
- Rationale: FR-008 — a value Taal changed since is added to, other fields are untouched; the
  clamp at zero (FR-005) needs the current value, which a blind `increment` transform lacks. No
  Firestore client in the bundle, and the base URL is one constant a verification build replaces.
- Alternatives: `increment` transforms (no read, but cannot stop at zero); Firestore lite's
  `runTransaction` (+122 KB, same semantics).

## R4 — The shares

- Reading and watching: the `study-time` encounters Progress's week already counts (capped at
  60 s each), of sessions not withdrawn; Study when the session's latest `attention` answer is
  `all`, Input otherwise (and for any `study-time` without a session).
- Cards: `review` encounters without a `hardcore` detail (`recordReview` writes them with no
  session), counted.
- Drill: per hardcore session and part, from its `hardcore-step` `drill` `start` to its `end`, or
  to the part's last `review` with `hardcore.part` when there is no end; none when neither. Hardcore
  grades are not cards. The watching steps are read-page sessions with their own `study-time`, so
  they are counted once, by the first rule.
- Days: the same function as the week on Progress — `studyDays`'s day labelling moves into an
  exported `studyDayOf(at, timeZone, dayEndHour)`, behaviour unchanged; a drill interval crossing a
  day end is split at it.
- Rounding: per day and mode, the total is rounded to whole minutes once (Taal rounds hand entries
  the same way); per-session rounding would lose up to a minute a session.

## R5 — What was sent: a table, and in the copy

- Decision: `taal_sent (day TEXT, mode TEXT, amount INTEGER, PRIMARY KEY (day, mode))`, migration
  `007-taal-sent.sql`, written in the same step as the share is recorded sent, after Taal accepted
  the commit. Copy format 5 carries it (`taalSent`); restoring replaces it.
- Rationale: FR-005/FR-006. It records what an outside system received, which nothing here can
  recompute: earned by the ADR-0003 rule, so it goes with the copy. It cannot live in Taal's log,
  whose whole-document saves drop keys Taal does not know.
- The share sent is the computed share, also when Taal's value was clamped at zero: the record says
  what this app accounts for, not what Taal shows.

## R6 — Connection and status: per device, never in the copy

- `localStorage` `reader.taal`: `{ uid, since, on }` — `since` is the day of the latest connect
  (FR-011); `reader.taalStatus`: the last attempt's time, outcome, today's amounts or the reason.
  The Firebase session stays in Firebase's own storage.
- Restoring a copy (Termux or file) sets `on` to false (FR-010); turning it on is a connect, with a
  new `since`.

## R7 — When a send runs

- One `requestSend()` in `src/lib/taal/sync.ts`, debounced 20 s, a single send at a time, called
  on app open, on `online`, after a session ends or a session answer changes, after a Cards grade,
  and after a drill step ends. A failed send waits for the next call. Nothing awaits it.
- The shares query reads only days from `since` and within 70 days, in the storage worker.

## R8 — Verification never reaches the real Taal

- Unit tests: the domain functions are pure; the sync takes `fetch` and a token function as
  parameters, given a fake log in memory (the plumbing test: a precondition failure retried, a
  failed send leaving the record unchanged).
- Browser scenario `taal`: in a verification-mode build, connecting uses a fixed fake account and
  the base URL points at a stub of the two REST calls in `serve.mjs`; the scenario reads the stub's
  log. No Google sign-in in any scenario.
- Real Taal only on the phone, by the reader's account, after the friend's setting.
