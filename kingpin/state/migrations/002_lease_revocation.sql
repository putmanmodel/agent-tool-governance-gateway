-- v0.4 authority addition. Applied only after validating the exact v1 store.
ALTER TABLE store_metadata ADD COLUMN lease_epoch INTEGER NOT NULL DEFAULT 0
  CHECK (lease_epoch BETWEEN 0 AND 9007199254740991);
ALTER TABLE leases ADD COLUMN nonce TEXT NOT NULL DEFAULT '';
ALTER TABLE leases ADD COLUMN issuance_epoch INTEGER NOT NULL DEFAULT 0
  CHECK (issuance_epoch BETWEEN 0 AND 9007199254740991);
-- Trusted deterministic host function: SHA-256 of the existing opaque token.
UPDATE leases SET nonce = kingpin_lease_nonce(token);
CREATE UNIQUE INDEX lease_nonce_identity ON leases(nonce);
CREATE TABLE lease_nonce_revocations (
  nonce TEXT PRIMARY KEY NOT NULL REFERENCES leases(nonce)
) STRICT;
CREATE TRIGGER immutable_lease_identity
BEFORE UPDATE OF token, nonce, issuance_epoch ON leases
BEGIN SELECT RAISE(ABORT, 'immutable lease identity and issuance epoch'); END;
CREATE TRIGGER monotonic_lease_epoch
BEFORE UPDATE OF lease_epoch ON store_metadata
WHEN NEW.lease_epoch != OLD.lease_epoch + 1
BEGIN SELECT RAISE(ABORT, 'lease epoch must advance exactly once'); END;
CREATE TRIGGER immutable_nonce_revocation
BEFORE UPDATE ON lease_nonce_revocations
BEGIN SELECT RAISE(ABORT, 'immutable nonce revocation'); END;
CREATE TRIGGER permanent_nonce_revocation
BEFORE DELETE ON lease_nonce_revocations
BEGIN SELECT RAISE(ABORT, 'permanent nonce revocation'); END;
PRAGMA user_version = 2;
