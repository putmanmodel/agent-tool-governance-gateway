import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { sandboxResourcesConflict } from './resource_identity.js';

// Flat namespace: no agent-controlled directories, links, shell or path resolution.
// The configured root and host process are trusted and exclusively controlled.
export function createSandboxAdapter(root) {
  if (!Number.isInteger(fs.constants.O_NOFOLLOW)) throw Error('Sandbox requires POSIX no-follow support');
  const initial = fs.lstatSync(root);
  if (!initial.isDirectory() || initial.isSymbolicLink()) throw Error('Sandbox must be a real directory');
  if ((initial.mode & 0o077) !== 0 || (process.getuid && initial.uid !== process.getuid())) throw Error('Sandbox must be owned by the evaluator with mode 0700');
  root = fs.realpathSync(root);
  const identity = fs.statSync(root);
  function filename(args) {
    const current = fs.lstatSync(root);
    if (!current.isDirectory() || current.isSymbolicLink() || current.ino !== identity.ino || current.dev !== identity.dev) throw Error('Sandbox root changed');
    const name = args?.path;
    if (typeof name !== 'string' || !name.length || Buffer.byteLength(name) > 255 || name === '.' || name.includes('..')
      || path.isAbsolute(name) || /[\\/\x00-\x1f]/.test(name)) throw Error('Invalid sandbox filename');
    return path.join(root, name);
  }
  const hash = value => crypto.createHash('sha256').update(value).digest('hex');
  function snapshot(name) {
    const file = filename({ path: name });
    let fd;
    try { fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); }
    catch (error) { if (error.code === 'ENOENT') return { exists: false }; throw error; }
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1) throw Error('Ambiguous sandbox target');
      const buffer = Buffer.alloc(65537), bytes = stat.size > 65536 ? 65537 : fs.readSync(fd, buffer, 0, buffer.length, 0);
      return { exists: true, hash: bytes > 65536 ? null : hash(buffer.subarray(0, bytes)), dev: stat.dev, ino: stat.ino,
        size: stat.size, mtime: stat.mtimeMs, ctime: stat.ctimeMs };
    } finally { fs.closeSync(fd); }
  }
  return Object.freeze({
    isSideEffecting(tool) { return tool !== 'fs.read'; },
    resourcesConflict(preparation, previous) {
      return sandboxResourcesConflict(root, identity, preparation?.evidence, previous.reconciliation_data);
    },
    prepare({ tool, args }) {
      if (!['fs.write','fs.delete'].includes(tool)) return null;
      filename(args);
      if (Object.keys(args).some(key => !['path', ...(tool === 'fs.write' ? ['content'] : [])].includes(key))) throw Error('Invalid sandbox arguments');
      if (tool === 'fs.write' && (typeof args.content !== 'string' || Buffer.byteLength(args.content) > 65536)) throw Error('Invalid write');
      const before = snapshot(args.path);
      if (tool === 'fs.delete' && !before.exists) throw Error('Delete target missing');
      return { resource_hash: hash(JSON.stringify([identity.dev, identity.ino, args.path])),
        evidence: { adapter: 'sandbox.v1', path: args.path, operation: tool, root_dev: identity.dev, root_ino: identity.ino,
          expected_hash: tool === 'fs.write' ? hash(args.content) : null, before } };
    },
    reconcile(evidence) {
      if (!evidence || evidence.adapter !== 'sandbox.v1') return 'unsupported';
      if (evidence.root_dev !== identity.dev || evidence.root_ino !== identity.ino) return 'inconclusive';
      const current = snapshot(evidence.path), before = evidence.before;
      const unchanged = JSON.stringify(current) === JSON.stringify(before);
      if (evidence.operation === 'fs.write') {
        if (current.exists && current.hash === evidence.expected_hash
          && (!before.exists || (current.dev === before.dev && current.ino === before.ino))) return 'succeeded';
        if (unchanged) return 'failed';
        return 'inconclusive';
      }
      if (evidence.operation === 'fs.delete') {
        if (before.exists && !current.exists) return 'succeeded';
        return unchanged ? 'failed' : 'inconclusive';
      }
      return 'unsupported';
    },
    execute({ tool, args }) {
    let mayHaveEffect = false;
    try {
    if (!['fs.read','fs.write','fs.delete'].includes(tool)) throw Error('Unsupported sandbox operation');
    const file = filename(args);
    if (!args || Object.keys(args).some(key => !['path', ...(tool === 'fs.write' ? ['content'] : [])].includes(key))) throw Error('Invalid sandbox arguments');
    if (tool === 'fs.write' && (typeof args.content !== 'string' || Buffer.byteLength(args.content) > 65536)) throw Error('Content must be at most 64 KiB');
    const flags = (tool === 'fs.write' ? fs.constants.O_WRONLY | fs.constants.O_CREAT : fs.constants.O_RDONLY)
      | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK;
    if (tool === 'fs.write') mayHaveEffect = true;
    const fd = fs.openSync(file, flags, 0o600);
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1) throw Error('Only singly-linked regular files are supported');
      if (tool === 'fs.read') {
        if (stat.size > 65536) throw Error('File exceeds read limit');
        const buffer = Buffer.alloc(65537);
        const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
        if (bytes > 65536) throw Error('File exceeds read limit');
        return { content: buffer.subarray(0, bytes).toString('utf8') };
      }
      if (tool === 'fs.write') { fs.ftruncateSync(fd, 0); fs.writeFileSync(fd, args.content); fs.fsyncSync(fd); return { written: Buffer.byteLength(args.content) }; }
      mayHaveEffect = true;
      fs.unlinkSync(file); return { deleted: true };
    } finally { fs.closeSync(fd); }
    } catch (error) { if (!mayHaveEffect) error.knownNoEffect = true; throw error; }
  } });
}
