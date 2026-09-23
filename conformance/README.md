# Paper 9 proof/break harness

**Paper 9 canonical conformance output is produced by the proof/break harness,
not by the runtime operational loggers.** This directory adds an evaluation layer.
It does not change Kingpin decisions, CDE behavior, gateway enforcement, product
audit semantics or the frozen `schemas/v1` payloads.

Run from the repository root:

```sh
npm --prefix gateway_node run conformance
# Optional explicit Python runtime:
CDE_PYTHON="$PWD/.venv-task/bin/python" npm --prefix gateway_node run conformance
# Generate the checked-in example using exactly the same runner:
node conformance/cli.mjs conformance/sample.jsonl
```

Default artifact: `conformance/output/results.jsonl` (ignored). The generated
`sample.jsonl` is checked in and contains no credentials or databases. The harness
uses `CDE_PYTHON`, otherwise the existing `.venv-task/bin/python` when present,
otherwise `python3` with repository requirements installed. It needs no HTTP server,
authentication config or additional package dependencies. Python subprocesses
invoke real `CDEEngine.process_turn()` and `build_response()` with one stateful
engine per fixture. Kingpin uses its public runtime APIs and bundled policy;
`enforceAuthorityDecision()` is the real gateway projection. This harness never
claims actual tool execution. Authenticated HTTP integration remains covered by
the existing separate demo/regression suite.

## Files and registration

- `normatives.json`: actual N11, N21 and N24 source references, requirements and
  explicitly bounded coverage.
- `cases.json`: stable case IDs, explicit proof/break mode, actual fixture path,
  fixed scenario driver and normative IDs. Unknown normative IDs fail before execution.
- `fixtures/*.json`: checked-in input packets, scope, tool arguments, evidence,
  lease duration, injected authority clock and observation texts needed to reproduce
  each case. No fake decisions, CDE signals, lease tokens or expected runtime outputs.
  For the evidence proof, the evidence phase accepts only `dry_run` and `diff`;
  assertions independently require the same operation before and after evidence.
- `cde_bridge.py`, `runtime.mjs`: real CDE/Kingpin/enforcement observations and
  isolated product audit traces; trusted issue/revoke APIs only.
- `assertions.mjs`: explicit JavaScript assertions over observations. No arbitrary
  assertion language or policy engine.
- `runner.mjs`: fixture loading, exact-byte hashing, assertion evaluation, explicit
  evidence projection and construction of exactly ten fields.
- `emitter.mjs`: one canonical validator/serializer/JSONL writer.
- `cli.mjs`: evaluator command; nonzero exit for failed assertions or harness errors.

The emitter exposes `appendRecord()` for single records and `serializeRecord()`
for the CLI's batch output. The CLI validates all records before writing a new
artifact. It refuses the operational `logs/` directory and non-JSONL paths. An
unmapped outcome or execution error produces a safe case-specific diagnostic,
nonzero exit and no invented canonical record. A prior output artifact is left
untouched on such an error; always check the command's exit status.

## Normative sources and coverage limits

The IDs are from **Paper 8 — Normative Interface Contracts for Stratified Agent
Architectures, v0.2**, section 5:

| ID | Source | Coverage in this repository |
| --- | --- | --- |
| N11 | Contract Requirement for Irreversible/Amplified Effect, pp. 8–9; N11a / demo06 | High-impact actions require governing authority. The runtime implements contract validity with scoped leases, nonce/epoch invalidation and envelope intersection. N11b amplification is not tested. |
| N21 | Evidence Supports Decision, pp. 11–12 | Assertions compare actual evidence requirements, lease results, restoration stages and authority outcomes with gateway permission. The paper's independent contradiction-detector demo is not implemented here. |
| N24 | Reflex Forwards, Governance Decides, pp. 12–13 | The governance boundary is exercised using actual CDE upstream forwarding. No Reflex module is present, so Reflex-specific conformance is not claimed. |

