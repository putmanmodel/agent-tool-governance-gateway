"""Trusted shared ingress bounds, measured in UTF-8 bytes, never truncation."""
import json
from pathlib import Path
from types import MappingProxyType

EXPECTED_FIELDS = frozenset(('turn_id', 'speaker_id', 'session_id', 'channel_id', 'scene_id', 'task_id', 'tool'))


def validate_limits_definition(specification):
    if (not isinstance(specification, dict)
            or set(specification) != {'schema_version', 'max_utf8_bytes'}
            or specification['schema_version'] != '1.0'):
        raise ValueError('Invalid identifier limits definition')
    limits = specification['max_utf8_bytes']
    if (not isinstance(limits, dict) or set(limits) != EXPECTED_FIELDS
            or any(isinstance(value, bool) or not isinstance(value, (int, float))
                   or not 0 < value <= 9007199254740991 or int(value) != value
                   for value in limits.values())):
        raise ValueError('Invalid identifier limits definition')
    # JSON has one numeric type: accept integral values such as 256.0 like Node.
    return MappingProxyType({key: int(value) for key, value in limits.items()})


IDENTIFIER_LIMITS = validate_limits_definition(
    json.loads(Path(__file__).with_name('identifier_limits.json').read_text()))


def validate_identifiers(payload):
    if not isinstance(payload, dict):
        raise ValueError('Expected an object')
    for name, maximum in IDENTIFIER_LIMITS.items():
        if name not in payload:
            continue
        value = payload[name]
        if value is None and name in ('session_id', 'scene_id', 'task_id'):
            continue
        if not isinstance(value, str) or len(value.encode('utf-8')) > maximum:
            raise ValueError(f'{name} must be a string of at most {maximum} UTF-8 bytes')
    return payload
