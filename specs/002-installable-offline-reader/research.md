# Phase 0 Research: Installable, Offline, and Safe From Silent Loss (Slice 1)

**Date**: 2026-09-02 | **Spec**: [spec.md](./spec.md)

Everything below was measured or read from the installed version, not recalled. Where a fact came
from the web it is cited, because two of them are recent enough that memory would have been wrong.

---

## R1. Is the application small enough to keep on the device in full?

This was the spec's one outstanding assumption and the only one that could have forced a different
shape. It is measurable before any code is written, so it was measured first.

**Decision**: Precache the whole application. No partial or on-demand strategy.

**Rationale**: A production build is **2.6 MB across 28 files**. The largest single file is
`sqlite3.wasm` at 844 KB. For comparison, a single document the reader pastes is at most 5,000
characters. There is no size pressure here and no decision to agonise over — the assumption held,
and holding it means FR-004 through FR-007 can be satisfied by the simplest available approach.

**Alternatives considered**: Caching the WebAssembly binary lazily on first use, so the first visit
is cheaper. Rejected: it makes FR-007 ("if the application cannot be made completely available, it
MUST say so") much harder to honour, because there would be no single moment at which completeness
is known. Paying 2.6 MB once buys a definite answer.

---

## R2. The build contains a second copy of SQLite that never runs

Found while measuring R1, and worth its own entry because it changes what R4 caches.

`sqlite3.wasm` appears **twice** in the build — once under `_app/immutable/workers/assets/` where
it belongs, and once under `_app/immutable/assets/` where nothing executes it. The same is true of
`sqlite3-opfs-async-proxy.js` (31 KB) and the worker1 promiser glue (206 KB). Together that is
about **1.08 MB of the 2.6 MB build**, fetched by the main thread and never used.

The cause is a single import. `session.ts` needs `requestPersistentStorage`, which is a two-line
wrapper over `navigator.storage.persist()` and has nothing to do with SQLite. It imports it from
`db.ts`, and `db.ts` imports `@sqlite.org/sqlite-wasm` at the top level. Verified by grep: the app
entry and every route node reach the chunk, and the chunk names `sqlite3.BVKGSWc-.wasm`.

**Decision**: Move `requestPersistentStorage` out of `db.ts` into its own module, leaving `db.ts`
reachable only from the worker.

**Rationale**: Without this, the service worker precaches 1.08 MB of nothing, and pays for it again
on every version change. This is not a general optimisation pass being smuggled into the slice; it
is specific to the fact that this slice makes the download mandatory and repeated.

**Note for later**: nothing warned about this. A build-size assertion would have. Recorded as a
candidate for a later slice rather than built now.

---

## R3. A manifest served from a project subpath

The site is served from `/language-reader/`, `BASE_PATH` is injected at build time, and a static
manifest cannot interpolate it. The slice input flagged this as critical and it is.

**Decision**: All manifest member URLs are **relative**: `"start_url": "./"`, `"scope": "./"`, and
icon `src` values with no leading slash. The `<link rel="manifest">` in `app.html` uses
`%sveltekit.assets%`.

**Rationale**: Manifest members resolve against **the manifest's own URL**, not the origin root. A
manifest at `/language-reader/manifest.webmanifest` therefore resolves `"./"` to
`/language-reader/` — correct, and correct for any base path, including the empty one used locally.
An absolute `"/"` would install an application that launches at the domain root and shows a missing
page, which is the failure FR-002 names.

`%sveltekit.assets%` was verified to emit an absolute prefix rather than a relative one: building
with `BASE_PATH=/language-reader` produced `href="/language-reader/_app/..."` in `index.html`. This
matters more than it looks, because `404.html` is the same shell served at arbitrary depths
(`/language-reader/read/3`). Relative asset URLs would break there; absolute ones do not.

**Alternatives considered**: Generating the manifest at build time so it can hold absolute URLs.
Rejected as strictly worse — it adds a build step to produce a value that relative URLs give for
free, and it would break the local build where the base path is empty.

---

## R4. Making the application available offline

**Decision**: A service worker at `src/service-worker.ts`, precaching `build` and `files` from the
`$service-worker` module, registered **manually** with `kit.serviceWorker.register: false`.

**Rationale**: `$service-worker` was read from the installed `@sveltejs/kit` types rather than
assumed. It exports `build` (everything Vite emitted — which includes the WebAssembly binary and
the worker bundle), `files` (the `static` directory), `version`, and `base`. Its `base` is
documented as *"calculated from `location.pathname`, meaning that it will continue to work
correctly if the site is deployed to a subdirectory"* — which is exactly R3's problem, already
solved.

Registration is manual because FR-010 needs the `ServiceWorkerRegistration` object to detect a
waiting version and to tell it to activate. SvelteKit's automatic registration would hide it.
`kit.serviceWorker.register: false` was confirmed present in the installed config types.

Navigation requests are served from the cached shell, which is what makes deep links work offline
and is the same trick `404.html` already plays for GitHub Pages.

**FR-008 (a first-ever visit with no network)**: nothing can be served, because nothing was ever
fetched. The browser's own failure page appears. Meeting FR-008 requires the one thing that *is*
always present on a cold visit — the HTML shell — to carry a message. This is the weakest point in
the offline story and is called out as such rather than papered over.

---

## R5. Version changes

**Decision**: Use the service worker's own lifecycle. A newly deployed worker installs and enters
`waiting`; the application notices and offers a control; the control posts `skipWaiting` and
reloads.

**Rationale**: This is the rare case where the requirement and the platform's default already
agree. FR-009 says a new version MUST NOT replace the running application mid-session — which is
precisely what `waiting` means. Nothing has to be built to satisfy FR-009; something would have to
be built to *violate* it. FR-010's explicit control is then `postMessage('skipWaiting')`.

FR-011 (everything survives) is satisfied because reader data lives in OPFS, which no cache
operation touches. The plan asserts this rather than assuming it.

`kit.version.pollInterval` defaults to `0`, so nothing polls in the background. Consistent with
FR-015a's spirit, though FR-015a is about storage rather than versions.

**Alternatives considered**: SvelteKit's `updated` store with a poll interval. Rejected — it adds
periodic network requests to an application whose selling point is not needing the network, to
learn something the service worker already knows for free.

---

## R6. The storage lease — the substantive decision in this slice

### The constraint

The SAH-pool VFS locks every file it will use at registration time, deliberately. The library's own
documentation explains why registration is not automatic: *"its registration requires that it lock
all resources it will potentially use... one page in a given origin has loaded this VFS but does
not use it, then another page in that origin tries to use the VFS [and] would fail to load the VFS
due to OPFS locking errors."*

So a second copy cannot open the database **even to read it**. Detection alone therefore cannot
satisfy FR-014 ("content already saved MUST remain readable") or US3 scenario 3. Detection gives an
honest notice over an empty library, which looks exactly like the data loss this slice exists to
remove the fear of.

### What makes a different answer possible

`@sqlite.org/sqlite-wasm` 3.53.0 provides `pauseVfs()`, `unpauseVfs()` and `isPaused()` on the pool
utility — confirmed present in the installed bundle. From its documentation: `pauseVfs()`
*"'Pauses' this VFS by unregistering it from SQLite and relinquishing all open SAHs, leaving the
associated files intact"*, and `unpauseVfs()` *"'Unpauses' this VFS, reacquiring all SAH's"*.

One caveat is load-bearing: `pauseVfs()` *"throws if SQLite has any opened file handles hosted by
this VFS"*. The database connection must be closed first. Our worker owns exactly one connection,
so this is sequencable rather than merely hopeful.

### Decision

**A copy holds the storage lease only while it is the visible one.** On becoming hidden it closes
the database and pauses the VFS. On becoming visible it unpauses and reopens. A copy that cannot
acquire the lease is read-only, says so, and retries when the reader acts.

**Rationale**: A phone shows one thing at a time. Tying the lease to visibility means the copy the
reader is actually looking at always has it, so the read-only state stops being the routine outcome
of having a forgotten tab open and becomes what it should be — a real and rare condition. It needs
no protocol between copies: no channel, no request-and-yield handshake, no timeout, no recovery
from both copies having paused at once. The contended case (genuinely two visible copies, or a
holder frozen before it could yield) still degrades to the read-only notice, correctly.

It also improves durability incidentally: backgrounding now closes the database cleanly rather than
leaving it open for the operating system to reclaim.

**Alternatives rejected**:

- **A negotiated handover** over `BroadcastChannel` — the loser asks, the holder yields. Satisfies
  FR-014 even with two simultaneously visible copies, which visibility-yielding does not. Rejected
  on cost: a message protocol, fencing against in-flight writes, timeouts for a holder that never
  answers, and recovery from both copies paused. More machinery than the rest of the slice put
  together, to cover a case that barely arises on a phone.

- **Exclusion only, amending FR-014.** The smallest change: detect, refuse, explain, retry. Rejected
  because the reader taps their home-screen icon, a browser tab is open somewhere, and their library
  is gone. Honest, and alarming at precisely the wrong moment.

- **A `SharedWorker` holding one connection for all copies.** This is the textbook answer and it is
  newly possible: SharedWorker shipped on Chrome for Android in milestone 148, April 2026. Rejected
  on the Intent to Ship's own caveat — *"SharedWorker instances might terminate unexpectedly, for
  example, when a Chrome app is moved to the background and then foregrounded."* Backgrounding and
  foregrounding is the entire life of a phone reading application. Building this slice's data-safety
  guarantee on the newest and least-settled thing available inverts the point of the slice. Recorded
  as available rather than rejected forever; it becomes the natural implementation if the spec's
  anticipated move from exclusion to sharing ever happens.

- **Reading the database file directly, bypassing the VFS.** The SAH pool stores data in opaque
  fixed-size pool files with its own header and filename mapping. Not a SQLite file on disk, and not
  readable without acquiring the pool.

### Telling the two causes apart (FR-013)

`navigator.locks` distinguishes them. Each copy takes a Web Lock alongside the VFS. Asked with
`{ ifAvailable: true }`, a refusal means **another copy holds it**; acquiring the lock and then
failing to install the VFS means **storage is unavailable on this device**. When the lock is held
but the outcome is still unclear, FR-013 requires saying so and showing the recorded reason — which
the diagnostics log already stores.

Web Locks is used only to *name the cause*. It is not what enforces exclusivity; the VFS does that
by itself. This distinction matters, because a lock that is merely advisory would be a false
guarantee.

---

## R7. Offering installation from inside the application (FR-003a, FR-003b)

**Decision**: Capture `beforeinstallprompt`, keep the event, show a control while it is held, call
`prompt()` when the reader taps it, and drop the control on `appinstalled` or when
`matchMedia('(display-mode: standalone)')` matches.

**Rationale**: FR-003b is the reason this is worth the code. A browser only fires
`beforeinstallprompt` once the application genuinely qualifies for installation — manifest served
and parsed, required icons present, service worker with a fetch handler, served over a secure
origin. So the control's presence is a live, self-checking assertion that installation is correctly
configured. Slice 0's failure was that nothing qualified and nothing said so; this makes that class
of failure visible from inside the application.

**Consequence to accept**: `beforeinstallprompt` is Chromium-only. On a browser that does not fire
it, no control appears. On the target device — Android Chrome — it does, and FR-003b says an
absence there is a defect.

---

## R8. Icons

**Decision**: Generate 192px and 512px PNGs from the existing `src/lib/assets/favicon.svg`, commit
them to `static/`, and include a `maskable` variant.

**Rationale**: A manifest without a 192px and a 512px icon does not qualify for installation, so
this is a precondition for R7 rather than decoration. `maskable` exists because Android crops icons
to the launcher's shape; without it the icon gets a white bounding box, which FR-003's "not a
generic placeholder" is aimed at.

---

## Summary of what changed as a result of research

| Question | Answer | Effect on the plan |
|---|---|---|
| Is the app small enough? | Yes — 2.6 MB, 28 files | Precache everything; assumption closed |
| Anything wasteful in that? | 1.08 MB duplicate SQLite | A fix belongs in this slice |
| Manifest under a subpath? | Relative members resolve correctly | No build step needed |
| How to not swap mid-session? | The `waiting` worker already does | FR-009 needs no code |
| How does a copy get the lease? | Hold it only while visible | The slice's one real mechanism |
| How to name the cause? | Web Locks, advisory only | FR-013 satisfied honestly |
