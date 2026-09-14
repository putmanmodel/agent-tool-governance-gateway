import json
from pathlib import Path
import subprocess
import sys
import unittest

from src.engine import CDEEngine
from src.types.turn_packet import TurnPacket
from src.types.governance_signal import DeviationSummary
from src.routing.route import evaluate_governance
from src.response import build_response, choose_top_event
import cde_service

ROOT = Path(__file__).resolve().parents[1]


class GovernanceTests(unittest.TestCase):
    def test_original_demo_events_unchanged(self):
        engine = CDEEngine(str(ROOT))
        actual = []
        for name in ('ramp_test', 'scope_test'):
            for line in (ROOT / 'demo' / f'{name}.jsonl').read_text().splitlines():
                for event in engine.process_turn(TurnPacket.model_validate_json(line)):
                    row = event.model_dump()
                    signal = row.pop('governance_signal')
                    self.assertEqual(signal['gate'], row['decision']['policy_gate_level'])
                    self.assertEqual(signal['deviation']['ema_severity'], row['ema_severity'])
                    row.pop('event_id')
                    actual.append(row)
        self.assertEqual(actual, json.loads((ROOT / 'tests/legacy_events.json').read_text()))

    def test_boundaries_and_confidence_precedence(self):
        cases = [
            (1, 1, False, 0, 'DEVIATION_INACTIVE'),
            (.99, .349, True, 1, 'LOW_CONFIDENCE'),
            (.88, .35, True, 2, 'QUARANTINE_THRESHOLD_REACHED'),
            (.72, 1, True, 2, 'LEASE_THRESHOLD_REACHED'),
            (.719999, 1, True, 1, 'REVIEW_THRESHOLD_REACHED'),
            (.55, 1, True, 1, 'REVIEW_THRESHOLD_REACHED'),
            (.549999, 1, True, 1, 'DEVIATION_PERSISTING'),
        ]
        routing = json.loads((ROOT / 'manifests/global.json').read_text())['routing']
        for severity, confidence, active, gate, reason in cases:
            with self.subTest(severity=severity, confidence=confidence, active=active):
                signal = evaluate_governance('global', DeviationSummary(
                    severity=severity, confidence=confidence, active=active,
                    ema_severity=.5, enter=False, exit=False, vector={}), routing)
                self.assertEqual(signal.gate, gate)
                self.assertEqual(signal.reason_codes, [reason])
                self.assertEqual(signal.evidence_requirements, ['dry_run', 'diff'] if gate == 1 else [])
                self.assertEqual(signal.authority.requirement, 'lease' if gate == 2 else 'none')
                self.assertNotIn('allow', signal.model_dump())

    def test_service_session_persistence_and_cli_contract(self):
        cde_service.engines.clear()
        packet = dict(turn_id='test', ts=1, speaker_id='s', channel_id='c', text='DO IT NOW!!! OR ELSE!!!')
        first = cde_service.turn(dict(packet, session_id='a'))
        second = cde_service.turn(dict(packet, session_id='a'))
        isolated = cde_service.turn(dict(packet, session_id='b'))
        self.assertGreater(second['top_event']['ema_severity'], first['top_event']['ema_severity'])
        self.assertEqual(first['governance_signal'], isolated['governance_signal'])
        cli = subprocess.run([sys.executable, str(ROOT / 'cde_cli.py')], input=json.dumps(packet), text=True, capture_output=True, check=True)
        self.assertEqual(json.loads(cli.stdout)['governance_signal'], first['governance_signal'])
        self.assertEqual(first['governance_signal'], first['top_event']['governance_signal'])

    def test_scope_precedence_preserved(self):
        scene = {'scope_key': 'scene:s', 'severity': .1}
        self.assertEqual(choose_top_event([{'scope_key': 'global', 'severity': .99}, scene]), scene)
        self.assertIsNone(build_response([])['governance_signal'])


if __name__ == '__main__':
    unittest.main()
