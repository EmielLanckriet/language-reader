# ADR-0022: Reader Fetches New Videos From Termux; Nothing Is Shared Into It

**Status**: Accepted
**Date**: 2026-09-25
**Relates to**: ADR-0017 (amends how a bundle reaches the app), ADR-0020 (the reader service)

## Context

ADR-0017 had Termux share each bundle to Reader through Android's share sheet, received by the
manifest's `share_target`. It could only be tested once the emulator had a Google account, and then
it failed. With Chrome 154 and an installed WebAPK, a share from Termux reaches the service worker,
but `request.formData()` rejects with "Failed to fetch" for any file, 10 KB or 40 MB. The page shows
ERR_FAILED. The same handler works for a POST made from the page itself. Separately, the reader's
phone runs Reader as a **Samsung Internet** WebAPK, installed 2026-09-02, which is not a share target
at all.

## Decision

**Termux never hands a bundle over.** `termux-url-opener` leaves `bundle.tar` in its job folder,
written aside and renamed so it is never seen half-written. The reader service lists recent jobs at
`GET /downloads`. The library shows those not yet imported under **New from Termux**, and Open
fetches the bundle over `127.0.0.1` and imports it as before. Imported jobs are recognised by the
`job` that each document's `meta.json` records. The `share_target`, its service-worker handler and
the inbox cache are removed; opening a bundle file by hand remains as a fallback.

## Alternatives Rejected

- **Debugging the share further**, for example by copying the bundle to shared storage first. That
  might fix Chrome, but not Samsung Internet, and the share would stay the one step that cannot be
  tested without an account.
- **Termux opening Reader by URL.** It would open in the default browser, which on the phone may be
  a tab rather than the installed app.

## Consequences

- **Easier:** one path for every browser; one tap fewer (no second share sheet); the video checks
  now import the way the reader does, through the list.
- **Harder:** the reader opens Reader themselves once the download is done; Termux's terminal says
  so. A notification would need Termux:API, one more app.
- **Revisit if** a share target becomes reliable for files from Termux and the second tap is missed.
