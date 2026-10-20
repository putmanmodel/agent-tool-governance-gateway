// Intentionally does not import the authorization-side representation module.
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export function observeOperation({ method, target, rawHeaders, body, port }) {
  const pairs = [];
  for (let i = 0; i < rawHeaders.length; i += 2) pairs.push([rawHeaders[i].toLowerCase(), rawHeaders[i + 1].trim()]);
  const hosts = pairs.filter(([name]) => name === 'host');
  const authority = hosts.length === 1 ? hosts[0][1] : '';
  const hostMatch = /^([a-z0-9]+(?:[.-][a-z0-9]+)*):([0-9]+)$/.exec(authority);
  const split = target.indexOf('?');
  const path = split < 0 ? target : target.slice(0, split);
  const query = split < 0 ? '' : target.slice(split + 1);
  const supported = Boolean(hostMatch && Number(hostMatch[2]) === port
    && ['GET', 'POST', 'PUT', 'DELETE'].includes(method)
    && /^\/[A-Za-z0-9_/-]*$/.test(path) && !path.includes('//') && (path === '/' || !path.endsWith('/'))
    && /^[\x21-\x7e]*$/.test(query) && !query.includes('#')
    && pairs.length <= 128 && pairs.every(([, value]) => /^[\x20-\x7e\t]*$/.test(value)));
  const application_headers = pairs.filter(([name]) => ['content-type', 'x-operation-mode'].includes(name));
  const operation = supported ? {
    representation_version: 'kingpin.openshell-operation.v1',
    destination: { scheme: 'http', host: hostMatch[1], port }, method,
    canonical_path: path, raw_query: query, application_headers, body_sha256: digest(body),
  } : null;
  return { operation, operation_sha256: operation ? digest(JSON.stringify([
    operation.representation_version, 'http', operation.destination.host, port,
    method, path, query, application_headers, operation.body_sha256])) : null,
    // Claims are recorded for later correlation, never authenticated here.
    request_id_claims: pairs.filter(([name]) => name === 'x-kp-request-id').map(([, value]) => value),
    identity_authenticated: false, raw_target: target, raw_headers: [...rawHeaders],
    body_sha256: digest(body), body_bytes: body.length, supported };
}

export function createReceiver({ maxBodyBytes = 262144, onRecord = () => {} } = {}) {
  const records = [];
  let effectCount = 0;
  const server = createServer((request, response) => {
    const chunks = []; let size = 0;
    request.on('data', chunk => {
      size += chunk.length;
      if (size > maxBodyBytes) { response.writeHead(413); response.end(); request.destroy(); }
      else chunks.push(chunk);
    });
    request.on('end', () => {
      if (size > maxBodyBytes) return;
      const record = observeOperation({ method: request.method, target: request.url,
        rawHeaders: request.rawHeaders, body: Buffer.concat(chunks), port: server.address().port });
      // A synthetic fixture effect occurs even for unrepresentable requests.
      record.effect_count = ++effectCount;
      records.push(record);
      onRecord(record);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ effect_count: effectCount, supported: record.supported }));
    });
  });
  server.requestTimeout = 10000;
  return { server, records, get effectCount() { return effectCount; } };
}
