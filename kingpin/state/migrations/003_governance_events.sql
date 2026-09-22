CREATE TABLE governance_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  request_id TEXT NOT NULL,
  record TEXT NOT NULL CHECK(json_valid(record))
) STRICT;
CREATE INDEX governance_events_request ON governance_events(request_id, sequence);
CREATE TRIGGER immutable_governance_event BEFORE UPDATE ON governance_events
BEGIN SELECT RAISE(ABORT, 'audit events are append-only'); END;
CREATE TRIGGER permanent_governance_event BEFORE DELETE ON governance_events
BEGIN SELECT RAISE(ABORT, 'audit events are append-only'); END;
PRAGMA user_version = 3;
