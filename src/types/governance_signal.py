"""Versioned evaluation contract. Requirements are not authority grants."""
from typing import Dict, List, Literal
from pydantic import BaseModel


class DeviationSummary(BaseModel):
    severity: float
    ema_severity: float
    confidence: float
    active: bool
    enter: bool
    exit: bool
    vector: Dict[str, float]


class AuthorityRequirement(BaseModel):
    requirement: Literal["none", "lease"]
    recommendation: Literal["none", "request_external_lease"]


class GovernanceSignal(BaseModel):
    schema_version: Literal["1.0"] = "1.0"
    scope_key: str
    deviation: DeviationSummary
    gate: Literal[0, 1, 2]
    gate_label: Literal["PASS", "EVIDENCE REQUIRED", "LEASE REQUIRED"]
    evidence_requirements: List[Literal["dry_run", "diff"]]
    reason_codes: List[Literal[
        "DEVIATION_INACTIVE", "LOW_CONFIDENCE", "QUARANTINE_THRESHOLD_REACHED",
        "LEASE_THRESHOLD_REACHED", "REVIEW_THRESHOLD_REACHED", "DEVIATION_PERSISTING",
    ]]
    authority: AuthorityRequirement
