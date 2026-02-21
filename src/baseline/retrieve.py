import json, os, hashlib
from typing import Tuple
from ..types.baseline_manifest import BaselineManifest

def _load(path: str) -> BaselineManifest:
    with open(path, "r", encoding="utf-8") as f:
        raw = f.read()
    data = json.loads(raw)
    manifest = BaselineManifest.model_validate(data)
    return manifest

def _hash_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            b = f.read(8192)
            if not b:
                break
            h.update(b)
    return h.hexdigest()

def retrieve_manifest(repo_root: str, scope_key: str) -> Tuple[BaselineManifest, str]:
    """Return (manifest, baseline_hash). For MVP we map all scopes to global.json unless overridden."""
    manifests_dir = os.path.join(repo_root, "manifests")
    # simple override lookup
    fname = "global.json"
    if scope_key.startswith("scene:") and os.path.exists(os.path.join(manifests_dir, "scene.json")):
        fname = "scene.json"
    if scope_key.startswith("task:") and os.path.exists(os.path.join(manifests_dir, "task.json")):
        fname = "task.json"
    if scope_key.startswith("agent:") and os.path.exists(os.path.join(manifests_dir, "agent.json")):
        fname = "agent.json"

    path = os.path.join(manifests_dir, fname)
    manifest = _load(path)
    return manifest, _hash_file(path)
