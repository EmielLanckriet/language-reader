# ADR-0025: A one-screen helper app to start Termux from Reader

**Status:** Accepted, 2026-09-27

## Context

When Android stops Termux, the reader service (ADR-0020) goes with it, and Reader can neither copy
the reader's work nor serve transcripts. The reader asked for Reader to start Termux itself.

A web page cannot. Chrome opens another app only through a BROWSABLE activity, and Termux has none
(its `intent:` link goes to the Play Store). A share can reach Termux, and Reader's first **Start
Termux** shared a start address to `termux-url-opener` (ADR-0020's amendment). On the reader's phone
that is four steps: the button, **More** in Chrome's own share panel (which Chrome shows for every
Web Share, link, text or file alike, measured), a swipe along Samsung's app row, and Termux. The
reader asked for fewer.

## Decision

**Reader Start** (`android/reader-start/`), an app of one translucent screen with a BROWSABLE
`reader-start://` filter. Reader's button opens it through an `intent:` link; it sends Termux's
documented `RUN_COMMAND` intent for `~/bin/reader-service-up` as a background task, and closes, so
the reader stays in Reader. The task runs the service in the foreground, which is what keeps Termux
alive (ADR-0020's amendment). Built without Gradle by `build.sh` (javac, d8, aapt2, apksigner; 12 KB),
installed over adb.

It needs Termux's `allow-external-apps = true` (setup.sh sets it) and the
`com.termux.permission.RUN_COMMAND` permission (asked on first use, or granted over adb).

The `intent:` link carries a fallback address: on a phone without Reader Start, Chrome comes back to
the page, Reader remembers it, and the next tap shares instead.

## Alternatives rejected

- **The share sheet only:** works, four steps.
- **A launcher shortcut (Termux:Widget):** leaves Reader to find an icon; still not one tap.
- **Keeping Termux from ever stopping:** done as far as Termux allows (the service now hosts itself
  and holds the wake lock), and Diagnostics now counts the stops. It lowers how often the button is
  needed; it does not remove the need.

## Consequences

- **Easier:** one tap, and Termux never shows.
- **Harder:** a third piece to build and install, beside the web app and the Termux scripts. It
  changes rarely: it runs one script whose content lives in `scripts/termux/`. A reinstall must use
  the same signing key (`~/.android/reader-start.keystore`, outside the repository).
- **Revisit if** Chrome starts letting a page target a share, or Termux gains a BROWSABLE entry.
