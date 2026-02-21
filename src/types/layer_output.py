from pydantic import BaseModel
from typing import List
from .evidence import EvidenceSpan

class LayerOutput(BaseModel):
    layer_id: str
    score: float
    confidence: float
    evidence: List[EvidenceSpan]
