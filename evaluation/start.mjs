import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openEvaluation, buildIdentity } from './config.js';
import { startCde } from './cde.js';
import { createGatewayApp } from '../gateway_node/server.js';

function gitId() {
  try {
    const root = fileURLToPath(new URL('../.git/', import.meta.url));
    const head = fs.readFileSync(path.join(root, 'HEAD'), 'utf8').trim();
    const commit = head.startsWith('ref: ') ? fs.readFileSync(path.join(root, head.slice(5)), 'utf8').trim() : head;
    return /^[a-f0-9]{40,64}$/.test(commit) ? commit : null;
  } catch { return null; }
}
export async function startEvaluation(filename, options) {
  const runtime = openEvaluation(filename, options);
  let cde, server;
  try {
    cde = await startCde(runtime.python);
    const identity = buildIdentity(runtime.policy, gitId());
    const app = createGatewayApp({ mode: 'evaluation', authentication: runtime.authentication,
      authority: runtime.authority, evaluateTurn: cde.evaluate, adapter: runtime.adapter,
      build: identity, logDecision() {} });
    server = await new Promise((resolve, reject) => {
      const listener = app.listen(runtime.config.port, runtime.config.host, () => resolve(listener));
      listener.once('error', reject);
    });
    return { ...runtime, server, identity, async close() {
      await new Promise(resolve => server.close(resolve)); cde.close(); runtime.store.close();
    } };
  } catch (error) { server?.close(); cde?.close(); runtime.store.close(); throw error; }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let runtime;
  try {
    const args = process.argv.slice(2);
    if (!args[0] || args.slice(1).some(arg => arg !== '--initialize') || args.length > 2) throw Error('Usage: evaluation runtime.json [--initialize]');
    runtime = await startEvaluation(args[0], { initialize: args.includes('--initialize') });
    console.log(JSON.stringify(runtime.identity));
    console.log(`Evaluation listening on http://${runtime.config.host === '::1' ? '[::1]' : runtime.config.host}:${runtime.config.port}`);
    for (const sig of ['SIGINT','SIGTERM']) process.once(sig, async () => { await runtime.close(); process.exit(0); });
  } catch { console.error('Evaluation startup failed. Check required configuration, dependencies, permissions and compatible state. No permissive fallback was started.'); process.exitCode = 1; }
}