Sources were read from the user's local Paper 8 and Paper 9 v0.2 PDFs. Registry
entries cite document title/section/page and original demo name; their content is
self-contained so running the harness does not depend on those local PDF paths.
Paper 9 §3.2 governs canonical `name=value` token serialization, superseding Paper
8's older colon-token examples for this output. No new normative IDs were invented.
The local case registry is this repository's explicit mapping, not the original
Spanda `DEMO_MAP.md`, which is not present here.

These are **bounded runtime-profile checks**, not a claim that all observables of
N11/N21/N24 or the full PUTMAN architecture are PROVEN. In particular, authority
restoration is tested as an existing profile behavior; it is not relabeled as
N30's baseline stabilization. Scope/revocation mechanisms are current ways of
satisfying N11's governing-condition requirement, not new universal rules attributed
to the paper. The current controlled evaluator provides persistent, authenticated review
resolution and one-use execution APIs; this harness case checks initial
withholding only. See the [review contract](../kingpin/review/README.md).

## Registered cases

| Demo ID | Mode | Normatives | Expected observed behavior |
| --- | --- | --- | --- |
| `proof_non_destructive_allow` | proof | N21, N24 | Real calm CDE signal → read-only permission |
| `proof_required_evidence` | proof | N21 | Missing evidence first withheld; dry-run/diff then permit preview |
| `proof_scoped_lease` | proof | N11, N21 | Actual issued lease allows bound operation; changed args rejected |
| `proof_deterministic_recovery` | proof | N21 | Real severe CDE input contracts; clean observations restore staged authority |
| `break_destructive_without_lease` | break | N11 | Gate-0 upstream signal cannot bypass destructive floor/lease requirement |
| `break_nonce_revoked` | break | N11 | Nonce invalidation still denies after contraction and full recovery |
| `break_epoch_revoked` | break | N11 | Old issuance epoch still denies after contraction and full recovery |
| `break_out_of_scope` | break | N11 | Changed arguments invalidate the actual lease |
| `break_human_review_no_execution` | break | N21 | Real low-confidence signal results in REVIEW and withheld execution |
| `break_agent_envelope_expansion` | break | N11, N21 | Claimed class/floor/envelope cannot expand contracted authority |
| `break_upstream_is_not_authority` | break | N11, N24 | Upstream gate 0 and agent claims do not constitute authority |

`fixtures/detector_denial.json` is an additional **harness-negative control**, used
only by tests: a destructive request is run against the read-only proof assertion.
It produces a real runtime denial and `pass: false`, demonstrating that failed
expectations cannot be disguised by canonical serialization. It is not registered
as a passing suite case, nor presented as a runtime defect.

## Mode, result and decisions

`mode` is declared in registration; it is never inferred from an outcome.
`pass` means **all explicit assertions for this case matched real observations**.
A break test with the expected DENY therefore has `pass: true`. A failed assertion
has `pass: false` even when the runtime returns a valid canonical decision.
`rationale` is a deterministic list of assertion names, expected values, observed
values and PASS/FAIL, not generated reasoning.

One mapping function translates selected actual runtime outcomes:

| Kingpin | Paper 9 |
| --- | --- |
| `allow` | `ALLOW` |
| `human_review` | `REVIEW` |
| `deny` | `DENY` |
| `quarantine` | `QUARANTINE` |

`constrain` has no unambiguous Paper 9 decision spelling; selecting it as the final
case result fails the harness explicitly. The required-evidence proof observes
that intermediate outcome, but its final selected result is the real permission
with evidence. FLAG_PROJECTION, REJECT_OR_FLAG_PROJECTION and ESCALATE are accepted
canonical vocabulary but are never invented as runtime outcomes. No fake fallback
DENY is emitted for a harness exception.

## Envelope, provenance and reproducibility

Only `decision`, `demo_id`, `evidence`, `fixture_hash`, `fixture_path`, `mode`,
`normative_ids`, `pass`, `rationale`, `timestamp_utc` are emitted. Missing and extra
keys fail validation. Serialization uses that stable key order and one compact
JSON object plus newline per record. Public runtime schemas remain unchanged.

