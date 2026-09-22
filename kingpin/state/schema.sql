CREATE TABLE store_metadata (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  policy_fingerprint TEXT
) STRICT;
INSERT INTO store_metadata(singleton, policy_fingerprint) VALUES (1, NULL);
CREATE TABLE contexts (
  context_key TEXT PRIMARY KEY NOT NULL,
  level INTEGER NOT NULL CHECK (level BETWEEN 0 AND 3),
  clean INTEGER NOT NULL CHECK (clean IN (0, 1) AND (level != 0 OR clean = 0)),
  revision INTEGER NOT NULL CHECK (revision >= 0)
) STRICT;
CREATE TABLE consumed_evaluations (
  context_key TEXT NOT NULL REFERENCES contexts(context_key),
  evaluation_id TEXT NOT NULL CHECK (length(trim(evaluation_id)) > 0),
  PRIMARY KEY (context_key, evaluation_id)
) STRICT;
CREATE TABLE capability_revocations (
  context_key TEXT NOT NULL REFERENCES contexts(context_key),
  tool TEXT NOT NULL CHECK (length(trim(tool)) > 0),
  PRIMARY KEY (context_key, tool)
) STRICT;
CREATE TABLE leases (
  token TEXT PRIMARY KEY NOT NULL,
  context_key TEXT NOT NULL REFERENCES contexts(context_key),
  tool TEXT NOT NULL CHECK (length(trim(tool)) > 0),
  args TEXT NOT NULL,
  expires_at_ms REAL NOT NULL,
  revoked TEXT CHECK (revoked IS NULL OR revoked IN ('EXPLICIT_REVOCATION', 'CAPABILITY_REVOKED', 'ENVELOPE_CONTRACTED'))
) STRICT;
PRAGMA user_version = 1;
