# Kingpin limited standalone SDK

This is the package landing page for the current limited standalone Kingpin prerelease,
distributed through the public npm registry. Use the exact version for reproducible
installation.

## Install the prerelease

Install the exact prerelease version:

```sh
npm install --save-exact kingpin-runtime@0.1.0-rc.3
```

To follow the moving prerelease tag instead:

```sh
npm install kingpin-runtime@next
```

`next` can move to another prerelease; use the exact version for reproducibility.
Unqualified `npm install kingpin-runtime` is not the recommended prerelease command;
npm dist-tags may move independently of an exact prerelease version.

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

New to the SDK? Use **[Set up Kingpin with an AI assistant](AI_ASSISTANT_SETUP.md)**
for a model-agnostic, contract-bound local demonstration and a copyable setup prompt.

- [SDK contract, compatibility policy and trust boundary](SDK_CONTRACT.md)
- [Current observed error reference](SDK_ERRORS.md)
- [SQLite close, rollback and reopen behavior](SDK_LIFECYCLE_REPAIR.md)
- [Runnable public-import example](SDK_EXAMPLE.mjs)
- [License](LICENSE) and [source attribution](NOTICE.md)
Release notes, qualification provenance and artifact/source mapping are maintained
in the public repository.

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

For release checksums and qualification provenance, see the corresponding GitHub
prerelease when published; they are not embedded inside the package being checksummed.

License: **CC BY-NC 4.0**. This is not unrestricted commercial software or a claim
of permissive open-source licensing. This limited prerelease is not a production-
readiness certification.
