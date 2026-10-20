import { createHash } from 'node:crypto';

export const VERSION = 'kingpin.openshell-operation.v1';
export const MEANINGFUL_HEADERS = ['content-type', 'x-operation-mode'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const requireValue = (ok, message) => { if (!ok) throw new Error(message); };

// This is a deliberately restricted canonical subset, not a URL normalizer.
export function canonicalPath(path) {
  requireValue(typeof path === 'string' && /^\/[A-Za-z0-9_/-]*$/.test(path)
    && !path.includes('//') && (path === '/' || !path.endsWith('/')), 'Unsupported canonical path');
  return path;
}

export function representOperation({ destination, method, path, query, headers, body }) {
  requireValue(destination?.scheme === 'http', 'Only fixture HTTP is supported');
  requireValue(typeof destination.host === 'string' && /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(destination.host), 'Host must be canonical lowercase ASCII');
  requireValue(Number.isInteger(destination.port) && destination.port > 0 && destination.port <= 65535, 'Invalid port');
  requireValue(['GET', 'POST', 'PUT', 'DELETE'].includes(method), 'Unsupported method');
  canonicalPath(path);
  requireValue(typeof query === 'string' && /^[\x21-\x7e]*$/.test(query) && !query.includes('#'), 'Query must be raw ASCII without fragment');
  requireValue(Array.isArray(headers) && headers.length <= 128, 'Invalid headers');
  const meaningful = [];
  for (const pair of headers) {
    requireValue(Array.isArray(pair) && pair.length === 2 && pair.every(x => typeof x === 'string'), 'Invalid header pair');
    const [name, value] = pair;
    requireValue(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) && /^[\x20-\x7e\t]*$/.test(value), 'Unsupported header encoding');
    if (MEANINGFUL_HEADERS.includes(name.toLowerCase())) meaningful.push([name.toLowerCase(), value.trim()]);
  }
  requireValue(Buffer.isBuffer(body) && body.length <= 262144, 'Body must be bounded bytes');
  return {
    representation_version: VERSION,
    destination: { scheme: destination.scheme, host: destination.host, port: destination.port },
    method, canonical_path: path, raw_query: query,
    application_headers: meaningful, body_sha256: hash(body),
  };
}

// Hash a fixed tuple, never incidental JavaScript object property order.
export function operationDigest(operation) {
  return hash(JSON.stringify([operation.representation_version,
    operation.destination.scheme, operation.destination.host, operation.destination.port,
    operation.method, operation.canonical_path, operation.raw_query,
    operation.application_headers, operation.body_sha256]));
}

// Call only after authenticating the middleware transport. Never pass agent headers here.
export function bindOperation(input, authenticatedContext) {
  for (const key of ['sandbox_id', 'request_id']) {
    requireValue(typeof authenticatedContext?.[key] === 'string'
      && /^[A-Za-z0-9_-]{1,128}$/.test(authenticatedContext[key]), `Invalid ${key}`);
  }
  const operation = representOperation(input);
  const operation_sha256 = operationDigest(operation);
  const representation = { ...operation, sandbox_id: authenticatedContext.sandbox_id,
    request_id: authenticatedContext.request_id };
  return { representation, operation_sha256,
    binding_sha256: hash(JSON.stringify([VERSION, representation.sandbox_id,
      representation.request_id, operation_sha256])) };
}
