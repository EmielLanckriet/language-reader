# ADR-0048: Copies to Termux as a chain of increments

Status: Accepted. Date: 2026-11-05. Amends ADR-0020. Issue #44.

Every copy to Termux was the whole library: with 46,000 encounters, 1.3 s of export in the storage
worker and 0.5 s of sealing on the main thread on the laptop (several times that on the phone),
every 5 minutes of use and every time the app went to the background. Calls waiting behind it are
the slowdowns in #44.

Decided, after Sapling's event log:

- **A chain**: one full copy, then increments. An increment holds the history rows after the
  writer's last sequence number in the chain (events, sessions, encounters, corrections,
  statuses — every one already carries `deviceId` and `deviceSeq`), the documents whose content
  changed (a cheap mark per document, every current id listed), the states of the words those
  rows touched or their removal, and the devices. Measured on the real library: 3.6 ms and
  860 bytes after a Cards grade, against 1.8 s and 17 MB.
- **Termux does not merge** (as Sapling's relay does not): it takes an increment only if it
  follows the chain's last piece (409 otherwise) and serves `/backup/chain` unmerged. The app
  checks each piece's integrity and merges at restore (`mergeChain`), which must equal the full
  export — the test, with mutations that fail it.
- **A full copy instead** when there is no chain, when Termux refuses an increment or is too old
  to take one, when the row counts no longer add up (a deletion, a restore), and once a week,
  only while the app is hidden, so a restore stays short.

Alternatives: Termux folding increments into a full copy (it already reproduces the integrity
check, but the relay would have to understand the format); making the full copy cheaper (it grows
with history regardless).
