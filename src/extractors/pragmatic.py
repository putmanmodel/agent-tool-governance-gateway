import re
from typing import List
from ..evidence_budget import EvidenceBudget
from ..types.turn_packet import TurnPacket
from ..types.layer_output import LayerOutput
from ..types.evidence import EvidenceSpan

EXTRACTOR_VERSION = "pragmatic_v0.1"
ATTRIBUTION_METHOD_ID = "deterministic_phrase_rules"

# simple demand/command markers and ultimatum markers
DEMAND_PATTERNS = [
    r"\bdo it now\b",
    r"\bimmediately\b",
    r"\bright now\b",
    r"\byou need to\b",
    r"\byou must\b",
    r"\bno excuses\b",
    r"\bstop\b",
    r"\bnot asking\b",
]
ULTIMATUM_PATTERNS = [
    r"\bor else\b",
    r"\bif you don't\b",
    r"\blast chance\b",
]

def extract(packet: TurnPacket, budget=None) -> LayerOutput:
    budget = budget if budget is not None else EvidenceBudget()
    text = (packet.text or "").lower()
    n = max(len(text), 1)

    def hits(patterns):
        count, details = 0, []
        for pattern in patterns:
            for match in re.finditer(pattern, text):
                count += 1
                if len(details) < 10:
                    details.append((match.start(), match.end(), pattern))
        return count, details

    demand_count, demand_hits = hits(DEMAND_PATTERNS)
    ult_count, ult_hits = hits(ULTIMATUM_PATTERNS)
    budget.observed += demand_count + ult_count - len(demand_hits) - len(ult_hits)

    # score: demand + ultimatum weighted
    raw = 0.12 * demand_count + 0.22 * ult_count
    score = max(0.0, min(1.0, raw))

    # confidence: higher with explicit phrases
    confidence = max(0.20, min(1.0, 0.35 + 0.10 * min(demand_count, 4) + 0.15 * min(ult_count, 3) + 0.01 * min(n, 100)))

    evidence: List[EvidenceSpan] = []
    for s,e,p in (demand_hits[:10] + ult_hits[:10]):
        if not budget.admit():
            continue
        evidence.append(EvidenceSpan(
            span_id=f"{packet.turn_id}:prag:{s}",
            turn_id=packet.turn_id,
            layer_id="pragmatic",
            start=s, end=e,
            score=min(1.0, 0.55 if p in DEMAND_PATTERNS else 0.75),
            confidence=confidence,
            attribution_method_id=ATTRIBUTION_METHOD_ID,
            extractor_version=EXTRACTOR_VERSION,
            notes=f"Matched: {p}"
        ))

    return LayerOutput(layer_id="pragmatic", score=score, confidence=confidence, evidence=evidence)
