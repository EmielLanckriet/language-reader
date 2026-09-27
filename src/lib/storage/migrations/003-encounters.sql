-- Encounters, and memory derived from them (spec 007, ADR-0027).
--
-- `session` and `encounter` are EARNED and append-only, like status_event: no code path updates or
-- deletes a row. `encounter.kind` is free text and `detail` is JSON, so a new kind of encounter is
-- data rather than a migration. They share device.next_seq with status_event, which gives one order
-- over the whole history of a device.
--
-- `memory` is DERIVED: a cache of the evidence rule folded over the history, rebuilt at will.

CREATE TABLE session (
  id          INTEGER PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES document (id),
  -- 'reading' (a text) or 'media'. Free text.
  modality    TEXT NOT NULL,
  started_at  TEXT NOT NULL,
  device_id   TEXT NOT NULL REFERENCES device (id),
  device_seq  INTEGER NOT NULL,
  user_id     INTEGER NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX session_device_seq ON session (device_id, device_seq);

CREATE TABLE encounter (
  id           INTEGER PRIMARY KEY,
  -- Null only for a review made outside any session.
  session_id   INTEGER REFERENCES session (id),
  kind         TEXT NOT NULL,
  -- The word as it was when it happened: lookups, checks and reviews. Ranges have none; the words
  -- they covered are the document's current tokens between the offsets.
  lexeme_id    INTEGER REFERENCES lexeme (id),
  document_id  INTEGER REFERENCES document (id),
  from_offset  INTEGER,
  to_offset    INTEGER,
  media_ms     INTEGER,
  speed        REAL,
  text_visible INTEGER,
  detail       TEXT NOT NULL DEFAULT '{}',
  at           TEXT NOT NULL,
  device_id    TEXT NOT NULL REFERENCES device (id),
  device_seq   INTEGER NOT NULL,
  user_id      INTEGER NOT NULL DEFAULT 1,
  CHECK (text_visible IS NULL OR text_visible IN (0, 1))
);

CREATE UNIQUE INDEX encounter_device_seq ON encounter (device_id, device_seq);
CREATE INDEX encounter_session ON encounter (session_id);
CREATE INDEX encounter_lexeme ON encounter (lexeme_id);
CREATE INDEX encounter_document ON encounter (document_id, from_offset);
-- The latest Anki parameters, and a session's attention answer, are found by kind.
CREATE INDEX encounter_kind ON encounter (kind, device_id, device_seq);

CREATE TABLE memory (
  lexeme_id  INTEGER NOT NULL REFERENCES lexeme (id),
  skill      TEXT NOT NULL,
  stability  REAL NOT NULL,
  difficulty REAL NOT NULL,
  state      INTEGER NOT NULL,
  last_at    TEXT NOT NULL,
  due        TEXT NOT NULL,
  reps       INTEGER NOT NULL,
  lapses     INTEGER NOT NULL,
  card       INTEGER NOT NULL,
  reviewed   INTEGER NOT NULL,
  seeded     TEXT,
  -- Which evidence rule produced the row; rows of an older rule are recomputed in the background.
  rule       TEXT NOT NULL,
  PRIMARY KEY (lexeme_id, skill)
);

-- A word's memory is recomputed from the stretches covering its tokens, found by word: without this
-- every recompute scanned every token (measured 2026-09-27: a 20,000-encounter history took minutes).
CREATE INDEX token_lexeme ON token (lexeme_id);

-- Hidden from the library, media gone, text and tokens kept: encounters still point into it.
ALTER TABLE document ADD COLUMN removed_at TEXT;
