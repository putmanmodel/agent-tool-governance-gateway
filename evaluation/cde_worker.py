"""Private stdio transport; unchanged CDE engine, one engine per session.
No network listener and no ability to submit governance signals or reset state.
"""
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.engine import CDEEngine
from src.types.turn_packet import TurnPacket
from src.response import build_response

engines = {}
print(json.dumps({"ready": True}), flush=True)
for line in sys.stdin:
    try:
        payload = json.loads(line)
        session = payload.pop('session_id', 'default')
        if session not in engines:
            engines[session] = CDEEngine(str(Path(__file__).resolve().parents[1]))
        response = build_response(engines[session].process_turn(TurnPacket.model_validate(payload)))
        print(json.dumps({"result": response}), flush=True)
    except Exception:
        print(json.dumps({"error": "CDE evaluation failed"}), flush=True)
