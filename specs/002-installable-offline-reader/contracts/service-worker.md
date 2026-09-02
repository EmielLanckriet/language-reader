# Contract: Service Worker

**File**: `src/service-worker.ts` | **Registered by**: the application, not SvelteKit
(`kit.serviceWorker.register: false`)

## Cache

One cache, named for the build: `cache-${version}` from `$service-worker`.

| Phase | Behaviour |
|---|---|
| `install` | `cache.addAll([...build, ...files])`. If any file fails, installation fails — the worker does not activate, and a half-cached application never becomes the live one. This is FR-007. |
| `activate` | Delete every cache whose name is not the current one, then `clients.claim()`. |
| `fetch` | Cache first. On a miss, go to the network. For a **navigation** request that misses, serve the cached shell (`${base}/index.html`), which is what makes deep links work offline. |

Only `GET` is handled. Anything else is passed straight through, because this application makes no
other kind of request.

`build` includes the WebAssembly binary and the worker bundle, so no special case is needed for
them — verified by inspecting the build output, where both appear under `_app/immutable/`.

## Messages

One message, in one direction.

| Message | Sent by | Effect |
|---|---|---|
| `{ type: 'skip-waiting' }` | The page, when the reader accepts a new version | The waiting worker calls `skipWaiting()` |

There is no message for "is there a new version". The page learns that from the registration
object, which it has because it did the registering.

## What the page relies on

```ts
const registration = await navigator.serviceWorker.register(url, { type: 'module' });

registration.waiting            // a version is ready right now
registration.addEventListener('updatefound', ...)   // one is installing
navigator.serviceWorker.addEventListener('controllerchange', ...)  // it took over; reload
```

## The invariant that matters

**The worker never activates over a running page except when asked.** There is no
`skipWaiting()` in the `install` handler.

This is FR-009, and it is satisfied by *not writing* the one line that most service worker examples
include. Recorded here because its absence is otherwise indistinguishable from an oversight, and a
future reader would be right to think something was missing.

`clients.claim()` in `activate` is a different matter and is kept. Activation only happens when
there is no controller to displace — a first install — or when the reader has accepted a new
version. In neither case does it replace a running version behind the reader's back.
