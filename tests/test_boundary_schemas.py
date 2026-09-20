"""Opt-in boundary descriptions are checked against unchanged real producers."""
import copy
import json
from pathlib import Path
import subprocess
import unittest

from jsonschema import Draft202012Validator, FormatChecker
from src.types.governance_signal import DeviationSummary
from src.routing.route import evaluate_governance

ROOT = Path(__file__).resolve().parents[1]


class BoundarySchemaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.schemas = {}
        for path in (ROOT / 'schemas/v1').glob('*.schema.json'):
            schema = json.loads(path.read_text())
            Draft202012Validator.check_schema(schema)
            cls.schemas[schema['title']] = Draft202012Validator(schema, format_checker=FormatChecker())
        routing = json.loads((ROOT / 'manifests/global.json').read_text())['routing']
        cls.signals = [evaluate_governance('scene:scene', DeviationSummary(
            severity=severity, ema_severity=severity, confidence=confidence,
            active=active, enter=False, exit=False, vector={}), routing).model_dump()
            for severity, confidence, active in [(.1, 1, False), (.6, 1, True),
                (.8, 1, True), (.9, 1, True), (.6, .1, True)] + [(.1, 1, False)] * 6]
        cls.outputs = json.loads(subprocess.check_output(
            ['node', str(ROOT / 'tests/fixtures/boundary_stream.mjs'), json.dumps(cls.signals)], text=True))

    def test_actual_producers_match_all_four_schemas(self):
        self.assertEqual(len(self.schemas), 4)
        for signal in self.signals:
            self.schemas['CDEGovernanceSignal'].validate(signal)
        for decision in self.outputs['decisions']:
            self.schemas['AuthorityDecision'].validate(decision)
        self.schemas['AuthorityRequest'].validate(self.outputs['request'])
        self.schemas['CapabilityLease'].validate(self.outputs['lease'])

    def test_contracts_reject_missing_fields_and_unsupported_versions(self):
        examples = dict(CDEGovernanceSignal=self.signals[0],
                        AuthorityRequest=self.outputs['request'],
                        AuthorityDecision=self.outputs['decisions'][0],
                        CapabilityLease=self.outputs['lease'])
        for name, value in examples.items():
            validator = self.schemas[name]
            for field in validator.schema['required']:
                with self.subTest(name=name, missing=field):
                    bad = copy.deepcopy(value)
                    del bad[field]
                    self.assertFalse(validator.is_valid(bad))
            if 'schema_version' in value:
                self.assertFalse(validator.is_valid(dict(value, schema_version='2.0')))

    def test_cde_cannot_grant_authority_and_gate_fields_agree(self):
        validator = self.schemas['CDEGovernanceSignal']
        for field, value in [('allow', True), ('lease_token', 'grant'), ('outcome', 'allow')]:
            self.assertFalse(validator.is_valid(dict(self.signals[0], **{field: value})))
        for field, value in [('gate_label', 'LEASE REQUIRED'), ('reason_codes', ['LOW_CONFIDENCE']),
                             ('evidence_requirements', ['diff'])]:
            self.assertFalse(validator.is_valid(dict(self.signals[0], **{field: value})))
        self.assertFalse(self.schemas['AuthorityDecision'].is_valid(
            dict(self.outputs['decisions'][0], issuer='cde')))
        self.assertFalse(self.schemas['CapabilityLease'].is_valid(
            dict(self.outputs['lease'], issuer='gateway')))
