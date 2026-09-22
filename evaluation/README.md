# Controlled evaluator quickstart

This v0.4 development build is for controlled, single-node evaluation. It is not
represented as production-ready. Start here; no research-paper reading is needed.

| Mode | Effects and state |
| --- | --- |
| Demo (`npm --prefix gateway_node run demo`) | Simulated tools, in-memory governance, frozen compatibility walkthrough |
| Evaluation (`evaluation` below) | Real bounded filesystem effects, private authenticated runtime, persistent SQLite governance/audit/execution |

Use macOS or Linux with **Node 24** (built-in `node:sqlite` and global fetch),
Python **3.10+**, npm and a trusted local account. Validation used Node 24.14.1 and
Python 3.14.6. SQLite's Node experimental warning is expected. Windows is not
supported by this POSIX sandbox adapter.

## Install and configure

Install Node **24** using the [official Node download page](https://nodejs.org/en/download):
select version 24 and your operating system/architecture, then use its installer
or installation instructions. Open a new terminal and verify `node --version`
reports `v24.x` and `npm --version` works. Install Python 3.10+ with `venv` support
and Git if absent; verify `python3 --version`.

From the cloned repository root (on branch `v0.4-product`):

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt -r requirements_gateway.txt -r requirements_test.txt
npm --prefix gateway_node ci
npm --prefix gateway_node run evaluation:configure -- ../config/evaluation.local "$PWD/.venv/bin/python"
```

The generator copies the checked-in examples, creates independent random bearer
credentials for an agent/admin/reviewer, and creates a private sandbox. It never
prints tokens or overwrites an existing directory. The generated local directory
is git-ignored. Do not commit it or share its auth file with an acting agent.
The checked-in `config/evaluation.example/auth.json` contains deliberately invalid
placeholders; it cannot authenticate anyone until replaced with real local values.

Edit `config/evaluation.local/runtime.json` if necessary:

| Setting | Meaning |
| --- | --- |
| `schema_version` | Configuration version `1.0` |
| `mode` | Must be `evaluation`; no production mode |
| `database` | SQLite file, relative to runtime.json; initial file must not exist |
| `auth` / `policy` | Local server-controlled JSON files, relative to runtime.json |
| `sandbox` | Existing private directory owned by the evaluator, mode 0700 |
| `host` / `port` | Loopback `127.0.0.1` or `::1`, port 1024–65535; default 8788 |
| `python` | Python executable path, relative to runtime.json or absolute |

Default generated locations (relative to the repository root):

| Location | Contents |
| --- | --- |
| `config/evaluation.local/runtime.json` | Local runtime settings |
| `config/evaluation.local/auth.json` | Private bearer credentials for three roles |
| `config/evaluation.local/policy.json` | Trusted tool configuration |
| `config/evaluation.local/sandbox/` | Actual bounded tool files |
| `config/evaluation.local/governance.sqlite` | Durable governance, audit and execution state |
| `config/evaluation.local/client-checkpoint.json` | Private walkthrough checkpoint, including a lease token |

Audit events live in the same SQLite database; no extra audit destination or
operational payload logger is enabled in evaluation mode. Control/configuration
files must be outside the sandbox. No configuration is selected from HTTP bodies.
There are no evaluator environment overrides to accidentally enable permissive
settings. `CDE_DEMO_FIXTURES=1` causes evaluator startup to fail explicitly.

The sample auth file grants agent `evaluator` two exact sessions (`evaluation`
and `review`) in channel `tools`, scene `sandbox`. Admin and reviewer credentials
are separate; the reviewer is scoped to the review session. Replace these IDs and
scopes in your integration as needed. Only the walkthrough client assumes these
example identities. See [authentication](../kingpin/auth/README.md) for the format.

## Initialize and start

```sh
npm --prefix gateway_node run evaluation -- ../config/evaluation.local/runtime.json --initialize
```

`--initialize` explicitly creates a new database and refuses an existing file.
Subsequent starts **must omit it**:

```sh
npm --prefix gateway_node run evaluation -- ../config/evaluation.local/runtime.json
```

Missing databases are not silently recreated. Existing compatible schemas migrate
transactionally through schema 5; corruption, incompatible policy or schema,
missing auth, placeholders and malformed configuration stop startup. A failure
after successful database creation may leave a valid database; inspect the setup
and retry without `--initialize`, never delete governance history as a workaround.
The listener starts only after config, policy, authentication, SQLite, sandbox and
CDE startup validate. Ctrl-C closes the listener, CDE child and store.

Startup prints safe product/version/mode/policy/storage metadata and listener
address. Authenticated `GET /status` exposes the same build identity, including a
Git commit if readable without shelling out, otherwise null. This commit is
checkout provenance, not a signed or dirty-tree content digest. No paths, tokens,
raw config, principal lists or database contents are exposed by status.

CDE runs as one private stateful Python child over stdio, with a separate engine
per session. It runs the unchanged engine/response code and exposes no port.
Failure or timeout fails evaluation closed; it is not transparently restarted.
CDE observation history is still in memory; Kingpin governance persists on restart.

## Exercise the integration

In a second terminal at repository root:

```sh
npm --prefix gateway_node run evaluation:client -- ../config/evaluation.local/runtime.json
```

The readable [client.mjs](client.mjs) is a local operator walkthrough. It reads all
three credentials deliberately, selects roles for each authenticated request, and
checks every expected result. A deployed agent must receive **only its own token**.

The walkthrough writes/reads `example.txt`, refuses deletion without a lease,
issues and individually revokes a lease, issues another and advances the epoch,
and verifies both deletions remain blocked. It then uses actual CDE observations
to trigger HUMAN REVIEW, approves and consumes exactly one write to `reviewed.txt`,
refuses replay, denies another review, and queries the correlated audit lifecycle.
No injected signals, fake gates or demo fixtures are used.

Two agent ingress paths are available:

- `POST /tool`: preserves the existing text wrapper (`TOOL ... args=... user_request=...`).
- `POST /tool/observed`: evaluation-only integration for an actual agent utterance
  paired with a tool request. CDE evaluates `user_request` verbatim; tool/args are
  separately bound by Kingpin. The request text is an observation, not a gate or
  policy override. An urgent utterance followed by `.` naturally exercises the
  existing low-confidence path. The wrapper route cannot faithfully represent
  that very short observation because it adds text; its behavior is unchanged.

Both require `tool`, `args`, `plan_id`, `user_request`, `speaker_id`, `channel_id`
and a configured session/scene/task. Gate-1 evidence uses `dry_run: true` and a
nonempty `diff`, exactly as before. Tool class/floors always come from trusted
policy; submitting your own classification has no effect. Responses keep existing
authority projections and add `tool_result` only after real adapter execution.
Adapter refusals return 422 (or a fail-closed review execution error), never a
successful operation. `execution_authorized` does not assert side-effect completion.

For example, with an agent token supplied securely by your operator:

```js
const response = await fetch('http://127.0.0.1:8788/tool', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${agentToken}` },
  body: JSON.stringify({
    tool: 'fs.write', args: { path: 'note.txt', content: 'hello\n' },
    plan_id: 'plan-1', user_request: 'Please write this bounded note.',
    speaker_id: 'evaluator', session_id: 'evaluation', channel_id: 'tools', scene_id: 'sandbox',
    dry_run: true, diff: 'Create note.txt with the supplied content.'
  })
});
```

HTTP 428 with `X-Review-ID` means no adapter execution. The reviewer can list
`GET /reviews`, inspect `GET /reviews/:id`, and POST `/approve` or `/deny`.
Approval itself does not execute. The original agent POSTs the **exact original
body** to `/reviews/:id/execute`; current governance is rechecked and permission is
atomically consumed before the adapter runs. Changed arguments cannot carry an
approval forward. See the [review contract](../kingpin/review/README.md).

Admin operations remain POST `/lease` (exact tool/args/context plus `seconds`),
`/revoke/nonce` (`lease_nonce` from issuance `lease_id`), `/revoke/all` (empty body)
and existing `/revoke` for context/capability or token revocation.
Admin-only `GET /audit/:request_id` uses the new read-only `audit.read` permission.
Capture `X-Request-ID` from `/tool`; review lifecycle events retain that original
ID through resolution and consumption. Audit queries never return raw lease or
bearer tokens. Failed audit reads return an error, not a fabricated empty history.

## Read a request trace

Capture `X-Request-ID` from the original tool response, including a HUMAN REVIEW
response. In another terminal, with the evaluator still running:

```sh
npm --prefix gateway_node run evaluation:trace -- ../config/evaluation.local/runtime.json <request-id>
```

This local operator utility uses the single `authority_admin` credential in the
local auth file and only calls authenticated `GET /audit/:request_id`. It does not
open the store, reconcile, retry, authorize or mutate state. Multiple admin entries
are rejected as ambiguous. Unknown IDs print “No audit events found”; failed reads
exit unsuccessfully instead of pretending the history is empty. No events can
also mean a wrong ID or a failure before audit capture, not proof of success.

The timeline retains available principal/context and evaluation/decision/review/
execution IDs. Permission is distinguished from execution receipts; operator
historical disposition is distinguished from adapter inspection. UNKNOWN does
not prove a process crash, and the trace does not invent a revalidation step.
It prints selected fields, escapes terminal controls and redacts configured bearer
credentials; raw arguments, evidence, result payloads and free-text reasons are
omitted. Treat remaining identity/context metadata as private. This is a projection
of product audit, not a new audit format or Paper 9 canonical output.

Continue with the [adversarial playbook](ADVERSARIAL_TESTING.md).

## Restart and verify continuity

Stop the runtime with Ctrl-C, restart **without `--initialize`**, then run:

```sh
npm --prefix gateway_node run evaluation:client -- ../config/evaluation.local/runtime.json --continuity
```

The client checks persisted audit history, rejection of its old-epoch lease and
its consumed review record. Its local `client-checkpoint.json` contains an opaque
lease token and is private; do not publish it. This check does not reset state.
The full walkthrough is designed for a fresh evaluator configuration; use the
continuity command after restart instead of assuming a fresh authority history.

## Policy and adapter boundary

Edit the copied policy **before initial database creation**, or select another
trusted policy file. Existing stores are bound to the full policy fingerprint and
reject incompatible changes; no hot reload/reset is supplied. See the
[policy format](../kingpin/policy/README.md) to add tool identities without editing
Kingpin. Unknown policy tools fail closed at Kingpin; policy tools without an
adapter implementation fail at the adapter without a side effect.

The bundled adapter supports exactly:

| Tool | Arguments | Default trusted class |
| --- | --- | --- |
| `fs.read` | `{path}` | read_only |
| `fs.write` | `{path, content}` | write |
| `fs.delete` | `{path}` | destructive, requires a lease |

Only single-component filenames are supported. No absolute paths, `..`, slash or
backslash, nested directories, symlinks, hard links, devices or shell operations.
Files are bounded to 64 KiB for reads/writes. Writes create files mode 0600 and
flush before responding. The configured directory is private, stable and owned
exclusively by the evaluator; do not let other processes modify it concurrently.
The adapter accepts no policy, CDE signal or Kingpin state handle.

Trusted host code can replace the `adapter.execute(request)` collaborator in
`createGatewayApp`. The gateway calls it synchronously only after Kingpin allow
and required enforcement audit commit. It must return its operation result or
throw; asynchronous adapters are not supported by this narrow build. Tool
implementation beyond the three bundled operations requires writing an adapter,
not changing Kingpin or letting the acting agent upload code.

## Validate and troubleshoot

```sh
npm --prefix gateway_node test
.venv/bin/python -m unittest discover -s tests -v
CDE_PYTHON="$PWD/.venv/bin/python" npm --prefix gateway_node run conformance
CDE_PYTHON="$PWD/.venv/bin/python" npm --prefix gateway_node run demo
.venv/bin/python run_demo.py
CDE_PYTHON="$PWD/.venv/bin/python" npm --prefix gateway_node run evaluation:smoke
```

The smoke command generates a temporary configuration, runs the actual HTTP
client, restarts the process, verifies continuity and removes its own temporary
files. It uses loopback port 18789; `EVALUATION_SMOKE_PORT` can select another test
port. The frozen demo uses demo mode, memory state and existing opt-in fixtures;
it never uses your evaluator database. Never enable fixtures in evaluation mode.

If `.venv/bin/python --version` fails because its interpreter symlink points to
an installation that no longer exists, stop the evaluator and recreate **only**
the repository-local virtual environment:

```sh
rm -rf .venv
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt -r requirements_gateway.txt -r requirements_test.txt
```

Run these commands from the repository root after checking that `.venv` is the
local environment you intend to replace. Preserve `config/evaluation.local`, its
credentials, sandbox and database. Keep runtime.json's `python` pointing to the
new absolute `.venv/bin/python`; restart without `--initialize`. Do not rerun the
configuration generator against your existing configuration directory.

For startup failure check: the runtime.json field names, executable Python with
installed dependencies, generated auth rather than placeholders, valid policy,
existing private sandbox, writable database parent, correct initialize/reopen
choice and an unused loopback port. Errors intentionally do not echo secret
configuration contents. Do not reset a corrupted/incompatible store to work
around a failure; restore trusted state or use a separate fresh evaluation.

Further reading: [security boundaries](SECURITY.md), [evaluation notice](NOTICE.md),
[architecture](../kingpin/README.md), [Paper 9 conformance](../conformance/README.md).


## Execution receipts and uncertain outcomes

Kingpin authorizes actions. The execution layer separately records whether an
authorized action started and whether its result is known. Writes/deletes now
return `execution_id` and `execution_status`; successful responses follow a durable
success receipt. Reads retain their simple result without uncertain side-effect
state. `tool.enforcement.allowed` means permission, while
`tool.execution.succeeded` means adapter-reported completion was recorded.

On restart, dangling starts become unknown and receive read-only adapter
reconciliation. **Never retry an unknown action automatically.** Inspect
`GET /executions` and `GET /executions/:id` as admin/reviewer. Request a fresh
inspection with `POST /executions/:id/reconcile`. If it remains
`reconciliation_required`, a scoped reviewer may record an explicit historical
outcome via `POST /executions/:id/resolve` with `{"outcome":"succeeded"}` or
`{"outcome":"failed"}`. Neither operation executes a tool. Only a fresh governed
request after disposition/reconciliation may retry; consumed reviews stay consumed.

Startup holds an exclusive OS lock on `<database>.runtime.lock`; do not delete
that file while running. A second evaluator using that database is refused.
Migration 4 → 5 adds execution records without rewriting prior governance state.
See the [execution contract](../execution/README.md) for postcondition assumptions,
permissions, crash windows and the explicit absence of exactly-once guarantees.

The example reviewer is scoped to the `review` session. To let that reviewer
resolve uncertain operations from the main `evaluation` session too, explicitly
add the following tuple to its `allowed_contexts` in your private auth file and
restart to reload credentials/scopes (do not reinitialize the database):

```json
{"session_id":"evaluation","channel_id":"tools","scene_id":"sandbox","task_id":null}
```

Existing deployments do not silently gain wider reviewer scopes. Admins can
inspect/reconcile all execution records but still cannot supply human disposition.
The deterministic real-HTTP crash test can be run separately with:

```sh
CDE_PYTHON="$PWD/.venv/bin/python" node tests/fixtures/execution_http_smoke.mjs
```
