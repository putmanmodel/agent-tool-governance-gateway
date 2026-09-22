CREATE TABLE executions (
  execution_id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL UNIQUE,
  review_id TEXT UNIQUE REFERENCES reviews(review_id),
  resource_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('started','succeeded','failed','unknown','reconciled_succeeded','reconciled_failed','reconciliation_required')),
  record TEXT NOT NULL CHECK(json_valid(record))
) STRICT;
CREATE UNIQUE INDEX unresolved_execution_resource ON executions(resource_hash)
  WHERE status IN ('started','unknown','reconciliation_required');
CREATE TRIGGER permanent_execution BEFORE DELETE ON executions
BEGIN SELECT RAISE(ABORT, 'execution history is permanent'); END;
CREATE TRIGGER immutable_execution_identity BEFORE UPDATE ON executions
WHEN NEW.execution_id != OLD.execution_id OR NEW.decision_id != OLD.decision_id
  OR NEW.review_id IS NOT OLD.review_id OR NEW.resource_hash != OLD.resource_hash
BEGIN SELECT RAISE(ABORT, 'execution identity is immutable'); END;
CREATE TRIGGER guarded_execution_transition BEFORE UPDATE ON executions
WHEN NOT ((OLD.status = 'started' AND NEW.status IN ('succeeded','failed','unknown'))
  OR (OLD.status IN ('unknown','reconciliation_required') AND NEW.status IN ('reconciled_succeeded','reconciled_failed','reconciliation_required')))
BEGIN SELECT RAISE(ABORT, 'execution transition not permitted'); END;
PRAGMA user_version = 5;
