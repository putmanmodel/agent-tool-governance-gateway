# Evaluator readiness pass — validation and handoff

Completed on `v0.4-product`, 2026-09-22. This pass changes documentation and adds
one read-only audit projection plus tests. No authority, policy, CDE, persistence,
review, recovery, adapter, public schema or Paper 9 semantics changed. No dependency
was installed/upgraded; no commit or push was made.

## Files

| File | Change |
| --- | --- |
| `evaluation/README.md` | Mode distinction, official Node installation, exact setup/restart commands, private file locations, trace, broken-venv recovery |
| `evaluation/ADVERSARIAL_TESTING.md` | Concrete attacks, expected behavior, evidence and repeatable fixture commands |
| `evaluation/SECURITY.md` | Precise current guarantees, host assumptions and explicit nonclaims |
| `evaluation/trace.mjs` | Read-only authenticated request trace; no store access or mutations |
| `gateway_node/package.json` | `evaluation:trace` command; dependency declarations unchanged |
| `gateway_node/trace.test.js` | Five focused formatter/client regression tests |
| `evaluation/smoke.mjs` | Runs the real trace CLI against a recorded successful HTTP request |
| `README.md` | Distinguishes demo simulation from real evaluator effects |
| `gateway_node/README.md` | Separates operational demo logs from evaluator audit and execution receipts |
| `kingpin/audit/README.md` | Corrects in-process-only audit and simulated-only execution wording |
| `kingpin/review/README.md` | Corrects current executor limitations; keeps review guarantees |
| `ARCHITECTURE.md` | Explicitly scopes historical/demo architecture and links current contracts |
| `evaluation/VALIDATION.md` | Labels prior packaging results/schema 4 as historical, not current |
| `evaluation/READINESS_VALIDATION.md` | This report |

## Exact entry path

Read [evaluation/README.md](README.md) from the repository root. Install Node 24
and Python 3.10+ as documented, then:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt -r requirements_gateway.txt -r requirements_test.txt
npm --prefix gateway_node ci
npm --prefix gateway_node run evaluation:configure -- ../config/evaluation.local "$PWD/.venv/bin/python"
npm --prefix gateway_node run evaluation -- ../config/evaluation.local/runtime.json --initialize
```

In a second terminal at the same root:

```sh
npm --prefix gateway_node run evaluation:client -- ../config/evaluation.local/runtime.json
npm --prefix gateway_node run evaluation:trace -- ../config/evaluation.local/runtime.json <request-id>
```

Use the original `X-Request-ID`. Stop with Ctrl-C; restart with the same evaluation
command **without `--initialize`**, then run the client with `--continuity`. Setup
commands above are fresh-clone instructions, not commands used to reinstall this
working checkout during the pass. Preserve local credentials, sandbox and state.

The attack playbook covers authentication/roles, identity/context spoofing,
lease requirements/binding/expiry/nonce/epoch revocation, contraction, changed
review arguments/tool/target/evidence, review replay, unknown tools, traversal,
absolute paths, symlinks/hardlinks, known failures, both crash windows, UNKNOWN
inspection/disposition, restart and corrupted/incompatible stores. Existing
fixtures supply deterministic unsafe-state/crash exercises; no product failpoint
or force-authority endpoint was introduced.

## Trace evidence

The utility calls only existing admin-authenticated `GET /audit/:request_id`,
with a loopback target, no redirects and a timeout. It reuses credential validation
and redaction, escapes terminal controls and omits arbitrary payloads. It retains
correlation fields per event, requires one unambiguous local admin credential,
and distinguishes empty history from read failure. It does not reconcile, retry,
authorize or invent events. UNKNOWN alone does not establish a crash cause;
operator disposition is explicitly a human assertion.

Actual smoke-run excerpt, with repetitive correlation/context lines omitted:

```text
Request: "f04089d8-6053-4807-8479-7c4213ed8578"
→ CDE signal created
→ Authority requested
→ Kingpin decision
  Outcome: "allow"
