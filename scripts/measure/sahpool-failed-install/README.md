# A failed opfs-sahpool install, and retrying it (#19)

Two questions about sqlite-wasm 3.53's `installOpfsSAHPoolVfs`, measured 2026-10-16 in headless
Chrome on the laptop. Serve the repository root with something that transpiles `.ts` (the worker
imports `src/lib/storage/pool-guard.ts`), then open:

- `index.html` (`?guard` to install Reader's guard first): writes 3 rows, makes a second install
  fail on a pool file's access handle while nothing holds the files, then reopens.
- `race.html?trials=N&max=MS` (`&guard`, `&retry`, `&cached`): the natural race, no injection.
  Worker A holds the pool, worker B installs, A lets go after 0–MS ms; then the rows are counted.
  `&retry` retries in B every 150 ms for up to 4 s, as `lease.ts` does, with
  `forceReinitIfPreviouslyFailed`; `&cached` retries without it, as Reader did before.

**A failed install can delete the database.** The library's cleanup (`removeVfs`) removes the
pool's `.opaque` directory recursively. In `index.html` without the guard, every pool file was
gone and the reopened database had no table (2 of 2 runs); with the guard, all files and 3 rows
stayed. In the natural race the delete was always refused, since A still held the files when it ran
(160 trials, A letting go within 0–60 ms): the dangerous case is a failure whose holder lets go in
the moment before the delete, or a failure with no holder at all.

**A failed install is cached.** Without `forceReinitIfPreviouslyFailed` every retry got the first
refusal back: 3 of 3 refused installs stayed refused for the whole 4 s, which is #19's wait before
a fresh worker. With it, 26 of 28 refused installs succeeded on the second try, 172–179 ms after
the first; 2 of 40 trials stayed refused for 4 s (suspected: a handle the failed attempt still
opened after giving up, which only ending the worker frees; not established).
