from typing import Dict, Tuple, List
from ..types.baseline_manifest import BaselineManifest
from ..types.layer_output import LayerOutput

def compute_deviation_vector(manifest: BaselineManifest, layers: List[LayerOutput]) -> Tuple[Dict[str, float], Dict[str, float]]:
    """Return (deviation per layer, confidence per layer). Uses z-like distance from baseline mu."""
    d: Dict[str, float] = {}
    c: Dict[str, float] = {}
    for lo in layers:
        if lo.layer_id not in manifest.baselines:
            continue
        b = manifest.baselines[lo.layer_id]
        sigma = max(float(b.sigma), 1e-6)
        # normalized distance
        dv = abs(float(lo.score) - float(b.mu)) / sigma
        d[lo.layer_id] = float(dv)
        c[lo.layer_id] = float(lo.confidence)
    return d, c

def aggregate_severity(manifest: BaselineManifest, dvec: Dict[str, float]) -> float:
    # weighted L2 then squashed to [0,1] via 1-exp(-x)
    weights = manifest.layer_weights
    present = [k for k in dvec.keys() if k in weights]
    if not present:
        return 0.0
    wsum = sum(weights[k] for k in present) or 1.0
    # renormalize
    acc = 0.0
    for k in present:
        w = weights[k] / wsum
        acc += w * (dvec[k] ** 2)
    # squash
    import math
    return float(1.0 - math.exp(-acc))

def aggregate_confidence(manifest: BaselineManifest, conf: Dict[str, float]) -> float:
    weights = manifest.layer_weights
    present = [k for k in conf.keys() if k in weights]
    if not present:
        return 0.0
    wsum = sum(weights[k] for k in present) or 1.0
    acc = 0.0
    for k in present:
        acc += (weights[k]/wsum) * float(conf[k])
    return float(acc)
