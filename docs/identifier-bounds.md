# Replicated identifier bounds

## Inventory and reason for the limits

The 128-detail budget bounds object count, but each detail embeds `turn_id` twice:
inside `span_id` and as `turn_id`. `/tool` generates that identifier; authenticated
`/turn` previously accepted arbitrary-length identifiers. Scope events and
`top_event` then repeated the details. A 4,732-byte request produced a 4,331,188-byte
response with only 128 details. Count admission alone could not bound element size.

The inventory used to choose the limits is:

| Input/projection | Control and replication | Bound |
| --- | --- | --- |
| `turn_id`, embedded prefix of `span_id` | Agent-controlled on `/turn`; server-generated on tool routes. Copied into every detail and each event. | 128 UTF-8 bytes; fixed extractor suffixes add only offsets/labels. |
| `speaker_id`, `channel_id`, `scene_id`, `task_id` | Agent supplies values; gateway ownership checks require configured identity/context. Repeated in events, derived scope keys and audit context. | 256 UTF-8 bytes each; derived scope prefixes are fixed. |
| `session_id` | Agent-supplied, configuration-authorized session; CDE engine lookup and persisted governance/audit context. Not copied into each span. | 256 UTF-8 bytes before gateway evaluation or Python session lookup. |
| `tool` / audit `tool_id` | Agent-supplied lookup key; class and floors come from server policy. Unknown names were also copied into audit summaries. | 256 UTF-8 bytes at evaluation ingress, before CDE or authority. |
| `plan_id`, observation text, arguments, `diff` | Not copied into individual CDE evidence. Bindings store hashes/presence; legacy operational logging and input echo can contain originals. | Existing HTTP body limit; no new identifier bound or truncation. |
| Evidence layer/method/version/notes | Fixed extractor constants and rule patterns, never caller-supplied labels. | Fixed strings. |
| Event/evaluation/request/decision/review/execution IDs | Server-generated IDs. Caller extras do not override the evaluated tool event ID. | Existing generated sizes. |
| Manifest/policy versions, baseline hashes, tool class, reason labels | Trusted server configuration or fixed computed values. | Not agent-controlled; unchanged. |
| Evidence offsets, scores, confidence, aggregate counts | Computed from observation text and trusted rules. | Existing ingress size and scoring/count rules; unchanged. |
| `policy_state` and other unrecognized CDE input extras | Not echoed in evidence/events or used as limits. | Cannot override these bounds. |

128 bytes accommodates UUIDs and descriptive turn names while bounding the
highest-multiplicity field. 256 bytes accommodates namespaced context/tool names;
these appear in far fewer places. These are byte limits, not ASCII-only rules:
Unicode identifiers remain supported. No identifier is shortened or normalized.

## Enforcement and compatibility

`src/types/identifier_limits.json` is the versioned trusted definition shared by
Node and Python. It is code-owned validation data, not agent policy. Both loaders require exactly the version and limit-map keys, all seven expected
fields, and positive safe-integer numeric limits (at most 2^53 - 1). Strings,
booleans, fractions, non-finite numbers, missing fields and extra structures fail
at load time. Integral JSON numbers such as `256.0` are accepted consistently.
Each loader keeps an immutable copy; changing the definition requires restarting
both runtimes. Node validates
before invoking CDE on `/turn`, `/tool`, and `/tool/observed`; Python validates
before extraction, and the service/worker validates before creating a session
engine. Invalid Unicode is rejected rather than replaced.

The Pydantic `TurnPacket` schema advertises the character upper bound and the
`x-maxUtf8Bytes` constraint; runtime validation enforces UTF-8 bytes. Session and
tool are transport fields checked against the same definition. Frozen
`schemas/v1` and the Paper 9 canonical schema are untouched. This changes malformed
identifier acceptance only, not accepted-input scores, confidence, scope selection,
leases, reviews, contraction, recovery, or tool authority.

Authentication/context ownership still precedes evaluation validation. An
unowned context can therefore return 403 first. An authenticated overlong turn ID
returns 400 with the existing request correlation header. `/turn` remains a
signal-only endpoint without tool authority/audit events. Invalid governed-tool
input records the existing `tool.enforcement.failed` / `INVALID_REQUEST` event
without reflecting oversized metadata. No CDE call, authority decision, or adapter
execution occurs for a rejected identifier.

Evaluator configuration loading checks every principal ID, agent ID, agent or
reviewer context, and policy tool ID using the same validation helper. Principal
and agent IDs use the 256-byte speaker/identity budget. Incompatible configured
identifiers fail with an explicit diagnostic before the CDE worker/lock, sandbox
adapter, or persistent store is initialized or opened. Operators must choose
compatible identifiers before startup; there is no automatic identity rewriting,
state migration, or permissive fallback.

## Regression coverage

Tests cover exact byte boundaries, multibyte identifiers, invalid Unicode,
one-byte overflow, 4 KB turn IDs, attempted limit overrides, every context field,
unknown tool IDs, pre-CDE rejection, correlation/audit behavior, and full
128-detail output with maximal metadata (including JSON escaping). Accepted
turn-ID changes preserve all nonidentity CDE event fields. Existing frozen,
lease/review, audit/trace, restart and conformance suites remain applicable.

## Guarded HTTP measurement

The temporary evaluator used real authentication, SQLite, CDE worker and gateway
collaborators. An instrumented evaluation callback counted CDE calls without
changing production code. Responses were streamed; an external monitor sampled
Node plus CDE RSS every approximately 25 ms, with a 900 MiB safety stop and
30-second request deadline. Temporary state and credentials were removed.

Each ordinary probe used 128 punctuation runs and the normal three scopes:

| Turn ID bytes | Request bytes | Response bytes | HTTP | CDE calls |
| ---: | ---: | ---: | ---: | ---: |
| 16 | 652 | 136,939 | 200 | 1 |
| 128 | 764 | 252,084 | 200 | 1 |
| 129 | 765 | 30 | 400 | 0 |
| 4,096 | 4,732 | 30 | 400 | 0 |

For maximum accepted replicated CDE metadata, all six CDE identifiers used their
full byte allowance. ASCII control characters were deliberately used to exercise
six-byte JSON escaping, with four scopes and 128 retained details. The request
was **9,066 bytes**, response **1,181,675 bytes**, latency **6.19 ms**. Combined RSS
was **105.3 MiB before / 113.1 MiB sampled peak / 113.1 MiB immediately after**.
After follow-ups and three seconds idle, RSS was **115.4 MiB**. Sampled peaks are
lower bounds; no forced GC was used.

Immediate follow-ups all returned 200: normal authenticated read with required
Gate-1 evidence **8.83 ms**, admin revoke-all **1.14 ms**, reviewer list **0.70 ms**.
No safety threshold, timeout, process death, or listener loss occurred.

This is a metadata/evidence bound, not a constant total response size: existing
input echo and trusted configuration still contribute. Existing duplicate
projections remain, and these sequential measurements do not establish concurrent
capacity.
