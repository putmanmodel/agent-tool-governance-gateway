"""Paper 9 specification checks plus the separate harness sample artifact.

Structural exemplars below test the exact-key check and generic JSONL writer.
They are not records emitted by a Paper 9 demo and do not establish conformance
of the existing CDE/gateway operational streams.
"""
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

from src.audit.logger import AuditLogger
from src.engine import CDEEngine
from src.types.turn_packet import TurnPacket

ROOT = Path(__file__).resolve().parents[1]
SPECIFICATION = json.loads((ROOT / 'tests/fixtures/paper9_contract.json').read_text())
PAPER9_KEYS = frozenset({
    'decision', 'demo_id', 'evidence', 'fixture_hash', 'fixture_path',
    'mode', 'normative_ids', 'pass', 'rationale', 'timestamp_utc',
})


def require_exact_paper9_keys(record):
    actual = set(record)
    if actual != PAPER9_KEYS:
        raise ValueError(f'Paper 9 keys: missing={sorted(PAPER9_KEYS - actual)}, '
                         f'extra={sorted(actual - PAPER9_KEYS)}')


class Paper9EnvelopeVerificationTests(unittest.TestCase):
    def exemplar(self):
        # Nulls are test-only sentinels for key checking, not factual values or
        # a valid Paper 9 instance. No missing fixture/normative data is invented.
        return dict.fromkeys(sorted(PAPER9_KEYS))

    def test_specification_fixture_matches_paper9_sections_3_and_4_exactly(self):
        self.assertEqual(set(SPECIFICATION['exact_keys']), PAPER9_KEYS)
        self.assertEqual(len(SPECIFICATION['exact_keys']), 10)
        self.assertEqual(SPECIFICATION['canonical_decisions'], [
            'ALLOW', 'REVIEW', 'DENY', 'FLAG_PROJECTION',
            'REJECT_OR_FLAG_PROJECTION', 'QUARANTINE', 'ESCALATE'])

    def test_exact_key_check_rejects_each_missing_key_and_every_extra_key(self):
        record = self.exemplar()
        require_exact_paper9_keys(record)
        self.assertEqual(set(record), PAPER9_KEYS)
        for key in PAPER9_KEYS:
            with self.subTest(missing=key):
                incomplete = dict(record); del incomplete[key]
                with self.assertRaises(ValueError):
                    require_exact_paper9_keys(incomplete)
        for key in ['event_id', 'principal_id', 'schema_version', 'request_id',
                    'sequence', 'arbitrary_product_field']:
            with self.subTest(extra=key), self.assertRaises(ValueError):
                require_exact_paper9_keys(dict(record, **{key: {'anything': True}}))

    def test_generic_writer_preserves_exact_structural_exemplar_and_decision(self):
        record = self.exemplar()
        decision = SPECIFICATION['canonical_decisions'][0]  # vocabulary example, not an observed outcome
        record['decision'] = copy.deepcopy(decision)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'structural_exemplar.jsonl'
            AuditLogger(str(path)).append(record)
            actual = json.loads(path.read_text())
        require_exact_paper9_keys(actual)
        self.assertEqual(set(actual), PAPER9_KEYS)
        self.assertEqual(actual['decision'], decision)
        self.assertEqual(actual, record)

    def test_separate_product_extensions_cannot_change_structural_exemplar_output(self):
        events = json.loads(subprocess.check_output(
            ['node', str(ROOT / 'tests/fixtures/audit_stream.mjs')], text=True))
        exemplar = self.exemplar()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'structural_exemplar.jsonl'
            product_path = Path(directory) / 'extended_product.jsonl'
            writer = AuditLogger(str(path))
            writer.append(exemplar)
            before = path.read_bytes()
            # Simulate arbitrary future product fields, including collisions with
            # every canonical name. These are not current-schema valid events.
            product_writer = AuditLogger(str(product_path))
            for event in events:
                extended = copy.deepcopy(event)
                extended.update({key: {'product_only': key} for key in PAPER9_KEYS})
                extended['arbitrary_product_field'] = {'nested': [1, 2, 3]}
                product_writer.append(extended)
            writer.append(exemplar)
            self.assertEqual(path.read_bytes(), before + before)
            for line in path.read_text().splitlines():
                actual = json.loads(line)
                self.assertEqual(set(actual), PAPER9_KEYS)
                require_exact_paper9_keys(actual)
                self.assertEqual(actual, exemplar)
        # Current product records themselves cannot be mistaken for canonical.
        for event in events:
            with self.assertRaises(ValueError):
                require_exact_paper9_keys(event)

    def test_actual_cde_producer_is_operational_not_paper9_canonical(self):
        engine = CDEEngine(str(ROOT))
        packet = TurnPacket.model_validate_json(
            (ROOT / 'demo/ramp_test.jsonl').read_text().splitlines()[0])
        events = engine.process_turn(packet)
        self.assertTrue(events)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'cde_audit.jsonl'
            logger = AuditLogger(str(path))
            for event in events:
                logger.append(event.model_dump())
            records = [json.loads(line) for line in path.read_text().splitlines()]
        for record in records:
            self.assertEqual(set(record) & PAPER9_KEYS, {'decision', 'evidence'})
            with self.assertRaises(ValueError):
                require_exact_paper9_keys(record)


class Paper9HarnessSampleTests(unittest.TestCase):
    def test_generated_harness_sample_matches_contract_and_actual_fixture_bytes(self):
        records = [json.loads(line) for line in (ROOT / 'conformance/sample.jsonl').read_text().splitlines()]
        cases = json.loads((ROOT / 'conformance/cases.json').read_text())
        self.assertEqual([r['demo_id'] for r in records], [case['demo_id'] for case in cases])
        for record, case in zip(records, cases):
            require_exact_paper9_keys(record)
            self.assertEqual(set(record), PAPER9_KEYS)
            self.assertIn(record['decision'], SPECIFICATION['canonical_decisions'])
            self.assertIs(record['pass'], True)
            self.assertEqual(record['mode'], case['mode'])
            self.assertEqual(record['normative_ids'], case['normative_ids'])
            self.assertEqual(record['fixture_path'], case['fixture_path'])
            digest = hashlib.sha256((ROOT / case['fixture_path']).read_bytes()).hexdigest()
            self.assertEqual(record['fixture_hash'], 'sha256:' + digest)
