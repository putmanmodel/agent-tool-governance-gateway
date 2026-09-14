"""CDE gate assignment; this module neither checks nor grants authority."""
from typing import Dict, Any
from ..types.governance_signal import GovernanceSignal, DeviationSummary, AuthorityRequirement


def _evaluate(severity, confidence, active, routing):
    # Preserve the original branch order, thresholds, and hysteresis dependence.
    if not active:
        return 0, False, False, "DEVIATION_INACTIVE"
    q = float(routing.get("quarantine_at", 0.85))
    r = float(routing.get("review_at", 0.60))
    freeze = float(routing.get("freeze_updates_at", 0.75))
    minc = float(routing.get("min_confidence_for_action", 0.35))
    if confidence < minc:
        return 1, False, True, "LOW_CONFIDENCE"
    if severity >= q:
        return 2, True, True, "QUARANTINE_THRESHOLD_REACHED"
    if severity >= freeze:
        return 2, False, True, "LEASE_THRESHOLD_REACHED"
    if severity >= r:
        return 1, False, True, "REVIEW_THRESHOLD_REACHED"
    return 1, False, False, "DEVIATION_PERSISTING"


def route(severity: float, confidence: float, active: bool, manifest_routing: Dict[str, Any]) -> Dict[str, Any]:
    """Legacy audit projection. Flags are recommendations, never enforcement."""
    gate, quarantine, review, reason = _evaluate(severity, confidence, active, manifest_routing)
    decision = {"quarantine": quarantine, "review_band": review, "policy_gate_level": gate}
    if reason == "LOW_CONFIDENCE":
        decision["note"] = "low_confidence"
    return decision


def evaluate_governance(scope_key: str, deviation: DeviationSummary, manifest_routing: Dict[str, Any]) -> GovernanceSignal:
    gate, _, _, reason = _evaluate(deviation.severity, deviation.confidence, deviation.active, manifest_routing)
    return GovernanceSignal(
        scope_key=scope_key,
        deviation=deviation,
        gate=gate,
        gate_label=("PASS", "EVIDENCE REQUIRED", "LEASE REQUIRED")[gate],
        evidence_requirements=["dry_run", "diff"] if gate == 1 else [],
        reason_codes=[reason],
        authority=AuthorityRequirement(
            requirement="lease" if gate == 2 else "none",
            recommendation="request_external_lease" if gate == 2 else "none",
        ),
    )
