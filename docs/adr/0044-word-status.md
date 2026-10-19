# ADR-0044: A word's status is stored apart from its memory
Status: Accepted. Date: 2026-10-19. Amends: [ADR-0039](0039-which-words-are-cards.md) (which words
are cards), [ADR-0040](0040-retired-words.md) (retired words, setting Anki words aside),
[ADR-0041](0041-hardcore-drill-reviews.md) (a word drilled in at 14 days). Spec 019.

Every word has a **status**: `retired`, `active` or `ignored`, a word with none being retired. It
is kept in its own log, `status_change` (earned: word, status, cause, when, device position), with
`word_status` as its replay (derived). Memory is computed for every word whatever its status and
no longer carries card flags.

- **Active** words are due on Cards when their reading recall is due. **Retired** words are on
  Cards only as one of the day's new words. **Ignored** words are never on Cards or in a drill.
  Hardcore drills new or due words whatever their status, ignored ones excepted. Shares count
  every word by recall.
- A retired word becomes active in two ways only, decided by one function (`status.ts`
  `activation`) called from one place (after a word's memory is recomputed): its reading
  stability reaches 14 days (after a hand retire, only once it was below 14 since), or it is
  reviewed on Cards as a budget pick (a review after its latest status change and after the
  switch). The budget picks tapped words that are neither active nor ignored, most frequent first.
- Only the reader moves a word out of active or ignored: Retire and Ignore on Cards, a drill card,
  the word sheet and Progress's word detail, each undoable; undo restores the previous status.

Why: on 2026-10-19 the reader read how cards were chosen and found rules from three ADRs still in
force that they no longer held: known words and Anki seeds active whatever their stability, a
`learning` mark making a candidate, `ignored` dropping a word's evidence. They set the rule above,
asked that it change in one place only, that a word once active stay active, and that status be a
separate field rather than part of memory.

The switch, once per library (recognised by a `status-switch` encounter, so a restored older copy
runs it too): every word active under the old rule gets `active` (`carried-over`) — 2,111 on the
2026-10-16 backup, 5 of them Anki words under 14 days kept only by this; marks asserting `ignored`,
`learning`, `known`, `unknown` or `retired` are deleted with any `(none)` that undid one (the reader:
"get rid of all the retired marks, this was a bit of a mess"). A word retired by hand past 14 days
becomes active (丁, 22 days); the reader can retire it again.

Rejected: status as marks in `status_event` (the reader chose a separate table; the Anki import
reads the latest mark as the reader's own judgment); a current-status table without a log (no
replay, no cause); deriving status from history each time (an active word could stop being one
when a rule or parameters change); activating a budget pick when shown rather than reviewed.

Not changed: evidence, FSRS and every stability; the 14-day constant; the budget and its count of
first reviews; Anki levels as marks.
