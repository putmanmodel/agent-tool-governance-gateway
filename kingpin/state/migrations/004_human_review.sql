CREATE TABLE reviews (
  review_id TEXT PRIMARY KEY,
  context_key TEXT NOT NULL,
  evaluation_id TEXT NOT NULL,
  decision_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('pending','approved','denied','invalidated','consumed')),
  record TEXT NOT NULL CHECK(json_valid(record)),
  UNIQUE(context_key, evaluation_id),
  FOREIGN KEY(context_key, evaluation_id) REFERENCES consumed_evaluations(context_key, evaluation_id)
) STRICT;
CREATE TRIGGER permanent_review BEFORE DELETE ON reviews
BEGIN SELECT RAISE(ABORT, 'review history is permanent'); END;
CREATE TRIGGER immutable_review_identity BEFORE UPDATE ON reviews
WHEN NEW.review_id != OLD.review_id OR NEW.context_key != OLD.context_key
  OR NEW.evaluation_id != OLD.evaluation_id OR NEW.decision_id != OLD.decision_id
BEGIN SELECT RAISE(ABORT, 'review identity is immutable'); END;
CREATE TRIGGER guarded_review_transition BEFORE UPDATE ON reviews
WHEN NOT ((OLD.status = 'pending' AND NEW.status IN ('approved','denied','invalidated'))
  OR (OLD.status = 'approved' AND NEW.status IN ('consumed','invalidated')))
BEGIN SELECT RAISE(ABORT, 'review transition not permitted'); END;
PRAGMA user_version = 4;
