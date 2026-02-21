import re
from typing import List
from ..types.turn_packet import TurnPacket
from ..types.layer_output import LayerOutput
from ..types.evidence import EvidenceSpan

EXTRACTOR_VERSION = "lexical_v0.1"
ATTRIBUTION_METHOD_ID = "deterministic_regex"

def _spans(pattern: str, text: str):
    for m in re.finditer(pattern, text):
        yield m.start(), m.end()

def extract(packet: TurnPacket) -> LayerOutput:
    text = packet.text or ""
    n = max(len(text), 1)

    # simple signals: exclamation density, ALLCAPS words, repeated punctuation
    exclam = text.count("!")
    question = text.count("?")
    caps_words = re.findall(r"\b[A-Z]{3,}\b", text)
    repeats = len(re.findall(r"([!?\.])\1{2,}", text))

    # score in [0,1] with soft caps
    raw = (exclam * 0.08) + (question * 0.04) + (len(caps_words) * 0.10) + (repeats * 0.15)
    score = max(0.0, min(1.0, raw))

    # confidence increases with length and presence of any signal
    signal = exclam + question + len(caps_words) + repeats
    confidence = max(0.15, min(1.0, 0.25 + 0.02 * min(n, 120) + 0.12 * min(signal, 6)))

    evidence: List[EvidenceSpan] = []
    # evidence spans: caps words, repeated punctuation runs
    for w in caps_words[:8]:
        idx = text.find(w)
        if idx >= 0:
            evidence.append(EvidenceSpan(
                span_id=f"{packet.turn_id}:lex:caps:{idx}",
                turn_id=packet.turn_id,
                layer_id="lexical",
                start=idx,
                end=idx+len(w),
                score=min(1.0, 0.6 + 0.05*len(w)),
                confidence=confidence,
                attribution_method_id=ATTRIBUTION_METHOD_ID,
                extractor_version=EXTRACTOR_VERSION,
                notes="ALLCAPS token"
            ))
    for s,e in _spans(r"([!?\.])\1{2,}", text):
        evidence.append(EvidenceSpan(
            span_id=f"{packet.turn_id}:lex:repeat:{s}",
            turn_id=packet.turn_id,
            layer_id="lexical",
            start=s, end=e,
            score=min(1.0, 0.7),
            confidence=confidence,
            attribution_method_id=ATTRIBUTION_METHOD_ID,
            extractor_version=EXTRACTOR_VERSION,
            notes="Repeated punctuation"
        ))

    return LayerOutput(layer_id="lexical", score=score, confidence=confidence, evidence=evidence)
