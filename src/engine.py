import os, time, uuid
from typing import List, Dict, Any, Optional

from .types.turn_packet import TurnPacket
from .types.deviation_event import DeviationEvent
from .extractors.lexical import extract as extract_lexical, EXTRACTOR_VERSION as LEX_VER
from .extractors.pragmatic import extract as extract_pragmatic, EXTRACTOR_VERSION as PRAG_VER
from .baseline.retrieve import retrieve_manifest
from .compute.deviation import compute_deviation_vector, aggregate_severity, aggregate_confidence
from .event.ema_hysteresis import EMAHysteresis
from .rationale.build import collect_evidence, dominant_layers
from .routing.route import route

class CDEEngine:
    def __init__(self, repo_root: str):
        self.repo_root = repo_root
        # for MVP: single EMA/hysteresis machine per scope key, parameterized per-scope from manifest each step
        self._machines: Dict[str, EMAHysteresis] = {}

    def _machine_for(self, scope_key: str, beta: float, theta_enter: float, alpha_exit: float) -> EMAHysteresis:
        m = self._machines.get(scope_key)
        if m is None:
            m = EMAHysteresis(beta=beta, theta_enter=theta_enter, alpha_exit=alpha_exit)
            self._machines[scope_key] = m
        else:
            # keep state but allow knobs to update deterministically if manifest changes
            m.beta = float(beta)
            m.theta_enter = float(theta_enter)
            m.theta_exit = float(alpha_exit) * float(theta_enter)
        return m

    def process_turn(self, packet: TurnPacket, scope_keys: Optional[List[str]] = None) -> List[DeviationEvent]:
        scope_keys = scope_keys or self.default_scopes(packet)

        # extract layers once per turn (constraint-accessible)
        layers = [extract_lexical(packet), extract_pragmatic(packet)]
        extractor_versions = {"lexical": LEX_VER, "pragmatic": PRAG_VER}

        events: List[DeviationEvent] = []
        for scope_key in scope_keys:
            manifest, baseline_hash = retrieve_manifest(self.repo_root, scope_key)

            # compute deviations relative to this scope baseline
            dvec, conf_by_layer = compute_deviation_vector(manifest, layers)
            severity = aggregate_severity(manifest, dvec)
            confidence = aggregate_confidence(manifest, conf_by_layer)

            # enforce manifest minimum confidence policy (for gating actions; still log severity)
            machine = self._machine_for(scope_key, manifest.ema_beta, manifest.theta_enter, manifest.alpha_exit)
            st = machine.step(scope_key, severity)

            decision = route(severity=severity, confidence=confidence, active=st.active, manifest_routing=manifest.routing or {})
            evidence = collect_evidence(layers)

            evt = DeviationEvent(
                event_id=str(uuid.uuid4()),
                ts=packet.ts,
                scope_key=scope_key,
                enter=bool(getattr(st, "enter", False)),
                exit=bool(getattr(st, "exit", False)),
                active=bool(st.active),
                severity=float(severity),
                ema_severity=float(st.ema),
                confidence=float(confidence),
                deviation_vector={k: float(v) for k,v in dvec.items()},
                dominant_layers=dominant_layers(dvec),
                manifest_version=manifest.manifest_version,
                baseline_family_id=manifest.baseline_family_id,
                parameter_version=manifest.parameter_version,
                baseline_hash=baseline_hash,
                extractor_versions=extractor_versions,
                evidence=evidence,
                decision=decision,
                turn_id=packet.turn_id,
                speaker_id=packet.speaker_id,
                channel_id=packet.channel_id,
                task_id=packet.task_id,
                scene_id=packet.scene_id,
            )
            events.append(evt)

        return events

    def default_scopes(self, packet: TurnPacket) -> List[str]:
        scopes = ["global", f"agent:{packet.speaker_id}"]
        if packet.task_id:
            scopes.append(f"task:{packet.task_id}")
        if packet.scene_id:
            scopes.append(f"scene:{packet.scene_id}")
        return scopes
