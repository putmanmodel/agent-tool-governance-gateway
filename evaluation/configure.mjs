import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Explicit local setup only; never resets an existing configuration or store.
const [target, python] = process.argv.slice(2);
if (!target || !python) { console.error('Usage: evaluation:configure destination-directory absolute-python-path'); process.exit(1); }
const destination = path.resolve(target);
fs.accessSync(path.resolve(python), fs.constants.X_OK);
fs.mkdirSync(destination, { mode: 0o700 });
const examples = fileURLToPath(new URL('../config/evaluation.example/', import.meta.url));
const auth = JSON.parse(fs.readFileSync(path.join(examples, 'auth.json'), 'utf8'));
for (const principal of auth.principals) principal.token = crypto.randomBytes(32).toString('base64url');
const runtime = JSON.parse(fs.readFileSync(path.join(examples, 'runtime.json'), 'utf8'));
runtime.python = path.resolve(python);
fs.writeFileSync(path.join(destination, 'auth.json'), JSON.stringify(auth, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
fs.writeFileSync(path.join(destination, 'runtime.json'), JSON.stringify(runtime, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
fs.copyFileSync(path.join(examples, 'policy.json'), path.join(destination, 'policy.json'), fs.constants.COPYFILE_EXCL);
fs.mkdirSync(path.join(destination, 'sandbox'), { mode: 0o700 });
console.log('Evaluator configuration created. Credentials are local files and were not printed.');
