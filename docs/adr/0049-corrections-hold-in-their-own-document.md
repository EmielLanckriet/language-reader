# ADR-0049: A correction holds in the document it was made in

Status: Accepted. Date: 2026-11-07. Narrows ADR-0028; issues #56, #57.

ADR-0028 made a join or split a rule for its form in every document of the language. Making one
rewrote every document holding the form in one transaction. On the phone (the 2026-11-04 library,
36 MB, a test copy of the native app), splitting 他们 took 22.9 s and wrote 8.7 MB, and a tap made
just before it waited 18 s behind it. The reader asked for a join or split to be instant, and to
apply only to the document they are reading.

Decided:

- **A correction holds in its own document**, at every occurrence of its form there, and nowhere
  else. `rulesInForce(history, language, documentId)` folds only the corrections whose occurrence
  names that document. The rule's shape, its order, undo and runs of words only stay as in
  ADR-0028. A correction now always names its document; one without a document holds nowhere
  (none existed).
- **Existing corrections are read the same way.** Every one of them (158 on 2026-11-04) recorded
  the document it was made in, so each now holds only there. Other documents go back to the
  analyzer's split for those forms. That changes derived tokens and the memory recomputed from them;
  no earned row changes.
- **The catch-up is done in steps.** `reapplyCorrections(from, budgetMs)` checks documents in id
  order, rewrites each that differs in its own transaction, and returns where to continue; the app
  calls it in 150 ms steps after opening. The first opening after this change rewrites most
  documents once.
- Diagnostics lists corrections per document, and Undo there takes it back in that document.

Rejected: keeping the existing corrections library-wide and scoping only new ones. Nothing a reader
has read would change, but two kinds of correction would live side by side. Also rejected: a rule
for the tapped occurrence only. The same form would then divide differently within one text.
