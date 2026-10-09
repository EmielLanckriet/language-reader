-- The catch-up at start (issue #1).
--
-- `catch_up` is DERIVED: for each pass, the state of what it reads when it last found nothing left
-- to do. A pass whose fingerprint still matches is skipped; a missing row only means it runs again.

CREATE TABLE catch_up (
  name        TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL
);
