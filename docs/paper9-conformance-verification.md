# Paper 9 conformance verification

The canonical conformance envelope has now been checked against the Paper 9
Reference Architecture contract supplied by the user for this verification.
**Result: canonical conformance is not established. No canonical producer exists
in this checkout; existing JSONL producers emit operational records.** The
absence is a compatibility gap, not permission to relabel richer logs as canonical.

The exact required key set is:

```text
decision
demo_id
evidence
fixture_hash
fixture_path
mode
normative_ids
pass
rationale
timestamp_utc
```

Additional fields are prohibited in this envelope. Rich operational records may
exist separately. Source: the supplied `Paper9_Reference_Architecture_Interface_Contracts_0.2.pdf`,
Version 0.2, February 2026. Its full text was reviewed, and the envelope, evidence,
decision vocabulary and conformance-model pages were visually checked.

- §1.2 (page 2): these are harness-level contracts; richer internal payloads are allowed.
- §§2.3–3.1 (pages 3–4): proof/break fixtures emit one JSON object per line with
  exactly the ten keys above; additional logs may be emitted elsewhere.
- §3.2 (page 4): `evidence` is an ordered list of machine-parseable flag or
  key/value tokens. Structured values use JSON text inside a quoted string.
  CDE evidence-span objects are not this canonical token format.
- §4.1 (page 5): canonical decisions are exactly `ALLOW`, `REVIEW`, `DENY`,
  `FLAG_PROJECTION`, `REJECT_OR_FLAG_PROJECTION`, `QUARANTINE`, `ESCALATE`.
  Each normative specifies acceptable outcomes for proof/break cases.
- §9.3 (page 10): GEI conformance includes governance, rationale and applicable
  tooling evidence; it is more than a key-set test.
- §§10.1–10.2 (page 12): conformance requires proof/break fixtures, canonical
  envelope and evidence, and expected pass/fail outcomes reproducible on replay.

The user clarified that the paper is the normative specification and that they
are not aware of another runtime producer. No external producer is assumed.
The paper does not supply this repository's fixture/normative metadata bindings.

## Producer inventory and verification

Source search covered tracked and hidden project files, ignored local logs, all
JSON/JSONL writer call sites, and occurrences of the supplied key names. Dependency
and Git-internal files are not project producers.

| Producer / storage | Output and exact-key result |
| --- | --- |
| `run_demo.py:run_file` → `src/audit/logger.py:AuditLogger.append`; records from `src/engine.py` / `src/types/deviation_event.py` | `logs/cde_audit.jsonl`: current CDE records have 24 keys. Only `decision` and `evidence` intersect the Paper 9 set; eight required keys are missing and 22 extra keys exist. This is operational CDE output. |
| `gateway_node/server.js:appendDecisionLog`, through its `audit` helper | `logs/gateway_decisions.jsonl`: `/tool`, `/lease`, `/revoke`, `/revoke/nonce`, `/revoke/all` produce operational records. The current `/tool` record has 36 keys, only `decision` intersecting the canonical set; control records contain none of the ten required keys. No endpoint constructs a canonical record. |
| `kingpin/authority.js:_audit` → `kingpin/audit/events.js:event` | Rich versioned product events. Stored via `tx.audit.append` in `kingpin/state/memory.js` or `kingpin/state/sqlite.js:governance_events`. Not written to either operational JSONL file and not canonical. |
| `cde_cli.py`, `cde_service.py`, `src/response.py` | JSON response producers, not canonical JSONL emitters. |
| Tests and documentation query examples | Test-only JSONL round trips / explicit product event dumps; not production canonical producers. |

In particular, the CDE output lacks `demo_id`, `fixture_hash`, `fixture_path`,
`mode`, `normative_ids`, `pass`, `rationale`, `timestamp_utc`. Its `baseline_hash`
and numeric `ts` cannot simply be relabeled fixture hash and timestamp while
pretending the remaining conformance data exists. Gateway `evidence_spans` likewise
is not a top-level canonical `evidence` field.

Historical append-only local log files also contain earlier operational shapes;
none is the canonical ten-key envelope. They were inspected without rewriting
or truncating them.

## Narrow correction and separation

No runtime or public schema was changed. The correction is to misleading test
terminology: the former audit test named a temporary file `canonical.jsonl` while
writing frozen CDE operational rows into it. It now explicitly calls those records
legacy CDE output. The Node audit test's “canonical projection” label similarly
now says “legacy projection.”

The product stream stores its own event objects in a separate memory collection
or SQLite table. It does not modify CDE events, gateway legacy records or frozen
`schemas/v1` payloads. Tests against both stores prove detached product-query
objects can be extended arbitrarily without changing persisted events or gateway
JSONL records; unsupported product fields are rejected on append and rolled back.

A new test-only exact-key checker uses equality (`set(record) == PAPER9_KEYS`),
not subset containment. It rejects every missing key and representative additional
product keys. Structural examples also exercise the existing generic JSONL writer,
preserve the original decision value, and demonstrate byte-identical output when
a separate product log receives arbitrary fields, including collisions with all
ten canonical names.

These examples are deliberately synthetic: null placeholder values make no
claim about Paper 9 field semantics. They are not a canonical runtime producer.
Consequently, a live canonical-producer exact-key/injection regression cannot be
established until that producer is supplied or explicitly defined. The generic
`AuditLogger` remains a permissive operational serializer, not a canonical-envelope
validator. No missing metadata, `pass` result or decision vocabulary was invented.

