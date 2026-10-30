# Draft prerelease notes — kingpin-runtime 0.1.0-rc.1

**Draft only: not a published GitHub release or an announcement.** Registry
availability and the `next` tag must be verified independently after an authorized
publication. Proposed candidate/tag identity: `kingpin-sdk-v0.1.0-rc.1`.

## Install after publication

Exact version (recommended):

```sh
npm install --save-exact kingpin-runtime@0.1.0-rc.1
```

Moving prerelease channel:

```sh
npm install kingpin-runtime@next
```

These commands describe intended public-registry installation, not proof that
publication has occurred. Keep `next` separate from stable/latest positioning.

## Supported scope

The installed standalone package supports documented authority APIs,
MemoryStateStore and SQLiteStateStore, policy loading/validation, authentication,
leases/revocation, HUMAN REVIEW, execution-accounting storage/transitions, and
synchronous lifecycle. No exports are added beyond the three documented entry
points. Execution accounting does not execute tools or prove effects.

The initial limited SDK release supports the built-in MemoryStateStore and SQLiteStateStore. Custom store injection remains available as an advanced trusted-host extension mechanism. Independently implemented stores have not been qualified and are outside this release’s support and compatibility guarantee. Constructor acceptance does not establish store conformance.

Qualified environment: Node.js 24.14.1, macOS/Darwin arm64, built-in node:sqlite
DatabaseSync with SQLite 3.51.2, local tarball installation into unrelated consumers.
The package engine range is not a broader environment qualification.

## Lifecycle and trust

Public SQLite close during an active transaction rejects with
`Invalid governance state: transaction active` and leaves the connection open.
Uncaught rejection rolls back; caught rejection permits normal continuation.
Successful close is terminal; reopening requires a new SQLiteStateStore.

Authority is not execution; approval is not authorization. Lease validation is
point-in-time evidence, not irrevocable permission. The host establishes trusted
identity. The example's governance signals are explicitly synthetic compatible
inputs, not proof of live CDE or hosted-model behavior.

## Limits and compatibility

Linux, Windows, x64, other Node versions, network filesystems and broader
crash/power-loss recovery are unverified. No initial guarantee covers custom-store
implementations, hosted-model behavior, production deployment security, distributed
exactly-once execution, cancellation, external-effect rollback, hostile same-user
isolation, a general error-code taxonomy or arbitrary future upgrade compatibility.

Candidates are immutable. Supported imports and documented semantics define the
compatibility surface. Intentional incompatible changes during 0.x require a new
minor line and migration information. Package, payload, policy, audit,
review/execution and SQLite schema versions are separate domains.

## Try the example

In a fresh consumer directory after installation:

```sh
cp node_modules/kingpin-runtime/SDK_EXAMPLE.mjs ./SDK_EXAMPLE.mjs
node SDK_EXAMPLE.mjs
```

It generates ephemeral tokens and creates example.sqlite exclusively. Assertions
cover both stores, review consumption, revocation and reopen. No tool executes.

## Artifact and qualification

Tarball: `kingpin-runtime-0.1.0-rc.1.tgz`.
SHA-256:
`5bccfc39e61a89050472f30a379bcef4a314d2df022bc401d14ed2bf0cb26bea`.

426 observations match repaired expectations: 424 original observations unchanged
and exactly two previously approved SQLite differences. All 15 lifecycle assertions
pass, as do both fresh consumers and the example. Repository Node: 231; Python/CDE:
28; Harness: 322; typecheck and bounded smoke pass. Smoke's unsupported cases are
not passes. Heavyweight external-runtime evidence is inherited by verified runtime
identity, not represented as newly executed. No runtime change accompanies this
repository documentation alignment.

## License and references

**CC BY-NC 4.0**, matching the repository license; no relicensing. This is not
unrestricted commercial software or a production-readiness certification.

- [SDK landing page](../../kingpin/README.md)
- [Current contract](../../kingpin/SDK_CONTRACT.md)
- [Lifecycle](../../kingpin/SDK_LIFECYCLE_REPAIR.md)
- [License](../../kingpin/LICENSE) and [attribution](../../kingpin/NOTICE.md)
- [Artifact manifest and source relationship](RC_SOURCE.md)

Before later announcement, verify anonymous registry installation and tarball digest,
inspect npm and GitHub rendering/links, confirm the intended dist-tag, and replace
this draft's publication-status wording in the release presentation. Do not edit
or replace the sealed artifact.
