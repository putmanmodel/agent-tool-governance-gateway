# Evaluator packaging completion report

Implemented on `v0.4-product`, runtime identity `0.4.0-dev`. No Kingpin authority,
lease, review, recovery, CDE computation, policy or Paper 9 rule was changed.
SQLite remains schema 4. No new schema migration is needed for packaging.

## Structure and entry points

- `config/evaluation.example/{runtime,auth,policy}.json`: exact runtime settings,
  nonworking credential placeholders and the existing default policy.
- `evaluation/configure.mjs`: explicit local configuration/credential generation;
  refuses overwrite and prints no credentials.
- `evaluation/config.js`: strict settings, dependency/config/sandbox validation,
  explicit SQLite create/reopen and safe build identity.
- `evaluation/start.mjs`: one evaluator startup command, private CDE child, gateway,
  safe startup identity, orderly shutdown.
- `evaluation/cde.js`, `evaluation/cde_worker.py`: private stateful stdio transport
  around unchanged CDE engine/response functions; no public CDE service port.
- `evaluation/sandbox.js`: synchronous replaceable flat-directory read/write/delete
  adapter; no authority handle, policy inference, shell or network operations.
- `evaluation/client.mjs`: real authenticated operator walkthrough and continuity
  mode; agent/admin/reviewer roles kept separate for each request.
- `evaluation/smoke.mjs`: temporary real HTTP startup/client/restart validation.
- `evaluation/{README,SECURITY,NOTICE,VALIDATION}.md`: quickstart, guarantees/limits,
  controlled-use notice and this report.
- `gateway_node/evaluation.test.js`: 14 focused evaluator tests.

Modified: gateway app factory/entrypoint and npm scripts; auth grants the admin a
read-only `audit.read` permission; root/gateway/auth/review docs link the package;
gitignore excludes generated local credentials/database/sandbox files.
Frozen schemas, fixtures, conformance producers and authority implementation are
unchanged. Existing demo startup output now explicitly identifies demo mode.

From repository root, after the quickstart's configuration generation:

```sh
npm --prefix gateway_node run evaluation -- ../config/evaluation.local/runtime.json --initialize
```

On restart omit `--initialize`. Missing databases are not recreated. Evaluation
configuration fixes mode to evaluation, selects trusted policy/auth/SQLite and
requires a private sandbox and loopback listener. Demo stays process-local memory
with simulated enforcement and its existing opt-in observation fixture.

`CDE_DEMO_FIXTURES=1` is rejected at evaluation startup; evaluation tool ingress
rejects `demo_fixture`, `governance_signal`, `force_gate`, `force_recovery` and
caller-supplied `evaluation_id`. Existing routes never provided reset-ID,
clear-revocation, arbitrary lease-minting or authority-state mutation overrides;
none were added. Host factories/injection remain trusted test/integration APIs.

`/tool` retains its existing wrapper behavior. Evaluation adds `/tool/observed`
for real agent utterances, allowing the natural low-confidence CDE path without
relying on the wrapper's demo fixture. It cannot inject a computed signal or gate;
all existing Kingpin requirements still apply. Request text is agent data, not
attested intent. No canonical conformance cases or normative IDs were added.

Status is authenticated and contains product, `0.4.0-dev`, storage schema 4,
policy version, evaluation mode and optional locally readable Git commit. Audit
inspection uses authenticated admin-only `GET /audit/:request_id`. Operational
payload logging is disabled in evaluation; required audit remains in SQLite.

## Adapter and enforcement

The gateway calls a replaceable synchronous `adapter.execute(request)` only after
Kingpin allow and required gateway audit commit. Initial review holds never call
it. Successful review consumption commits before execution; replay/changed bound
arguments cannot invoke it again. Default tool classes/floors remain server policy.

Only fs.read/fs.write/fs.delete with a single relative filename are implemented.
No nested directories, absolute paths, traversal, links, devices or shell. POSIX
O_NOFOLLOW plus descriptor metadata checks reject symlinks and hard links; the
root must be owned by the evaluator, mode 0700 and stable. Read/write content is
bounded to 64 KiB. Control/configuration files cannot reside inside the sandbox.
The root/ancestors and local host must remain trusted and free of concurrent
external mutation; this does not isolate against a hostile same-user process.

The example client demonstrates allowed write/read, denied deletion, issued
leases, nonce/epoch revocation, real HUMAN REVIEW, approval, denial, one-use
consumption and audit correlation. Continuity mode checks persisted audit, epoch
invalidation and consumed review after a real process restart.

## Validation results

| Check | Result |
| --- | --- |
| Complete Node suite | 182 passed, 0 failed/skipped/cancelled |
| Complete Python/schema suite | 17 passed |
| Paper 9 conformance | 11/11 passed |
| Frozen 32-event CDE baseline | Passed within Python suite |
| Frozen authority/default-policy/memory/SQLite oracles | Passed within Node suite |
| Authenticated frozen HTTP demo, demo mode | Passed all assertions |
| Standalone Python demo | Passed |
| Evaluator mode, real HTTP client, real CDE and sandbox | Passed |
| Evaluator stop/restart and continuity client | Passed |
| Sandbox integration and path/link rejection | Passed |
| Existing migration/restart/concurrent review/revocation suites | Passed |
| `git diff --check` | Passed |

The 14 added tests cover valid explicit create/reopen, missing auth/config,
invalid policy/mode, incompatible SQLite, demo controls/env refusal, preserved
demo fixture behavior, safe status, real CDE allow/deny/review, one-use bound
writes, changed arguments, revoked-lease side-effect refusal, successful leased
deletion, audit scope/correlation, traversal/absolute/nested paths, symlink and
hardlink rejection for all three operations, control-file isolation, placeholder
credentials and server-controlled classification. Real process startup and client
restart are additionally exercised by `evaluation:smoke` on loopback.

## Remaining integration work / limits

An evaluator can install, configure, start, run all bundled examples and inspect
state without reading source. The documented configuration, API and client cover
the bundled adapter. Implementing tools beyond the three filesystem operations
requires writing a trusted adapter using the documented synchronous interface;
there is no SDK, plugin loader or uploaded-code interface.

Filesystem effects and SQLite are not one transaction. Existing authorization
semantics remain unchanged: normal requests are not made one-use; reviewed ones
are at-most-once authorization, not guaranteed side-effect completion. A crash or
write failure can leave a consumed permission and missing/partial side effect.
Audit allowed events mean permission, not proof of completed execution.

No TLS, signing, anti-rollback/tamper guarantees, distributed coordination, remote
identity platform, MCP or broader production hardening was introduced. CDE's
in-memory observation history resets on process restart while Kingpin governance
persists. See SECURITY.md and NOTICE.md before connecting real data or tools.
