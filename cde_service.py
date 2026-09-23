#!/usr/bin/env python3
from pathlib import Path
from typing import Any, Dict

from fastapi import FastAPI, HTTPException

from src.engine import CDEEngine
from src.types.turn_packet import TurnPacket
from src.types.identifier_limits import validate_identifiers
from src.response import build_response

REPO_ROOT = str(Path(__file__).resolve().parent)
app = FastAPI(title="CDE Service", version="1.0.0")
engines: Dict[str, CDEEngine] = {}


def _engine_for(session_id: str) -> CDEEngine:
    engine = engines.get(session_id)
    if engine is None:
        engine = CDEEngine(repo_root=REPO_ROOT)
        engines[session_id] = engine
    return engine


@app.post("/turn")
def turn(payload: Dict[str, Any]) -> Dict[str, Any]:
    try:
        validate_identifiers(payload)
        session_id = str(payload.get("session_id") or "default")
        turn_payload = dict(payload)
        turn_payload.pop("session_id", None)

        if hasattr(TurnPacket, "model_validate"):
            packet = TurnPacket.model_validate(turn_payload)
        else:
            packet = TurnPacket.parse_obj(turn_payload)

        events = _engine_for(session_id).process_turn(packet)
        return build_response(events)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc
