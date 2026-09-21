# Evaluator authentication and principal separation

> Authentication determines who may invoke an operation. Kingpin still determines what authority exists.

This v0.4 boundary gates gateway calls before CDE evaluation, queueing or Kingpin
state access. It does not change gates, floors, lease scope, nonce/epoch
revocation, recovery or HUMAN REVIEW precedence. Existing authority payloads and
`schemas/v1` remain unchanged; authentication metadata belongs in HTTP headers.

## Credentials and principals

Set `KINGPIN_AUTH_FILE` to a server-controlled JSON file. The server refuses to
start without valid configuration. `example.json` contains **example-only tokens**;
copy it to a protected local file and replace every token before using it.

Each entry has a unique `principal_id`, one `role`, and an opaque `token`. Agent
entries additionally require an `agent_id` and explicit `allowed_contexts`.
Add additional entries to support more agents without editing source. Each
context specifies `session_id`, `channel_id`, and nullable `scene_id`/`task_id`.
There are no wildcard scopes. Protect the file with restrictive permissions
(for example `chmod 600`) and keep it out of source control.

Generate each token independently with Node:

```sh
node -e 'console.log(require("node:crypto").randomBytes(32).toString("base64url"))'
```

The format accepts 32–256 URL-safe token characters; use the generator rather
than memorable strings. Configuration rejects unknown roles, caller-specified
permissions, duplicate tokens/IDs, empty context lists and unexpected fields.
Tokens are accepted only as `Authorization: Bearer <token>`. A token, role or
principal ID in request JSON is never an authentication credential.

Comparison hashes candidates to fixed-size SHA-256 values, compares with
`timingSafeEqual`, and checks every configured entry. Resolved principals are
immutable `{ principal_id, role, permissions }` objects; agents also have their
trusted identity and context allowlist. The permission checker accepts only
principals issued by that resolver, not copied/request-created lookalikes.

Configuration is loaded once per application instance. To rotate credentials or
change grants, update the trusted file and restart; no hot-reload or identity
persistence service is added. Restarting with the same file gives the same grants.
Credentials are never inserted into SQLite governance tables. Audit records add
only the stable `principal_id`, never Authorization headers or token material.
Known configured secrets accidentally reflected in logged request data are
redacted. Do not put credentials in tool arguments or other payload fields.

## Roles, permissions and routes

| Role | Explicit permissions | Routes |
| --- | --- | --- |
| agent | `runtime.evaluate`, `runtime.use_lease` | `POST /turn`, `POST /tool`; lease presentation remains subject to Kingpin validation |
| authority_admin | `authority.issue_lease`, `authority.revoke_lease`, `authority.revoke_all` | `POST /lease`, `POST /revoke`, `POST /revoke/nonce`, `POST /revoke/all` |
| reviewer | `review.access`, `review.resolve` | review access, scoped list/inspect and approve/deny |

`authority.revoke_lease` also gates the existing `/revoke` operation for
context-scoped capability revocation. Admin does not inherit agent or reviewer
permissions; reviewer does not inherit lease or global-revocation permissions.
No policy editing, database manipulation, recovery mutation or consumed-ID reset
route is exposed. There was no own-authority query route to preserve, so no new
state-query permission/endpoint was invented.

Missing/invalid credentials return **401**. Authenticated callers without the
required permission, or agents outside their configured scope, receive **403**.
Errors do not reflect credentials, database errors or internal stack traces.
Authenticated authority denials retain their existing HTTP mappings. Underlying
operation errors retain their status classes but use generic transport messages.

## Agent/context isolation

For both runtime routes, `speaker_id` must equal the authenticated `agent_id`.
If JSON includes `agent_id`, it must match too. The complete normalized context
must match the configured tuple: omitted/null session means `default`, and
omitted/null scene/task mean null. Both scene and task are checked, even when
scene has precedence in Kingpin, because CDE evaluates additional scopes.
Agents cannot switch to an unconfigured session to recreate fresh authority.

Different principals cannot share a CDE session in configuration: CDE's
EMA/hysteresis history is session-wide, so merely checking Kingpin's selected
scope would leave a cross-principal influence path. Shared history requires a
separate future design; this step rejects it explicitly.

Admin requests may target evaluated contexts for existing administrative
operations. Their ability to target those contexts does not make a lease valid:
Kingpin still checks eligibility, exact binding, expiry and revocation.

## Runtime and admin usage

Start the gateway with the trusted file:

```sh
KINGPIN_AUTH_FILE=/absolute/path/evaluator.auth.local.json npm --prefix gateway_node run dev
```

The warm CDE service must already be running internally, as before. With the
example context and a generated agent token in `AGENT_TOKEN`:

```sh
curl http://127.0.0.1:8787/tool \
  -H "Authorization: Bearer $AGENT_TOKEN" -H 'Content-Type: application/json' \
  -d '{"tool":"fs.list","args":{},"plan_id":"plan","user_request":"list files","speaker_id":"example-agent","channel_id":"example-channel","session_id":"example-session","scene_id":"example-scene"}'
```

After that context has been evaluated, an admin can issue a lease:

```sh
curl http://127.0.0.1:8787/lease \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"tool":"fs.list","args":{},"seconds":60,"speaker_id":"example-agent","channel_id":"example-channel","session_id":"example-session","scene_id":"example-scene"}'
```

Use the returned `lease_id` as `lease_nonce` to revoke exactly that issuance:

```sh
curl http://127.0.0.1:8787/revoke/nonce \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"lease_nonce":"RETURNED_LEASE_ID"}'
curl http://127.0.0.1:8787/revoke/all \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{}'
```

These routes directly delegate to Kingpin's existing methods. The merged demo
generates separate ephemeral agent/admin credentials in a mode-0600 temporary
file, supplies headers, and removes the file on completion. Its isolated HUMAN
REVIEW example uses a separate agent principal. No credential is printed and the
authority transcript/outcomes stay unchanged.

## Minimal reviewer boundary

Persistent [HUMAN REVIEW resolution](../review/README.md) now supplies scoped
list/inspect, approve/deny and one-use agent consumption. Reviewer permissions are
`review.access` and `review.resolve`; agents and authority admins do not inherit
them. `GET /review/access` reports `resolution_supported: true`. Reviewer entries
may carry exact `allowed_contexts`; omission explicitly gives a global reviewer.
Approval satisfies only the review condition and never overrides current policy,
evidence, envelope, lease/revocation or request binding.

## Trust and deployment limits

Bearer tokens require **secure transport in real deployments**. TLS termination
is not implemented here; the examples are for local loopback evaluation. Never
expose this HTTP listener over an untrusted network without secure transport.
Keep the unauthenticated internal Python CDE service inaccessible to agent callers:
its existing direct endpoint is not part of the authenticated public gateway.

Direct `KingpinAuthority` methods, state repositories and the injectable app
factory remain trusted host-code APIs. They intentionally do not accept a
caller-chosen principal as a substitute for HTTP authentication. Do not hand an
untrusted agent a runtime object, database handle or auth configuration. Detailed
`validateLease`, `hasValidLease`, policy loading and store construction remain
in-process only. Direct review APIs also remain trusted host control-plane APIs.

This is not an identity platform. There are no accounts, passwords, OAuth/JWTs,
roles administration, per-token expiry, rate limiting, cryptographic lease
signatures or database tamper/backup rollback protection. Possession of a valid
bearer token grants its configured principal permissions; token theft is not
otherwise detected. Authentication is distinct from lease authenticity and
revocation, whose existing guarantees and limits remain unchanged.

## Validation recorded for this step

The complete Node suite passed **84 tests**, including **17 new authentication
and authorization tests**. The complete Python/schema suite passed **7 tests**,
including the unchanged frozen 32-event baseline. Existing authority oracle,
nonce/epoch restart, migration and concurrency tests pass. A new child-process
restart test reloads credentials and checks unchanged principal permissions,
consumed IDs and epoch state, and verifies bearer credentials are absent from
the SQLite file. The merged HTTP demo passes with ephemeral credentials and
explicit 401/403 checks; the standalone demo passes; `git diff --check` passes.

Gateway tests were updated to supply credentials and expect sanitized failure
messages. No Kingpin decision code, policy semantics, persistence schema, CDE
code, frozen authority fixture or public v1 schema was changed by this step.
