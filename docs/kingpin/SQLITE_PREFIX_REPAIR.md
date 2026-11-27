# SQLite literal internal-prefix repair — unpublished

Baseline: authoritative repository `putmanmodel/agent-tool-governance-gateway`,
tag `v0.1.0-rc.4`, commit `eb323c17938c828372bef5faad82e1343efad911`.
All 31 installed published runtime files matched `kingpin/` at that commit
byte-for-byte, including package metadata, documentation, JS, SQL and license.
The original workspace HEAD was rc.3; this repair uses an isolated rc.4 worktree
on `codex/sqlite-literal-prefix-repair`. No installed package was edited.

The package version remains 0.1.0-rc.4 by instruction. This modified source is an
UNRELEASED REPAIR, not the immutable published rc.4 artifact. No package was built
or published, no tag moved, and no version or license changed.

## Defect and correction

`kingpin/state/sqlite.js:16` excluded names using `NOT LIKE 'sqlite_%'`.
In LIKE, underscore matches any one character. Consequently an extra object such
as `sqliteXunexpected` disappeared from both the schema comparison query and its
observed results. Reopening could accept that unexpected schema object.

The one-line production correction uses `NOT GLOB 'sqlite_*'`: underscore is
literal and star matches the suffix. Real SQLite internal objects use the literal
lowercase `sqlite_` prefix. GLOB is case-sensitive; lookalike application names
are no longer excluded merely because they match LIKE's wildcard/case behavior.

There is one occurrence in the authoritative source. That shared query builds
expected schemas 1–5 and verifies them on opening/migration and at transaction
entry. The correction therefore covers all those paths. No additional runtime
schema-filter occurrence was found. This demonstrates a schema-validation gap;
no additional authorization bypass or audit tampering result is asserted.

## Focused coverage and qualification

New tests: `gateway_node/sqlite_schema_prefix.test.js` (21 cases).

- All schema versions 1–5 migrate/reopen successfully.
- All five reject the extra literal-prefix impostor before migration commits.
- Unexpected tables, indexes, views and triggers reject, for both ordinary names
  and `sqliteXunexpected` names.
- Transaction validation rejects an impostor added after store construction.
- Genuine sqlite_sequence, sqlite_autoindex_* and ANALYZE-created sqlite_stat1
  remain accepted; existing governance events and a succeeded execution record
  survive reopen unchanged.
- Missing files are not created and unsupported versions remain rejected.

With the identical final regression file, unchanged rc.4: **11 passed, 10 failed**
(all 10 are the expected impostor-rejection assertions). Repaired source:
**21 passed, 0 failed**. Initial test-fixture setup required registering the existing
migration's kingpin_lease_nonce function; the reported before/after runs both use
that corrected fixture and identical assertions.

Full gateway/runtime/governance Node suite: **256 passed, 0 failed, 0 skipped,
0 cancelled**. Python unittest suite: **28 passed, 0 failures**. Node 24.14.1,
local macOS arm64 environment. An initial sandbox run was 254/256 because two
HTTP-ingress tests could not bind 127.0.0.1 (EPERM); the complete suite passed when
rerun with local-listener permission. No test assertion was weakened.

Commands, from the repair worktree:

```sh
node --test gateway_node/sqlite_schema_prefix.test.js
CDE_PYTHON=/Users/stephenaputmanjr/Desktop/agent-tool-governance-gateway/.venv-task/bin/python npm --prefix gateway_node test
CDE_PYTHON=/Users/stephenaputmanjr/Desktop/agent-tool-governance-gateway/.venv-task/bin/python /Users/stephenaputmanjr/Desktop/agent-tool-governance-gateway/.venv-task/bin/python -m unittest discover -s tests -v
```

Tests used isolated temporary databases. Node tests reused the existing gateway
node_modules through a temporary link, removed after testing; no dependency files
changed. For reproduction, restore the baseline's locked gateway dependencies.
`git diff --check` passed. Local retained logs and the 31-file SHA-256 baseline
manifest are under `qualification/sqlite-prefix-repair/` (not package contents).

## Compatibility and release recommendation

No public API, schema version, migration SQL, record format, decision, lease,
revocation or review semantics changed. Valid databases retain their contents.
Databases containing formerly ignored application-defined objects will now fail
closed. This is intentional enforcement of the existing exact-schema contract.
Do not automatically delete such objects: inspect and remediate through a separate
owner-approved procedure. Normal supported migrations remain tested.

A new runtime release candidate is justified for this correctness repair, after
separate approval for versioning, artifact qualification and publication. The old
archive must stay immutable. This assignment does not authorize that release.

Downstream, after a newly qualified version exists and upgrades are approved:

- kingpin-tasks: update the exact runtime pin and lock integrity; rerun foundation,
  governance-state and restart tests. The currently inspected application-storage
  query already uses NOT GLOB 'sqlite_*'; no application-source change was made
  or is prescribed for that query. Its rc.4 dependency still needs a later upgrade.
- kingpin-governed-mcp: keep published 0.1.0 unchanged. For a separately approved
  successor, update runtime pin/shrinkwrap and requalify checkout, installed archive,
  dependency resolution and registry installation. Its present MemoryStateStore
  path does not exercise this SQLite defect; no MCP tool behavior change is required.

No downstream application, published archive, npm dist-tag, license, or BoxLite
component was modified. No additional defect was established requiring expansion
of this repair. Broader crash/power-loss, privileged-file-tamper and cross-platform
claims remain outside this qualification.

## R1 integration verification — 2026-11-26

Integration branch: `codex/sqlite-prefix-repair-integration`. Target: `main` in
`putmanmodel/agent-tool-governance-gateway`, verified live on GitHub at
`eb323c17938c828372bef5faad82e1343efad911`, exactly the reviewed `v0.1.0-rc.4`
baseline. The local primary checkout remains on its older rc.3 `main`; it was
not reset or updated. The older `kingpin-integration` branch is an ancestor of
`main`, so the current runtime development target is `main`.

The production file and 21-case regression file were copied byte-for-byte from
the retained `codex/sqlite-literal-prefix-repair` worktree. The report above is
preserved verbatim; this section records the new integration verification. All
31 SHA-256 entries in the retained published-source correspondence manifest
match the baseline Git contents. This is verification of the retained manifest,
not a new registry or installed-artifact qualification. The original repair
worktree, report and historical qualification logs remain unchanged.

Fresh runs on the integration branch, using the commands above:

- Focused schema-prefix regressions: 21 passed; zero failures or skips.
- Full gateway/runtime/governance Node suite: 256 passed; zero failures, skips
  or cancellations. Local-listener permission enabled the HTTP-ingress tests.
- Python unittest suite: 28 passed; zero failures.
- Node 24.14.1 on macOS arm64. Existing gateway dependencies were temporarily
  linked for testing after checking the lockfile against the dependency
  checkout; the link was removed afterward.

Compatibility checks cover schema versions 1–5, populated migration and rollback
fixtures, real `sqlite_sequence`, `sqlite_autoindex_*` and `sqlite_stat1` objects,
and unchanged governance events and execution records on reopen. Existing
review/execution invariant checks remain intact. Application-defined lookalike
objects now fail exact-schema validation, including at transaction entry.

Final scope is three files: the one-line production correction, the regression
file and this document. No migration SQL, package metadata, version, license,
public API or published artifact changed. No downstream work or release
preparation was performed. Review and merge are separate decisions.

Fresh logs and the preservation hash snapshot are retained locally beside the
integration worktree in `qualification/runtime-sqlite-prefix-integration-evidence/`;
they are not included in the runtime package or this PR.