`fixture_path` is the registered repository-relative path of the actual file read.
`fixture_hash` is **`sha256:<lowercase hex>` of those exact file bytes**, including
whitespace/newlines. It is not a hash of a reserialized object, runtime code or
baseline manifest. Reproduction requires the same repository/runtime/policy as
well as the hashed fixture; this digest does not pin transitive dependencies.
`timestamp_utc` is the actual emission clock in UTC ISO format, separate from the
fixture-controlled authority clock used for deterministic lease expiry tests.

Evidence is an ordered list of Paper 9 §3.2 flag/key-value tokens. Structured values
are JSON text inside a quoted string. It includes observed signal gate, trusted
tool class, real effective gate/outcome, enforcement permission/blocking, reasons,
evidence requirements, envelope levels, assertions and actual lease-check results.
Class projection is explicit: read_only → non_destructive, write → reversible,
destructive → destructive. Canonical review-band labels follow §6.2's numeric gate
ladder; actual hold/allow is separately evidenced by outcome and enforcement flags.
An evidenced Gate-1 allow is the existing dry-run preview path. A Gate-2 leased
allow uses the higher-authority exception in §9.3. No tool execution is claimed.

Paper 9 §7's in-band precondition correlation uses `governance_token`, a SHA-256
binding of fixture hash, canonical decision and preceding evidence. This is a
harness correlation token, **not** an authority grant, signature or tamper-evident
log chain. It is computed only from actual observations and fixture identity.

Random CDE/product event IDs are omitted. Actual random lease identity is normalized
to the fixture-local alias `issuance_1` based on real issuance order, explicitly
marked by `lease_identity_normalization`. Scope, binding hash, issuance epoch and
expiry come from the actual lease response and issuance audit event. The alias is
not claimed to be the original nonce; the returned in-process observation trace
retains that nonce and its event association. This permits equal canonical fields
across repeated runs without replacing random identity generation in Kingpin.
No credentials or raw lease tokens enter evidence. The runner supplies actual
issued tokens to the emitter's secret-rejection check; credential evidence names
and bearer material are rejected before writing.

## Separation and validation

Product events stay in the real Kingpin audit store and are exposed separately in
`runCase(...).observed` for trusted tests. The harness calls neither operational
JSONL writer and does not spread product objects into canonical records. Mutating
or adding arbitrary product fields cannot change canonical output. Future fields
remain subject to the emitter's exact-key validator.

`gateway_node/conformance.test.js` covers real proof/break behavior, a failing
negative control, exact keys, invalid/missing/extra fields, vocabulary, registry
rejection, byte hashing, revocation after recovery, review withholding, evidence
grammar, secret rejection, separate logs/events, CLI output and repeat-run stability.
The complete existing suites continue to cover authenticated HTTP behavior,
frozen baselines, SQLite restart/migration and revocation durability. This initial
harness runs in memory and does not claim additional persistence coverage itself.

Validation for this implementation:

| Check | Result |
| --- | --- |
| Complete Node suite | 123 passed, 0 failed/skipped (19 new harness tests) |
| Complete Python/schema suite | 16 passed (one new real-sample check) |
| Complete conformance suite | 11/11 passed: 4 proof, 7 break |
| Frozen 32-event CDE baseline | Passed unchanged |
| Frozen authority baseline (memory/SQLite) | Passed unchanged |
| Authenticated merged HTTP demo | All assertions passed |
| Standalone demo | Passed |
| Existing restart/migration tests | Passed within complete Node suite |
| `git diff --check` | Passed |

No canonical field remains populated with a placeholder: IDs/modes are declared
registration data, provenance comes from real files, and outcomes/evidence/pass/
rationale/time come from execution and assertions. The documented coverage limits
and fixture-local lease aliases are deliberate scope/normalization rules, not
claims about absent Reflex, full normative coverage or tool-execution success.
