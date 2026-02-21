from typing import List, Dict, Tuple

SCOPE_PRIORITY = {
    "scene": 4,
    "task": 3,
    "agent": 2,
    "global": 1,
}

def scope_priority(scope_key: str) -> int:
    if scope_key.startswith("scene:"):
        return SCOPE_PRIORITY["scene"]
    if scope_key.startswith("task:"):
        return SCOPE_PRIORITY["task"]
    if scope_key.startswith("agent:"):
        return SCOPE_PRIORITY["agent"]
    return SCOPE_PRIORITY["global"]

def rank_scopes(events: List[Dict]) -> List[Dict]:
    return sorted(
        events,
        key=lambda e: (e.get("severity", 0.0), e.get("confidence", 0.0), scope_priority(e.get("scope_key","global"))),
        reverse=True
    )
