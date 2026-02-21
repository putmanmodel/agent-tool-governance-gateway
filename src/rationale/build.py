from typing import List, Dict, Any
from ..types.layer_output import LayerOutput
from ..types.evidence import EvidenceSpan

def collect_evidence(layers: List[LayerOutput]) -> List[EvidenceSpan]:
    ev: List[EvidenceSpan] = []
    for lo in layers:
        ev.extend(lo.evidence)
    return ev

def dominant_layers(dvec: Dict[str, float], top_n: int = 2) -> List[str]:
    return [k for k,_ in sorted(dvec.items(), key=lambda kv: kv[1], reverse=True)[:top_n]]
