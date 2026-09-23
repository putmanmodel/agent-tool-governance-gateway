from pydantic import BaseModel, Field, model_validator
from typing import Optional, Dict, Any
from .identifier_limits import IDENTIFIER_LIMITS, validate_identifiers

def identifier_field(name, **kwargs):
    maximum = IDENTIFIER_LIMITS[name]
    return Field(max_length=maximum, json_schema_extra={"x-maxUtf8Bytes": maximum}, **kwargs)

class TurnPacket(BaseModel):
    turn_id: str = identifier_field("turn_id")
    ts: float
    speaker_id: str = identifier_field("speaker_id")
    channel_id: str = identifier_field("channel_id")
    text: str

    # optional scope keys
    task_id: Optional[str] = identifier_field("task_id", default=None)
    scene_id: Optional[str] = identifier_field("scene_id", default=None)
    policy_state: Optional[Dict[str, Any]] = None

    @model_validator(mode="before")
    @classmethod
    def bounded_identifiers(cls, value):
        return validate_identifiers(value)
