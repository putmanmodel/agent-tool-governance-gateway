import json
from pathlib import Path
import unittest
from unittest.mock import patch

from src.engine import CDEEngine
from src.evidence_budget import EvidenceBudget, MAX_EVIDENCE_SPANS
from src.response import build_response
from src.types.turn_packet import TurnPacket

ROOT = Path(__file__).resolve().parents[1]


def packet(text):
    return TurnPacket(turn_id='budget', ts=1, speaker_id='evaluator', channel_id='tools',
                      scene_id='sandbox', text=text, policy_state={'evidence_limit': 999999})


class EvidenceBudgetTests(unittest.TestCase):
    def test_large_input_is_bounded_and_counts_all_matches(self):
        events = CDEEngine(str(ROOT)).process_turn(packet('!!! ' * 62500))
        response = build_response(events)
        for event in response['events']:
            self.assertEqual(len(event['evidence']), MAX_EVIDENCE_SPANS)
            self.assertEqual(event['evidence_budget'], dict(limit=128, observed=62500,
                             retained=128, omitted=62372, truncated=True))
            self.assertEqual(event['governance_signal']['gate'], 2)
        self.assertLess(len(json.dumps(response)), 200000)

    def test_truncation_does_not_change_any_governance_computation(self):
        # Unlimited oracle changes detail admission only, never scoring/routing.
        def unlimited(budget, eligible=True):
            budget.observed += 1
            budget.retained += int(eligible)
            return eligible
        for text in ('!!! ' * 200, 'STOP !!! or else ' * 200, 'ABC ' * 200):
            bounded = CDEEngine(str(ROOT))
            original = CDEEngine(str(ROOT))
            for observation in (text, '.', 'please help'):
                actual = bounded.process_turn(packet(observation))
                with patch.object(EvidenceBudget, 'admit', unlimited):
                    expected = original.process_turn(packet(observation))
                for a, b in zip(actual, expected):
                    left, right = a.model_dump(), b.model_dump()
                    for row in (left, right):
                        for key in ('event_id', 'evidence', 'evidence_budget'):
                            row.pop(key, None)
                    self.assertEqual(left, right)

    def test_pragmatic_and_caps_counts_are_bounded_too(self):
        event = CDEEngine(str(ROOT)).process_turn(packet('STOP immediately or else !!! ' * 25000))[0]
        self.assertLessEqual(len(event.evidence), 128)
        self.assertEqual(event.evidence_budget['observed'], 125000)
        self.assertEqual(event.evidence_budget['omitted'], 125000 - len(event.evidence))

    def test_small_observation_keeps_legacy_shape(self):
        event = CDEEngine(str(ROOT)).process_turn(packet('STOP!!!'))[0].model_dump()
        self.assertNotIn('evidence_budget', event)
        self.assertEqual(len(event['evidence']), 3)
