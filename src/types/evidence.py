from pydantic import BaseModel
from typing import List, Optional

class EvidenceSpan(BaseModel):
    span_id: str
    turn_id: str
    layer_id: str
    start: int
    end: int
    score: float
    confidence: float
    attribution_method_id: str
    extractor_version: str
    notes: Optional[str] = None
