from pydantic import BaseModel
from typing import Dict, List, Optional, Any
from .evidence import EvidenceSpan

class DeviationEvent(BaseModel):
    event_id: str
    ts: float

    scope_key: str  # e.g. "global", "agent:NPC_1", "task:T1", "scene:S1"
    enter: bool
    exit: bool
    active: bool

    severity: float
    ema_severity: float
    confidence: float

    deviation_vector: Dict[str, float]  # per layer
    dominant_layers: List[str]

    # provenance
    manifest_version: str
    baseline_family_id: str
    parameter_version: str
    baseline_hash: str
    extractor_versions: Dict[str, str]

    # evidence
    evidence: List[EvidenceSpan]

    # routing (minimal)
    decision: Dict[str, Any]

    # references
    turn_id: str
    speaker_id: str
    channel_id: str
    task_id: Optional[str] = None
    scene_id: Optional[str] = None
