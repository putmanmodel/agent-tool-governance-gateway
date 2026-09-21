import fs from 'node:fs';
import path from 'node:path';

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
    if (typeof name !== 'string' || !name.length || name === '.' || name.includes('..')
      || path.isAbsolute(name) || /[\\/\x00-\x1f]/.test(name)) throw Error('Invalid sandbox filename');
    return path.join(root, name);
  }
  return Object.freeze({ execute({ tool, args }) {
    if (!['fs.read','fs.write','fs.delete'].includes(tool)) throw Error('Unsupported sandbox operation');
    const file = filename(args);
    if (!args || Object.keys(args).some(key => !['path', ...(tool === 'fs.write' ? ['content'] : [])].includes(key))) throw Error('Invalid sandbox arguments');
    if (tool === 'fs.write' && (typeof args.content !== 'string' || Buffer.byteLength(args.content) > 65536)) throw Error('Content must be at most 64 KiB');
    const flags = (tool === 'fs.write' ? fs.constants.O_WRONLY | fs.constants.O_CREAT : fs.constants.O_RDONLY)
      | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK;
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
      fs.unlinkSync(file); return { deleted: true };
    } finally { fs.closeSync(fd); }
  } });
}