## Tests and validation

Added five Python tests in `tests/test_paper9_conformance.py`:

- Specification-only fixture locks the exact ten keys and seven canonical decisions.
- Exact key equality; rejection of missing and extra fields.
- Structural exemplar JSONL round trip with unchanged decision value.
- Separate arbitrary product-field additions cannot alter exemplar bytes/keys.
- Actual CDE producer is explicitly recognized as noncanonical.

Added two Node tests in `gateway_node/audit.test.js` for memory/SQLite product
extension isolation and rejected unknown fields. Existing audit-test terminology
was corrected without weakening its assertions.

Validation results:

| Check | Result |
| --- | --- |
| Complete Node suite | 104 passed, 0 failed/skipped |
| Complete Python/schema suite | 15 passed |
| Frozen 32-event baseline | Pass, unchanged |
| Frozen authority baseline | Pass, unchanged |
| Four frozen v1 boundary schemas | Pass, files unchanged |
| SQLite restart/migration/audit tests | Pass within complete Node suite |
| Authenticated merged HTTP demo | All assertions pass |
| Standalone demo | Pass |
| `git diff --check` | Pass |

CDE gates, Kingpin outcomes (`allow`, `constrain`, `deny`, `quarantine`,
`human_review`), reasons and behavior remain unchanged. No runtime canonical decision output can be certified because no such producer is
present. The distinct Paper 9 vocabulary is now captured directly from §4.1 in
`tests/fixtures/paper9_contract.json`; runtime outcomes were not renamed.

## Field provenance for a separate adapter task

**An explicit canonical conformance adapter/emitter should be a separate v0.4
task.** The suitable boundary is a dedicated proof/break test harness that owns
the fixture path/bytes and expected assertions, invokes CDE → Kingpin → gateway,
and captures real results. A production request handler alone lacks the fixture
and normative context. Existing `tests/test_governance.py`,
`tests/fixtures/authority_cases.mjs`, and `gateway_node/demo.js` provide useful
execution/assertion boundaries; none currently implements the Paper 9 harness.

| Required field | Real source available now | What remains to define for canonical emission |
| --- | --- | --- |
| `decision` | Kingpin `AuthorityDecision.outcome`, reason codes, and gateway enforcement result (`kingpin/authority.js`, `gateway_node/enforcement.js`). | Explicit normative-specific translation to §4.1. `constrain` and `human_review` cannot simply be uppercased. CDE's legacy `decision` object is not a canonical string. Do not recompute authority in an emitter. |
| `demo_id` | Named case keys in `captureDecisions()` and named regression/demo scenarios. | Register stable demo identifiers against actual conformance cases; those keys are candidates, not currently declared canonical IDs. |
| `evidence` | CDE signal/evidence spans, trusted tool policy, actual decision/requirements, detailed lease results and enforcement records. | Select normative-required facts and serialize ordered §3.2 tokens. Translate class names explicitly when needed; do not manufacture rollback artifacts, signatures or unsupported facts. |
| `fixture_hash` | Exact file bytes of `demo/ramp_test.jsonl`, `demo/scope_test.jsonl`, or an explicitly designated executable case artifact can be read by the test harness. | Define hash algorithm and fixture identity/byte coverage, then compute it. Current `baseline_hash` hashes a manifest and is not a fixture hash. No canonical fixture hash is currently populated. |
| `fixture_path` | `run_demo.run_file(..., path)` and `tests/test_governance.py` know the real input path; Node tests know their actual fixture module path. | Select the real proof/break fixture and path representation. Live HTTP requests have no intrinsic fixture path. |
| `mode` | Tests contain success and refusal scenarios. | Explicit proof/break designation is missing. A denied tool request is not automatically a break fixture. |
| `normative_ids` | Paper 9 provides interface names such as GEI; existing tests assert concrete behaviors. | Supply/declare a normative registry and bind cases to actual normative IDs. Interface names and reason codes are not substitutes for missing normative identifiers. |
| `pass` | Real assertion outcomes from Python/Node tests and HTTP demo checks. | Evaluate the specific proof/break normative outcome, then emit that result under the declared harness semantics. Do not equate `allow`, HTTP 200, or overall suite success with this field. |
| `rationale` | `AuthorityDecision.reason` / `reason_codes`, CDE signal reasons, and actual failed assertion details. | Preserve these observed reasons as an explicit rationale representation sufficient for the evaluated normative. CDE's rationale helper currently collects spans, not a ready-made canonical rationale field. |
| `timestamp_utc` | A real harness emission clock; product events already demonstrate UTC ISO timestamps. | Capture the actual canonical emission time. CDE fixture `ts` is observation time, not necessarily emission time; do not synthesize a historical timestamp. |

There is enough real data for a harness to compute paths, hashes and timestamps,
and to capture substantive decisions/evidence/rationale/assertion results. There
is **not** enough declared metadata to claim complete canonical records now:
stable case registrations, proof/break mode, normative IDs and outcome/evidence
mappings require explicit definition. The specification fixture contains only
contract keys/vocabulary and source sections; it invents no field values. Temporary
key-only test objects use null sentinels and are not valid emitted conformance
records.

The separate-store tests establish current isolation, not a guarantee about code
that has not been written. A future adapter should explicitly construct exactly
the ten fields, never spread product-event objects, and run the exact-key check
against its real output. Current product-schema fields remain outside that
boundary. No adapter, HUMAN REVIEW resolution, MCP, signing, dashboards or other
new runtime functionality was introduced.
