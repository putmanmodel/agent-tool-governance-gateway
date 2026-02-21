import os, json, time
from src.engine import CDEEngine
from src.types.turn_packet import TurnPacket
from src.audit.logger import AuditLogger

REPO_ROOT = os.path.dirname(os.path.abspath(__file__))

def load_jsonl(path):
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            yield json.loads(line)

def run_file(engine, logger, path):
    events = []
    for obj in load_jsonl(path):
        # ensure ts is real time-ish if missing
        if obj.get("ts", None) is None:
            obj["ts"] = time.time()
        pkt = TurnPacket.model_validate(obj)
        evts = engine.process_turn(pkt)
        for e in evts:
            logger.append(e.model_dump())
        events.extend(evts)
    return events

def summarize(events):
    """
    Returns a compact per-scope story:
      - peak severity and peak EMA
      - first enter turn (if any)
      - last exit turn (if any)
      - last known state (active, last ema/sev/conf)
    """
    by_scope = {}

    for e in events:
        s = by_scope.setdefault(e.scope_key, {
            "peak_severity": 0.0,
            "peak_ema": 0.0,
            "first_enter_turn": None,
            "first_enter_ts": None,
            "last_exit_turn": None,
            "last_exit_ts": None,
            "last": None,
        })

        # peaks
        if e.severity > s["peak_severity"]:
            s["peak_severity"] = e.severity
        if e.ema_severity > s["peak_ema"]:
            s["peak_ema"] = e.ema_severity

        # enter/exit markers
        if e.enter and s["first_enter_turn"] is None:
            s["first_enter_turn"] = e.turn_id
            s["first_enter_ts"] = e.ts

        if e.exit:
            s["last_exit_turn"] = e.turn_id
            s["last_exit_ts"] = e.ts

        # last state snapshot
        s["last"] = {
            "active": e.active,
            "ema_severity": e.ema_severity,
            "severity": e.severity,
            "confidence": e.confidence,
            "dominant_layers": e.dominant_layers,
            "decision": e.decision,
            "turn_id": e.turn_id,
        }

    # flatten for JSON output
    out = {}
    for scope, s in by_scope.items():
        out[scope] = {
            "peak_severity": round(s["peak_severity"], 6),
            "peak_ema": round(s["peak_ema"], 6),
            "first_enter_turn": s["first_enter_turn"],
            "last_exit_turn": s["last_exit_turn"],
            **(s["last"] or {}),
        }
    return out

def main():
    engine = CDEEngine(repo_root=REPO_ROOT)
    logger = AuditLogger(os.path.join(REPO_ROOT, "logs", "cde_audit.jsonl"))

    all_events = []
    all_events += run_file(engine, logger, os.path.join(REPO_ROOT, "demo", "ramp_test.jsonl"))
   # all_events += run_file(engine, logger, os.path.join(REPO_ROOT, "demo", "scope_test.jsonl"))

    summary = summarize(all_events)
    out_path = os.path.join(REPO_ROOT, "logs", "last_run_summary.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)

    print("Wrote: logs/cde_audit.jsonl")
    print("Wrote: logs/last_run_summary.json")
    print("\nLast scope states:")
    for k,v in summary.items():
        print(f"- {k}: active={v['active']} ema={v['ema_severity']:.3f} sev={v['severity']:.3f} conf={v['confidence']:.3f} decision={v['decision']}")

if __name__ == "__main__":
    main()
