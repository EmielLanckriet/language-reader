-- Word status (spec 019, ADR-0044): retired, active or ignored, apart from memory.
--
-- `status_change` is EARNED and append-only: who or what changed a word's status, when and why.
-- `word_status` is DERIVED: the latest change per word, rebuilt from the log. A word without a row
-- is retired.

CREATE TABLE status_change (
  id         INTEGER PRIMARY KEY,
  lexeme_id  INTEGER NOT NULL REFERENCES lexeme (id),
  -- Free text, validated on write (status.ts), as for marks: a new status is data, not a migration.
  status     TEXT NOT NULL,
  -- reader / stable / first-review / carried-over.
  cause      TEXT NOT NULL,
  -- Device wall-clock, for display. The device position below is what orders the log.
  changed_at TEXT NOT NULL,
  device_id  TEXT NOT NULL REFERENCES device (id),
  device_seq INTEGER NOT NULL,
  user_id    INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX status_change_lexeme ON status_change (lexeme_id);

CREATE TABLE word_status (
  lexeme_id INTEGER PRIMARY KEY REFERENCES lexeme (id),
  status    TEXT NOT NULL
);
