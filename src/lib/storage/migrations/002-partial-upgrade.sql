-- A document may be part-way through an upgrade to a better analyzer (ADR-0016).
--
-- The model costs about 4 s per 1,000 characters, so upgrading a document is not something that
-- finishes inside one foreground moment on a phone. Before this, an upgrade wrote once at the end
-- and an interruption discarded all of it; a document that never got one uninterrupted window
-- stayed on the dictionary forever, which is what the reader observed (research.md R20).
--
-- The invariant these three columns record, and the only thing that keeps every token honestly
-- stamped:
--
--   Tokens before `upgraded_through` came from `upgrade_analyzer` / `upgrade_version`.
--   Tokens from `upgraded_through` onward came from `analyzer` / `analyzer_version`.
--
-- `upgraded_through` is a character offset and always falls on a segmentation-unit boundary
-- (ADR-0013), so no token can straddle it and the invariant is decidable one token at a time.
--
-- When the boundary reaches the end of the document, the upgrade becomes the document's stamp and
-- these columns return to their defaults — in the same transaction as the final batch, so no state
-- exists in which a finished document still claims to be mid-upgrade.
--
-- Existing rows take the defaults, which say exactly the right thing about them: no upgrade in
-- progress, every token from the stamp.

ALTER TABLE document ADD COLUMN upgrade_analyzer TEXT;
ALTER TABLE document ADD COLUMN upgrade_version  TEXT;
ALTER TABLE document ADD COLUMN upgraded_through INTEGER NOT NULL DEFAULT 0;