→ Gateway enforcement allowed (permission only)
→ Execution STARTED
→ Execution SUCCEEDED (adapter receipt)
```

The full output included principal `evaluator-agent`, agent `evaluator`, context
session `evaluation` / channel `tools` / scope `scene:sandbox`, evaluation ID
`41068af1-c3f7-489c-8fb2-3a734c8c168e`, decision ID
`8533f347-a528-443a-9d18-b7c258057730` and execution ID
`2625f95e-fd0f-4183-8d64-56c39c46f340`. The smoke's temporary database was removed
by its normal cleanup; these IDs illustrate real output, not a reusable live query.

New tests exercise actual runtime-generated execution/review histories, all five
decision outcomes, unchanged input, correlation preservation, omitted payloads,
terminal escaping, credential redaction, GET-only access, redirect prevention,
unknown/missing IDs, read failures, correlation mismatch and unsafe configuration.
The expanded HTTP smoke additionally invokes the actual CLI and checks its receipt.

## Results

| Command/check | Result |
| --- | --- |
| `npm --prefix gateway_node test` | **205/205 passed**, 0 failed/skipped; prior 200 plus 5 trace tests |
| `.venv/bin/python -m unittest discover -s tests -v` | **18/18 passed**, including frozen schemas and exact Paper 9 envelope checks |
| Frozen 32-event CDE baseline | Unchanged; full field comparison in `test_original_demo_events_unchanged` |
| Frozen Kingpin authority oracle | Passed for memory and SQLite within Node suite |
| `CDE_PYTHON="$PWD/.venv/bin/python" npm --prefix gateway_node run conformance` | **11/11 passed** |
| `CDE_PYTHON="$PWD/.venv/bin/python" npm --prefix gateway_node run demo` | All merged HTTP demo assertions passed |
| `.venv/bin/python run_demo.py` | Passed; standalone operational output generated |
| `CDE_PYTHON="$PWD/.venv/bin/python" npm --prefix gateway_node run evaluation:smoke` | Authenticated walkthrough, real trace CLI and restart continuity passed |
| `CDE_PYTHON="$PWD/.venv/bin/python" node tests/fixtures/execution_http_smoke.mjs` | Both before-effect and after-effect SIGKILL/restart cases passed; no repeated write |
| Existing restart, concurrency, corruption and migrations | Passed within complete Node suite |
| `npm --prefix gateway_node audit` | **0 vulnerabilities**; initial sandbox DNS failure resolved by network-enabled retry |
| `git diff --check` | Passed |

Validation used the existing Node 24.14.1 and `.venv` interpreter. Python dependency
auditing was not rerun in this pass; the user-supplied prior pip-audit result is
not presented as a new measurement. No package lock or requirements file changed.

## Trust and exclusions

The evaluator governs agent authority under its documented host/runtime trust
assumptions. It implements authenticated role separation, trusted policy/state
validation, durable revocation/review/audit/execution, sandbox restrictions and
restart reconciliation. It does not establish compromised-host resistance,
remote attestation/measured boot, binary/config cryptographic integrity,
rollback-proof/tamper-evident history, signed leases, TLS, distributed consensus
or exactly-once external effects. Full prompt-injection detection and upstream
retrieval/memory/multi-hop provenance remain unmodeled extensions. CDE signals,
Kingpin decisions, gateway enforcement and any forwarding/attention role remain
separate; UNKNOWN never means automatic retry.

No new authority features, endpoints, store, audit format, dashboard, signing,
authentication system or dependency changes were introduced. Historical v0.3
contracts and previous implementation results were preserved; current docs now
point to real evaluator behavior.

No material blocker was found for handing this build to a technical evaluator
**within the documented controlled, trusted-host scope**. Practical limits remain:
macOS/Linux and Node 24, private loopback runtime, exclusive sandbox ownership,
one local admin entry for this convenience command, unpaginated audit history,
and manual handling of inconclusive execution outcomes. This is not a production
or compromised-host security claim.
