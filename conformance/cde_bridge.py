"""Harness-only batch adapter: one real, stateful CDE engine per fixture."""
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.engine import CDEEngine
from src.response import build_response
from src.types.turn_packet import TurnPacket

engine = CDEEngine(str(ROOT))
packets = json.load(sys.stdin)
json.dump([build_response(engine.process_turn(TurnPacket.model_validate(packet)))
           for packet in packets], sys.stdout)
