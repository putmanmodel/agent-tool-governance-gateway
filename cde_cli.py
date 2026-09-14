#!/usr/bin/env python3
import json
import sys
from pathlib import Path

from src.engine import CDEEngine
from src.types.turn_packet import TurnPacket
from src.response import build_response

REPO_ROOT = str(Path(__file__).resolve().parent)


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
        out = build_response(events)
        sys.stdout.write(json.dumps(out, separators=(",", ":")))
        sys.stdout.write("\n")
        return 0
    except Exception as exc:  # noqa: BLE001 - CLI needs broad failure handling
        sys.stderr.write(f"cde_cli error: {exc}\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
