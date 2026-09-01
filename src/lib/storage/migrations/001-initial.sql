-- Slice 0's whole schema, per specs/001-reader-walking-skeleton/data-model.md.
--
-- Columns marked HEDGE support no capability a reader can see in this slice. They exist because
-- they hold earned data or are one-way doors (ADR-0003): adding them later would mean fabricating
-- history that was never recorded, or backfilling attribution by guess. Slice 0's data is
-- disposable, which lowers the stakes of getting the shape wrong — it does not license leaving
-- the shape out.

-- The thing a state attaches to.
CREATE TABLE lexeme (
  id       INTEGER PRIMARY KEY,
  language TEXT NOT NULL,
  -- The written form. An attribute of the lexeme, never its identity (FR-008).
  surface  TEXT NOT NULL
);

-- Unique for slice 0 only. This encodes the Chinese provider's *current* identity rule, not a
-- property of the schema. When Dutch arrives with lemma-based identity, or heteronyms are split,
-- the rule changes and this constraint goes with it (FR-009).
CREATE UNIQUE INDEX lexeme_language_surface ON lexeme (language, surface);

CREATE TABLE document (
  id               INTEGER PRIMARY KEY,
  -- Verbatim and unmodified (FR-002). Everything derived is rebuilt from this.
  raw_content      TEXT NOT NULL,
  -- HEDGE. 'text/plain' here; HTML and subtitles later without touching stored rows.
  content_type     TEXT NOT NULL,
  language         TEXT NOT NULL,
  -- HEDGE. Together these identify what produced the tokens, which is what makes swapping in a
  -- real segmenter a deliberate recompute rather than an untraceable change (FR-003).
  analyzer         TEXT NOT NULL,
  analyzer_version TEXT NOT NULL,
  -- Derived from the opening characters. Not earned; recompute it freely.
  title            TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  -- HEDGE. One local reader for now (FR-013).
  user_id          INTEGER NOT NULL DEFAULT 1
);

-- Derived data: discardable, and rebuildable from document.raw_content.
CREATE TABLE token (
  id          INTEGER PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES document (id) ON DELETE CASCADE,
  -- Null exactly for non-word tokens: punctuation, whitespace, Latin runs.
  lexeme_id   INTEGER REFERENCES lexeme (id),
  -- Code-point offsets into raw_content, never token indices (FR-014).
  start       INTEGER NOT NULL,
  end         INTEGER NOT NULL,
  is_word     INTEGER NOT NULL,
  CHECK (start < end),
  CHECK (is_word IN (0, 1)),
  -- A word token must resolve to a lexeme; a non-word token must not pretend to.
  CHECK ((is_word = 1) = (lexeme_id IS NOT NULL))
);

CREATE INDEX token_document ON token (document_id, start);

-- The reader's current judgment: a CACHE of a fold over status_event, not a source of truth
-- (FR-010a, FR-011). It may be rebuilt from the history at any time, and a test asserts that
-- doing so changes nothing.
--
-- A row exists only where a judgment was made (FR-006b). Words merely displayed cost nothing.
CREATE TABLE word_state (
  lexeme_id  INTEGER PRIMARY KEY REFERENCES lexeme (id),
  -- Free text, not an enum: adding a state is data, not a migration (FR-006a).
  state      TEXT NOT NULL,
  -- HEDGE. NOT NULL *without* a default, deliberately. A default would let a caller that forgot
  -- provenance write a plausible-looking lie; this way the insert fails (FR-012).
  provenance TEXT NOT NULL,
  user_id    INTEGER NOT NULL DEFAULT 1
);

-- The history. Append-only: never updated, never deleted (FR-010).
CREATE TABLE status_event (
  id                     INTEGER PRIMARY KEY,
  lexeme_id              INTEGER NOT NULL REFERENCES lexeme (id),
  -- What the reader ASSERTED, not what the state became (FR-010a).
  asserted               TEXT NOT NULL,
  -- Device wall-clock. For display and for later cross-device ordering; not what orders the log.
  asserted_at            TEXT NOT NULL,
  -- HEDGE. Which device recorded this, and its position in that device's sequence. This pair is
  -- what orders the log: exact within a device, and immune to clock drift, adjustment and time
  -- zones. Neither can be reconstructed after the fact, which is why both exist before there is
  -- a second device to need them (FR-010c).
  device_id              TEXT NOT NULL REFERENCES device (id),
  device_seq             INTEGER NOT NULL,
  -- HEDGE. What the reader was looking at. Nullable on purpose: there is not always an occurrence
  -- to record. These retain the evidence a future sense discriminator would need, since
  -- same-reading homographs are told apart by context and nothing else.
  document_id            INTEGER REFERENCES document (id),
  from_offset            INTEGER,
  to_offset              INTEGER,
  observed_pronunciation TEXT,
  -- HEDGE. Recorded per entry, not only on the projection, so the history stays self-contained.
  provenance             TEXT NOT NULL,
  user_id                INTEGER NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX status_event_device_seq ON status_event (device_id, device_seq);
CREATE INDEX status_event_lexeme ON status_event (lexeme_id);

-- This installation. One row.
CREATE TABLE device (
  id       TEXT PRIMARY KEY,
  next_seq INTEGER NOT NULL
);

-- On-device failure record (FR-021). With no server there are no server logs, and Android offers
-- no convenient console, so this carries the whole burden.
CREATE TABLE diagnostic (
  id     INTEGER PRIMARY KEY,
  at     TEXT NOT NULL,
  kind   TEXT NOT NULL,
  detail TEXT NOT NULL
);
