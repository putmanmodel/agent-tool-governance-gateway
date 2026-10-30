# Repository source and sealed RC

The sealed artifact is `kingpin-runtime@0.1.0-rc.1`:
`kingpin-runtime-0.1.0-rc.1.tgz`.

SHA-256:
`5bccfc39e61a89050472f30a379bcef4a314d2df022bc401d14ed2bf0cb26bea`.

[RC_ARTIFACT.json](RC_ARTIFACT.json) records the original npm integrity and complete
30-file content manifest. It is copied from the qualified artifact identity, not
produced by repacking the repository.

Every sealed package file except README.md matches this repository's kingpin/
source byte-for-byte, including package metadata, runtime JS, policy resources,
SQL, contract, error reference, example, lifecycle documentation and license.
The repository [README](../../kingpin/README.md) intentionally supplies registry
installation guidance and links to draft notes. This documentation exception does
not alter the sealed tarball or the original manifest.

The qualified runtime already included the standalone execution-record validator
and SQLite active-close repair. Committing those existing qualified bytes aligns
the public source with the RC; this alignment does not introduce another repair.
The repository execution/model.js remains a compatibility re-export.

The original build recorded HEAD 60317648a8e9fb5004903a3e11390c3180a97630 with
uncommitted qualified changes. Do not describe that old commit alone as containing
the complete RC. The source-alignment commit adds those files and public guidance;
it does not rewrite historical build provenance or imply a CI build attestation.

Historical qualification records and tarballs remain unchanged. Their verifier's
current-source comparison may report the intentional README difference; that is
not a changed artifact or historical seal. Use the recorded artifact digest and
per-file manifest for the sealed package, and account for the sole README exception
when comparing this public source snapshot. No new package should be inferred
from running npm pack on this repository snapshot.
