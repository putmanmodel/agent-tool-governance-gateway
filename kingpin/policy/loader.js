import { readFileSync } from 'node:fs';
import { validatePolicy } from './validator.js';

// Explicit local path supplied by server code; never selected from tool requests.
// Parse/read/validation failures propagate. There is no fallback on invalid policy.
export function loadPolicy(path = new URL('./default/policy.json', import.meta.url)) {
  return validatePolicy(JSON.parse(readFileSync(path, 'utf8')));
}
