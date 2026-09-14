"""Shared transport projection, preserving scene > task > agent > global."""
from typing import Any, Dict, List, Optional


def _scope_priority(scope_key: str) -> int:
    for prefix, priority in (("scene:", 4), ("task:", 3), ("agent:", 2)):
        if scope_key.startswith(prefix):
            return priority
    return 1 if scope_key == "global" else 0


def choose_top_event(events: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    return max(events, key=lambda e: (_scope_priority(e["scope_key"]), e["severity"]), default=None)


def build_response(events) -> Dict[str, Any]:
    serialized = [event.model_dump() for event in events]
    top = choose_top_event(serialized)
    return {
        "events": serialized,
        "top_event": top,
        "governance_signal": (top or {}).get("governance_signal"),
        "decision": (top or {}).get("decision", {}),
        "baseline_hash": (top or {}).get("baseline_hash"),
        "extractor_versions": (top or {}).get("extractor_versions"),
    }
