# ADR-0009: A Hand-Written Service Worker And A Relative Manifest

**Status**: Accepted
**Date**: 2026-09-02
**Relates to**: ADR-0007, ADR-0008; Constitution Principle I, Principle VII; slice 1 plan

## Context

Slice 0 deployed successfully and failed the only test that matters. Tapping the home-screen icon
opened a browser, and opening the application after a phone restart required a network. Both are
Principle I failures — the thing that shipped was not the thing being used — and offline reading is
named in the constitution rather than being a preference.

Two mechanisms are needed: a web app manifest so the device installs an application rather than
saving a bookmark, and a service worker so the application's own files are on the device.

The complication is deployment. The site is served from `/language-reader/`, derived at build time
from the repository name so that a rename does not break it. A static file cannot interpolate that,
and an absolute URL baked into one would be wrong in exactly one environment — the deployed one.
This is the failure mode that is invisible locally, where the base path is empty.

## Decision

**A static manifest whose every member URL is relative**, and **a hand-written service worker of
about fifty lines** that precaches the entire build.

- `start_url` and `scope` are `"./"`; icon `src` values have no leading slash. Manifest members
  resolve against the manifest's own URL, so a single file is correct under any base path.
- The service worker precaches `build` and `files` from SvelteKit's `$service-worker` module, whose
  `base` is documented as being computed from `location.pathname` — the subpath problem, already
  solved by the framework.
- Registration is manual (`kit.serviceWorker.register: false`), because the application needs the
  registration object to detect a waiting version.
- **Version changes ride the worker's own lifecycle.** A new worker installs, enters `waiting`, and
  stays there. The reader is offered a control that posts `skipWaiting` and reloads.

## Alternatives Rejected

**Workbox.** The standard answer, and rejected on three counts. It is a new dependency, which
Principle V says needs a named justification it does not earn here. Its output is a generated
service worker that would be committed and read — precisely the artifact Principle VII's
source-versus-artifact clause declines to protect, because there is no retained editable source. And
what is actually needed is one `addAll`, one cache sweep, and one cache-first handler.

**Generating the manifest at build time so it can hold absolute URLs.** Strictly worse: a build step
to produce what relative URLs give for free, and broken in local builds where the base path is empty.

**Caching the WebAssembly binary lazily.** Would make the first visit cheaper, at the cost of
FR-007 — there would be no moment at which "the application is completely available" is known.
Measurement removed the motivation anyway: the whole build is 2.6 MB.

**Polling for new versions** via SvelteKit's `updated` store. Rejected: periodic network requests in
an application whose point is not needing the network, to learn something the service worker already
knows.

**`skipWaiting()` in the install handler**, as most examples do. This is not merely unnecessary but
directly prohibited by FR-009: it replaces the running application mid-session, which is a way to
lose work. Its absence is recorded in `contracts/service-worker.md` so that a later reader does not
mistake it for an oversight.

## Consequences

**Easier.** FR-009 required no code — a waiting worker is already what the requirement asks for.
Deep links work offline through the same cached shell that `404.html` already uses for GitHub Pages,
so one trick covers two problems.

**Harder.** A first-ever visit with no network cannot be served anything, because nothing was ever
fetched. FR-008 asks for an explanation at exactly the moment there is nothing on the device to
explain with. This is the weakest point in the offline story and is recorded as such rather than
being quietly dropped.

**A discovery this forced.** Measuring the build to decide the caching strategy revealed that
1.08 MB of it is a second copy of SQLite that never executes, pulled in because `session.ts`
imports `requestPersistentStorage` from `db.ts` and `db.ts` imports the SQLite bundle. Nothing
warned about it; it had been shipping since slice 0. Precaching would have made it a recurring cost
rather than a one-off, so the fix belongs in this slice. The general lesson — that nothing in this
project asserts anything about build size — is recorded in the anticipated-changes register rather
than acted on now.

**Revisit if.** The application grows enough that precaching everything becomes a real cost, at
which point the question is which parts can be deferred without losing the definite answer FR-007
depends on. Dictionary data in slice 2 is the plausible trigger.
