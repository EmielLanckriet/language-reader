# Data model: Study time sent to the Taal challenge

## Daily share (derived, never stored)

`{ day: 'YYYY-MM-DD', input: number, study: number, cards: number }` — minutes rounded once per
day and mode, cards counted (research R4). Computed from encounters, sessions and their latest
`attention` answer, for days from the connection's `since` and within 70 days of today.

## `taal_sent` (stored, migration 007, in the copy)

| column | type | rule |
|---|---|---|
| `day` | TEXT | `YYYY-MM-DD`, a study day |
| `mode` | TEXT | `input`, `study` or `cards` |
| `amount` | INTEGER | ≥ 0, what this app's share was at the last accepted send |

Primary key `(day, mode)`. Written only after Taal accepted a commit, in one transaction for the
whole send. Never deleted by a send; replaced by a restore. A row absent means 0.

A send for a day and mode: `delta = share − sent`; Taal's new value is `max(0, current + delta)`;
afterwards `sent = share`. Deltas of 0 are not written.

## Connection (per device, `localStorage` `reader.taal`, never in the copy)

`{ uid: string, since: 'YYYY-MM-DD', on: boolean }`

| event | effect |
|---|---|
| connect (sign-in succeeds) | `uid` from the account, `since` = today's study day, `on` = true |
| disconnect | `on` = false; Firebase sign-out; `taal_sent` kept |
| restore a copy | `on` = false |
| turn on again | as connect: a new `since` |

## Status (per device, `localStorage` `reader.taalStatus`)

`{ at: ISO time, ok: true, today: { input, study, cards } }` or
`{ at, ok: false, reason: 'signed-out' | 'offline' | 'refused' | 'format', detail: string }`.
Shown on Progress; replaced by each attempt.
