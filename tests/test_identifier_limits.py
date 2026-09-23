import json
from pathlib import Path
import unittest
from unittest.mock import patch
from pydantic import ValidationError
import cde_service
from src.engine import CDEEngine
from src.response import build_response
from src.types.turn_packet import TurnPacket
from src.types.identifier_limits import IDENTIFIER_LIMITS

ROOT = Path(__file__).resolve().parents[1]
BASE = dict(turn_id='normal-id', ts=1, speaker_id='actor', channel_id='channel',
            scene_id='scene', task_id='task', text='!!! ' * 128)


class IdentifierLimitTests(unittest.TestCase):
    def test_each_identifier_accepts_byte_boundary_and_rejects_overflow(self):
        for name, limit in IDENTIFIER_LIMITS.items():
            for value in ('a' * limit, 'é' * (limit // 2)):
                with self.subTest(name=name, bytes=len(value.encode())):
                    TurnPacket.model_validate({**BASE, name: value})
                    with self.assertRaises(ValidationError):
                        TurnPacket.model_validate({**BASE, name: value + 'a'})

    def test_hostile_turn_id_rejected_before_engine_and_session_creation(self):
        with patch.object(cde_service, '_engine_for') as create:
            for size in (129, 4096):
                with self.assertRaises(cde_service.HTTPException) as caught:
                    cde_service.turn({**BASE, 'turn_id': 'x' * size})
                self.assertEqual(caught.exception.status_code, 400)
            create.assert_not_called()

    def test_worst_escaped_identifiers_still_bound_count_and_serialized_size(self):
        for char in ('x', '\x01', 'é'):
            data = {**BASE, **{name: char * (limit // len(char.encode()))
                              for name, limit in IDENTIFIER_LIMITS.items()}}
            response = build_response(CDEEngine(str(ROOT)).process_turn(TurnPacket.model_validate(data)))
            self.assertEqual(len(response['events']), 4)
            self.assertTrue(all(len(e['evidence']) == 128 for e in response['events']))
            # Includes JSON escaping and all four scopes plus top_event.
            self.assertLess(len(json.dumps(response).encode()), 1300000)

    def test_accepted_turn_id_changes_only_identity_not_governance(self):
        outputs = []
        for value in ('short', 'x' * 128):
            response = build_response(CDEEngine(str(ROOT)).process_turn(TurnPacket(**{**BASE, 'turn_id': value})))
            rows = response['events']
            for row in rows:
                for key in ('turn_id', 'event_id', 'evidence'):
                    row.pop(key)
            outputs.append(rows)
        self.assertEqual(*outputs)

    def test_schema_advertises_byte_constraints_and_limits_cannot_be_overridden(self):
        schema = TurnPacket.model_json_schema()['properties']
        for name, limit in IDENTIFIER_LIMITS.items():
            if name in schema:
                self.assertEqual(schema[name]['x-maxUtf8Bytes'], limit)
        with self.assertRaises(ValidationError):
            TurnPacket.model_validate({**BASE, 'turn_id': 'x' * 4096,
                                      'policy_state': {'turn_id_limit': 100000}})

    def test_limits_definition_shape_values_and_immutable_copy(self):
        from src.types.identifier_limits import validate_limits_definition
        def valid():
            return dict(schema_version='1.0', max_utf8_bytes=dict(IDENTIFIER_LIMITS))
        for value in (None, [], {}, {**valid(), 'schema_version': '2.0'},
                      {**valid(), 'extra': True}, {**valid(), 'max_utf8_bytes': []}):
            with self.assertRaises(ValueError):
                validate_limits_definition(value)
        for name in IDENTIFIER_LIMITS:
            missing = valid()
            del missing['max_utf8_bytes'][name]
            with self.assertRaises(ValueError):
                validate_limits_definition(missing)
            for value in ('256', 0, -1, float('nan'), float('inf'), -float('inf'),
                          True, None, {}, [], 1.5, 9007199254740992):
                bad = valid()
                bad['max_utf8_bytes'][name] = value
                with self.subTest(name=name, value=value), self.assertRaises(ValueError):
                    validate_limits_definition(bad)
        extra = valid()
        extra['max_utf8_bytes']['other'] = 256
        with self.assertRaises(ValueError):
            validate_limits_definition(extra)
        source = valid()
        loaded = validate_limits_definition(source)
        source['max_utf8_bytes']['turn_id'] = 999
        self.assertEqual(loaded['turn_id'], 128)
        with self.assertRaises(TypeError):
            loaded['turn_id'] = 999
        integral = valid()
        integral['max_utf8_bytes']['turn_id'] = 128.0
        self.assertEqual(validate_limits_definition(integral)['turn_id'], 128)
