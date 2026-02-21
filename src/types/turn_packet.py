from pydantic import BaseModel, Field
from typing import Optional, Dict, Any

class TurnPacket(BaseModel):
    turn_id: str
    ts: float
    speaker_id: str
    channel_id: str
    text: str

    # optional scope keys
    task_id: Optional[str] = None
    scene_id: Optional[str] = None
    policy_state: Optional[Dict[str, Any]] = None
