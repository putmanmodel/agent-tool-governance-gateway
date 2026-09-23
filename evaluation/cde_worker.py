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

# One evaluator owner per database. The OS releases flock on child exit, even
# after parent SIGKILL/pipe EOF. Never unlink the stable lock inode.
if len(sys.argv) > 1:
    import os
    import fcntl
    lock_fd = os.open(sys.argv[1], os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
engines = {}
print(json.dumps({"ready": True}), flush=True)
for line in sys.stdin:
    try:
        payload = json.loads(line)
        packet = TurnPacket.model_validate(payload)
        session = payload.pop('session_id', 'default')
        if session not in engines:
            engines[session] = CDEEngine(str(Path(__file__).resolve().parents[1]))
        response = build_response(engines[session].process_turn(packet))
        print(json.dumps({"result": response}), flush=True)
    except Exception:
        print(json.dumps({"error": "CDE evaluation failed"}), flush=True)
