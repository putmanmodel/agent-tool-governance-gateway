import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { KingpinAuthority } from '../kingpin/index.js';
import { KingpinAuthority as CompatibilityAuthority } from './kingpin/authority.js';
import { captureDecisions } from '../tests/fixtures/authority_cases.mjs';

const baseline = JSON.parse(fs.readFileSync(new URL('../tests/fixtures/pre_extraction_authority.json', import.meta.url)));

test('extracted runtime exactly matches pre-extraction decisions, review, replay and revocation', () => {
  assert.deepEqual(captureDecisions(KingpinAuthority), baseline);
});

test('legacy import is the same runtime, with no separate policy implementation', () => {
  assert.equal(CompatibilityAuthority, KingpinAuthority);
});
