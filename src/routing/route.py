from typing import Dict, Any

def route(severity: float, confidence: float, active: bool, manifest_routing: Dict[str, Any]) -> Dict[str, Any]:
    """Minimal routing policy for MVP.
    policy_gate_level: 0 normal, 1 dampen, 2 freeze_updates
    """
    if not active:
        return {"quarantine": False, "review_band": False, "policy_gate_level": 0}

    # default thresholds, can override from manifest.routing
    q = float(manifest_routing.get("quarantine_at", 0.85))
    r = float(manifest_routing.get("review_at", 0.60))
    freeze = float(manifest_routing.get("freeze_updates_at", 0.75))
    minc = float(manifest_routing.get("min_confidence_for_action", 0.35))

    if confidence < minc:
        return {"quarantine": False, "review_band": True, "policy_gate_level": 1, "note": "low_confidence"}

    if severity >= q:
        return {"quarantine": True, "review_band": True, "policy_gate_level": 2}
    if severity >= freeze:
        return {"quarantine": False, "review_band": True, "policy_gate_level": 2}
    if severity >= r:
        return {"quarantine": False, "review_band": True, "policy_gate_level": 1}

    return {"quarantine": False, "review_band": False, "policy_gate_level": 1}
