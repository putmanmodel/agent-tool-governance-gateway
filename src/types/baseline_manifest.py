from pydantic import BaseModel
from typing import Dict, Any

class BaselineSpec(BaseModel):
    # simple baseline per layer: mean and scale
    mu: float = 0.0
    sigma: float = 1.0

class BaselineManifest(BaseModel):
    manifest_version: str
    baseline_family_id: str
    parameter_version: str

    # EMA + hysteresis
    ema_beta: float
    theta_enter: float
    alpha_exit: float  # theta_exit = alpha_exit * theta_enter

    # layer weights (renormalized when layers missing)
    layer_weights: Dict[str, float]

    # missing-layer policy
    missing_layer_policy: str = "drop_and_renormalize"  # or "fail_closed"

    # confidence regime thresholds
    min_confidence: float = 0.35

    # baseline specs (per layer)
    baselines: Dict[str, BaselineSpec]

    # routing knobs (minimal for v0.1)
    routing: Dict[str, Any] = {}
