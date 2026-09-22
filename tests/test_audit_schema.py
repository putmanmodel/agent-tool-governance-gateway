"""Product events are separate from frozen legacy operational records."""
import copy
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from jsonschema import Draft202012Validator, FormatChecker
from src.audit.logger import AuditLogger

ROOT = Path(__file__).resolve().parents[1]

class AuditSchemaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        schema = json.loads((ROOT / 'schemas/audit/v1/GovernanceEvent.schema.json').read_text())
        Draft202012Validator.check_schema(schema)
        cls.validator = Draft202012Validator(schema, format_checker=FormatChecker())
        review_schema = json.loads((ROOT / 'schemas/audit/v2/GovernanceReviewEvent.schema.json').read_text())
        Draft202012Validator.check_schema(review_schema)
        cls.review_validator = Draft202012Validator(review_schema, format_checker=FormatChecker())
        cls.events = json.loads(subprocess.check_output(
            ['node', str(ROOT / 'tests/fixtures/audit_stream.mjs')], text=True))

    def test_real_runtime_events_validate_and_have_order(self):
        for event in self.events:
            (self.review_validator if event['schema_version'] == '2.0' else self.validator).validate(event)
        self.assertEqual([e['sequence'] for e in self.events], list(range(1, len(self.events) + 1)))
        self.assertEqual(len({e['event_id'] for e in self.events}), len(self.events))

    def test_schema_rejects_malformed_unknown_or_secret_fields(self):
        for change in [dict(schema_version='2.0'), dict(event_type='review.approved'),
                       dict(lease_token='secret'), dict(lease_check='invalid'), dict(sequence=0),
                       dict(requirements={'arbitrary': True}), dict(context={'fake': 'context'})]:
            event = copy.deepcopy(self.events[0]); event.update(change)
            self.assertFalse(self.validator.is_valid(event), change)
        for key in self.validator.schema['required']:
            event = copy.deepcopy(self.events[0]); del event[key]
            self.assertFalse(self.validator.is_valid(event), key)

    def test_full_review_lifecycle_uses_separate_versioned_schema(self):
        events = json.loads(subprocess.check_output(
            ['node', str(ROOT / 'tests/fixtures/review_audit_stream.mjs')], text=True))
        reviews = [e for e in events if e['schema_version'] == '2.0']
        self.assertEqual({e['event_type'] for e in reviews}, {
            'review.requested', 'review.approved', 'review.denied', 'review.invalidated',
            'review.execution_authorized', 'review.execution_consumed'})
        for event in reviews:
            self.review_validator.validate(event)
            self.assertFalse(self.validator.is_valid(event))
            for key in self.review_validator.schema['required']:
                bad = copy.deepcopy(event); del bad[key]
                self.assertFalse(self.review_validator.is_valid(bad), key)
            bad = dict(event, bearer_token='secret')
            self.assertFalse(self.review_validator.is_valid(bad))

    def test_execution_receipts_have_versioned_schema_and_all_real_transitions(self):
        schema = json.loads((ROOT / 'schemas/audit/v3/GovernanceExecutionEvent.schema.json').read_text())
        Draft202012Validator.check_schema(schema)
        validator = Draft202012Validator(schema, format_checker=FormatChecker())
        events = json.loads(subprocess.check_output(
            ['node', str(ROOT / 'tests/fixtures/execution_audit_stream.mjs')], text=True))
        execution_events = [e for e in events if e['schema_version'] == '3.0']
        self.assertEqual({e['event_type'] for e in execution_events}, {
            'tool.execution.' + status for status in ['started', 'succeeded', 'failed', 'unknown',
                'reconciled_succeeded', 'reconciled_failed', 'reconciliation_required']})
        for event in execution_events:
            validator.validate(event)
            self.assertFalse(self.validator.is_valid(event))
            for key in schema['required']:
                bad = copy.deepcopy(event); del bad[key]
                self.assertFalse(validator.is_valid(bad), key)
            self.assertFalse(validator.is_valid(dict(event, raw_output='secret')))
            self.assertIsNotNone(event['evaluation_id'])
            self.assertIsNotNone(event['decision_id'])

    def test_existing_jsonl_writer_and_legacy_cde_records_coexist_with_product_events(self):
        frozen = json.loads((ROOT / 'tests/legacy_events.json').read_text())
        self.assertEqual(len(frozen), 32)
        with tempfile.TemporaryDirectory() as directory:
            legacy = Path(directory) / 'legacy_cde.jsonl'
            product = Path(directory) / 'product.jsonl'
            logger = AuditLogger(str(legacy))
            for record in frozen:
                logger.append(record)
            before = legacy.read_bytes()
            product.write_text(''.join(json.dumps(event) + '\n' for event in self.events))
            self.assertEqual(legacy.read_bytes(), before)
            self.assertEqual(before, ''.join(json.dumps(row, ensure_ascii=False) + '\n'
                                             for row in frozen).encode('utf-8'))
            self.assertEqual([json.loads(line) for line in legacy.read_text().splitlines()], frozen)
            for row in frozen:
                self.assertNotIn('request_id', row)
                self.assertNotIn('principal_id', row)
                self.assertNotIn('schema_version', row)
