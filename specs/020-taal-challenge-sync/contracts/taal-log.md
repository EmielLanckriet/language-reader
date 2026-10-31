# Contract: Taal's challenge log and the copy

## What this app reads and writes in Taal (an outside system's format, research R1)

Document `projects/language-81ef3/databases/(default)/documents/users/{uid}/challenge/log`.

- Reads: `days.<day>.input`, `days.<day>.study`, `days.<day>.cards` (integer or double; absent =
  0) and the document's `updateTime`.
- Writes, in one commit with an update mask of exactly these paths: each changed
  ``days.`<day>`.input|study|cards`` as an integer, and `updatedAt` = server time. Precondition:
  the `updateTime` read, or `exists: false` when there was no log.
- Never writes `output`, `review`, `passive`, any alias key, `freeChoices`, or another day's keys
  it did not change; never writes `groups/…`.
- A response this app cannot read (a missing `fields` map where one is expected, a non-number
  value in a key it writes) stops the send with reason `format`; nothing is written and
  `taal_sent` is unchanged.

## The copy, format 5

Format 4 plus `taalSent: { day: string, mode: 'input' | 'study' | 'cards', amount: number }[]`.
A format-4 copy restores with no rows. A copy with a row outside these modes or with a negative or
non-integer amount is refused like any other malformed copy.
