#!/usr/bin/env python3
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException

from src.engine import CDEEngine
from src.types.turn_packet import TurnPacket

REPO_ROOT = str(Path(__file__).resolve().parent)
app = FastAPI(title="CDE Service", version="1.0.0")
engines: Dict[str, CDEEngine] = {}


def _engine_for(session_id: str) -> CDEEngine:
    engine = engines.get(session_id)
    if engine is None:
        engine = CDEEngine(repo_root=REPO_ROOT)
        engines[session_id] = engine
    return engine


def _model_dump(model: Any) -> Dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump()
    return model.dict()


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


@app.post("/turn")
def turn(payload: Dict[str, Any]) -> Dict[str, Any]:
    try:
        session_id = str(payload.get("session_id") or "default")
        turn_payload = dict(payload)
        turn_payload.pop("session_id", None)

        if hasattr(TurnPacket, "model_validate"):
            packet = TurnPacket.model_validate(turn_payload)
        else:
            packet = TurnPacket.parse_obj(turn_payload)

        events = _engine_for(session_id).process_turn(packet)
        events_json = [_model_dump(e) for e in events]
        top_event = _choose_top_event(events_json)

        return {
            "events": events_json,
            "top_event": top_event,
            "decision": (top_event or {}).get("decision", {}),
            "baseline_hash": (top_event or {}).get("baseline_hash"),
            "extractor_versions": (top_event or {}).get("extractor_versions"),
        }
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc
