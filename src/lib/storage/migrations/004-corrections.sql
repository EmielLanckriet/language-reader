-- Segmentation corrections (spec 004, ADR-0028).
--
-- `correction_event` is EARNED and append-only, like status_event: the reader's judgment of how one
-- written form divides. `parts` is a JSON array of {surface, key}; NULL is an undo, leaving the form
-- to the analyzer again. It shares device.next_seq with the rest of the history.
--
-- `analyzed_token` is DERIVED: the analyzer's own output, which `token` used to be. `token` is now
-- that output with the corrections in force applied, so everything reading `token` is unchanged,
-- and a correction can be made or undone without running the analyzer again (FR-011).

CREATE TABLE correction_event (
  id          INTEGER PRIMARY KEY,
  language    TEXT NOT NULL,
  form        TEXT NOT NULL,
  parts       TEXT,
  made_at     TEXT NOT NULL,
  device_id   TEXT NOT NULL REFERENCES device (id),
  device_seq  INTEGER NOT NULL,
  document_id INTEGER REFERENCES document (id),
  from_offset INTEGER,
  to_offset   INTEGER,
  user_id     INTEGER NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX correction_event_device_seq ON correction_event (device_id, device_seq);

CREATE TABLE analyzed_token (
  document_id INTEGER NOT NULL REFERENCES document (id) ON DELETE CASCADE,
  start       INTEGER NOT NULL,
  end         INTEGER NOT NULL,
  is_word     INTEGER NOT NULL,
  lexeme_key  TEXT,
  PRIMARY KEY (document_id, start),
  CHECK (start < end),
  CHECK (is_word IN (0, 1)),
  CHECK ((is_word = 1) = (lexeme_key IS NOT NULL))
);

-- No correction exists yet, so every stored token is the analyzer's own. A lexeme's surface is the
-- key it was found under (Repository.findOrCreateLexeme).
INSERT INTO analyzed_token (document_id, start, end, is_word, lexeme_key)
  SELECT t.document_id, t.start, t.end, t.is_word, l.surface
    FROM token t LEFT JOIN lexeme l ON l.id = t.lexeme_id;
