#!/usr/bin/env python3
import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

from src.engine import CDEEngine
from src.types.turn_packet import TurnPacket

REPO_ROOT = str(Path(__file__).resolve().parent)


def _model_dump(model: Any) -> Dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump()  # pydantic v2
    return model.dict()  # pydantic v1


def _scope_priority(scope_key: str) -> int:
    if scope_key.startswith("scene:"):
        return 4
    if scope_key.startswith("task:"):
        return 3
    if scope_key.startswith("agent:"):
        return 2
    if scope_key == "global":
        return 1
    return 0


def _choose_top_event(events: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not events:
        return None
    return max(events, key=lambda e: (_scope_priority(str(e.get("scope_key", ""))), float(e.get("severity", 0.0))))


def main() -> int:
    try:
        raw = sys.stdin.read()
        if not raw.strip():
            raise ValueError("stdin must contain one JSON object")
        payload = json.loads(raw)
        if not isinstance(payload, dict):
            raise ValueError("input must be a JSON object")

        if hasattr(TurnPacket, "model_validate"):
            packet = TurnPacket.model_validate(payload)  # pydantic v2
        else:
            packet = TurnPacket.parse_obj(payload)  # pydantic v1

        engine = CDEEngine(repo_root=REPO_ROOT)
        events = engine.process_turn(packet)
        events_json = [_model_dump(e) for e in events]
        top_event = _choose_top_event(events_json)

        out = {
            "events": events_json,
            "top_event": top_event,
            "decision": (top_event or {}).get("decision", {}),
            "baseline_hash": (top_event or {}).get("baseline_hash"),
            "extractor_versions": (top_event or {}).get("extractor_versions"),
        }
        sys.stdout.write(json.dumps(out, separators=(",", ":")))
        sys.stdout.write("\n")
        return 0
    except Exception as exc:  # noqa: BLE001 - CLI needs broad failure handling
        sys.stderr.write(f"cde_cli error: {exc}\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
