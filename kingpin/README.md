# Kingpin limited standalone SDK

This is the repository landing page for **kingpin-runtime@0.1.0-rc.1**,
a qualified limited prerelease candidate. Registry publication is a separate step;
this page does not assert that the version or `next` tag is already available.

## Install the prerelease

Once published to the public npm registry, use the exact qualified version:

```sh
npm install --save-exact kingpin-runtime@0.1.0-rc.1
```

To follow the proposed moving prerelease tag instead:

```sh
npm install kingpin-runtime@next
```

`next` can move to another prerelease; use the exact version for reproducibility.
Unqualified `npm install kingpin-runtime` is not the recommended prerelease command.
Until publication, install the supplied sealed tarball with
`npm install --offline --ignore-scripts --no-audit --no-fund /absolute/path/kingpin-runtime-0.1.0-rc.1.tgz`.

Use Node.js **24.14.1 on macOS / Darwin arm64**, the qualified environment.
In a fresh consumer directory after installation:

```sh
cp node_modules/kingpin-runtime/SDK_EXAMPLE.mjs ./SDK_EXAMPLE.mjs
node SDK_EXAMPLE.mjs
```

The example generates ephemeral authentication tokens and creates `example.sqlite`
exclusively. Use a fresh directory for each run. It exercises both stores, synthetic
compatible input, HUMAN REVIEW, leases/revocation and reopen. It executes no tool.

## Supported scope

Supported interfaces are the documented authority APIs, policy loading/validation,
authentication, leases/revocation, HUMAN REVIEW, execution-accounting storage and
transitions, and synchronous lifecycle through the built-in stores.

The initial limited SDK release supports the built-in MemoryStateStore and SQLiteStateStore. Custom store injection remains available as an advanced trusted-host extension mechanism. Independently implemented stores have not been qualified and are outside this release’s support and compatibility guarantee. Constructor acceptance does not establish store conformance.

The public import paths remain `kingpin-runtime`, `kingpin-runtime/state/sqlite`,
and `kingpin-runtime/auth`. See the exact export and method inventory in the
[current SDK contract](SDK_CONTRACT.md).

## Consumer documentation

New to the SDK? Use **[Set up Kingpin with an AI assistant](../docs/kingpin/AI_ASSISTANT_SETUP.md)**
for a model-agnostic, contract-bound local demonstration and a copyable setup prompt.

- [SDK contract, compatibility policy and trust boundary](SDK_CONTRACT.md)
- [Current observed error reference](SDK_ERRORS.md)
- [SQLite close, rollback and reopen behavior](SDK_LIFECYCLE_REPAIR.md)
- [Runnable public-import example](SDK_EXAMPLE.mjs)
- [License](LICENSE) and [source attribution](NOTICE.md)
- [Draft prerelease notes](../docs/kingpin/PRERELEASE_0.1.0-rc.1.md)
- [Sealed artifact and repository source relationship](../docs/kingpin/RC_SOURCE.md)

SQLite uses Node's built-in `node:sqlite` DatabaseSync; the qualification runtime
reported SQLite **3.51.2**. Qualification installed local tarballs in unrelated
consumer directories. `engines: >=24` does not qualify every Node >=24 environment.
Linux, Windows, x64, other Node versions, network filesystems and broader
crash/power-loss recovery are unverified.

Authority is not execution. Approval is not authorization. Execution records are
accounting facts, not proof of external effects. Lease validation is point-in-time
authorization evidence, not irrevocable permission. The host establishes trusted
identity and selects signals/evaluation IDs. Synthetic inputs do not prove live
CDE or hosted-model behavior.

No initial guarantee covers independently implemented stores, hosted-model
behavior, production deployment security, distributed exactly-once execution,
cancellation, external-effect rollback, hostile same-user process isolation,
a general error-code taxonomy, or arbitrary future upgrade compatibility.

## Artifact status and licensing

SHA-256 of the sealed RC tarball:
`5bccfc39e61a89050472f30a379bcef4a314d2df022bc401d14ed2bf0cb26bea`.

The repository README provides public-registry guidance without changing the sealed
artifact. Preparation/status wording inside that artifact records its qualification
stage; it does not describe current registry availability. The contract, example,
error reference, lifecycle guide, license and runtime here match the sealed RC.
Historical qualification records remain unchanged.

License: **CC BY-NC 4.0**. This is not unrestricted commercial software or a claim
of permissive open-source licensing. This limited prerelease is not a production-
readiness certification.
