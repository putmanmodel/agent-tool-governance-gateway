# Bounded CDE evidence

CDE retains at most **128 detailed evidence spans per evaluation**, shared across
lexical and pragmatic extraction. `src/evidence_budget.py` owns this trusted
constant; neither request fields nor policy state can override it. Each scope
uses the same bounded evidence. Extraction order and the existing caps/phrase
sampling order remain deterministic.

All regex matches still contribute to the original score and confidence formulas.
Only detail retention is limited. Match counting uses iterators rather than
unbounded match lists. When details are omitted, operational deviation events
include `evidence_budget`: `limit`, `observed`, `retained`, `omitted`, and
`truncated`. Counts represent extractor matches, not distinct text positions
(overlapping rules can match the same text). They include matches omitted by the
existing eight-caps/ten-per-phrase-category sampling limits. Records without
omissions retain their existing shape.

The budget is explanatory metadata, not an authority input. CDE still computes
the same signal, Kingpin decides authority, and the gateway enforces it. The
frozen v1 boundary schemas, persisted audit schema, and Paper 9 ten-key envelope
are unchanged. The metadata is visible on response events and operational CDE
records; it is not added to persisted governance audit events.

## Amplification path and compatibility

Previously, each punctuation run created one `EvidenceSpan`. Extraction happened
once, but evidence appeared in every scope event, again in `top_event`, and again
in the gateway's `evidence_spans`. Three scopes meant five serialized copies:
25,000 matches became 125,000 serialized objects. The pragmatic extractor also
built unbounded match lists before keeping only twenty details.

Replacing repeated arrays with references would change the response contract.
This change retains those projections, now bounded to 128 entries each (at most
six copies for the four default scopes plus the two response projections).
Aggregate omission counts explain the missing detail without constructing it.
The gateway still echoes evaluation input, so total output includes input-sized
text; the bound addresses evidence amplification, not a constant total HTTP size
independent of ingress. Caller-selected identifiers also remain part of existing
payloads, with explicit UTF-8 byte limits described in
[Replicated identifier bounds](identifier-bounds.md). No ingress limit, authority rule, recovery rule, or authentication
behavior changes.

## Validation and measurement

Regression coverage includes 62,500 punctuation runs, shared extractor budgets,
exact omission counts, ignored agent budget hints, unchanged scoring/routing and
recovery trajectories against unlimited detail admission, a real CDE → Kingpin →
gateway quarantine, and the unchanged frozen 32-event baseline. Existing Paper 9
and audit/trace tests continue to cover their separate contracts.

Guarded local HTTP measurements use generated credentials and isolated temporary
state, a 30-second deadline and an external 900 MiB combined Node/CDE RSS guard.
Measurements are sequential, sampled RSS lower bounds; no forced GC is used.
Follow-up normal requests in the contracted context are expected to remain 423,
while revoke-all and reviewer-list operations return 200. This is a bounded
single-request characterization, not a concurrency capacity guarantee.

Measured on this checkout (decimal input/output bytes, RSS in MiB):

| Observation bytes | Request bytes | Response bytes | Latency ms | RSS before / peak / after / idle |
| ---: | ---: | ---: | ---: | --- |
| 10,000 | 10,176 | 203,054 | 21.7 | 100.6 / 107.1 / 107.1 / 107.5 |
| 100,000 | 100,176 | 293,049 | 18.0 | 107.5 / 110.0 / 110.0 / 110.6 |
| 250,000 | 250,176 | 441,765 | 34.4 | 110.6 / 112.9 / 112.9 / 113.0 |
| 500,000 | 500,176 | 693,057 | 60.6 | 113.0 / 117.3 / 117.3 / 116.6 |
| 980,000 | 980,176 | 1,173,057 | 108.0 | 116.6 / 127.1 / 127.1 / 125.9 |

All retained 128 details, with 640 serialized appearances across the five existing
projections. Observed match counts were 2,500 / 25,000 / 62,500 / 125,000 /
245,000; omitted counts were respectively 2,372 / 24,872 / 62,372 / 124,872 /
244,872. Every adversarial response was 423. Immediate normal request latencies
were 3.2 / 3.4 / 3.2 / 2.9 / 2.9 ms (423); admin revoke-all 1.1 / 1.1 / 1.2 /
1.0 / 1.0 ms (200); reviewer-list 0.7 / 0.6 / 0.8 / 0.7 / 0.6 ms (200).
The largest request was approximately 93.5% of the existing 1 MiB ingress limit.
No safety stop, process death, or listener loss occurred. Temporary evaluator
state and credentials were removed after shutdown.

For comparison, pre-change 10 KB and 100 KB observations returned 3,662,680 and
36,940,167 bytes, with combined RSS peaks of at least 142.3 and 483.1 MiB.
The earlier 250 KB test was interrupted by the external safety monitor at
1,006.1 MiB; it was not a completed response or a spontaneous process crash.
Request overhead differed by 38 bytes between the two measurement drivers.
