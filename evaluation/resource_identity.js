import fs from 'node:fs';
import path from 'node:path';

const flat = name => typeof name === 'string' && name.length > 0 && Buffer.byteLength(name) <= 255
  && name !== '.' && !name.includes('..') && !path.isAbsolute(name) && !/[\\/\x00-\x1f]/.test(name);
const sameObject = (a, b) => a.dev === b.dev && a.ino === b.ino;

// Resource identity is filesystem namespace equivalence, not Unicode or ASCII
// case folding in JavaScript. The persisted v1 path/root metadata remains the
// source of truth; its spelling hash is only a fast, exact-name conflict key.
export function sandboxResourcesConflict(root, identity, current, previous) {
  const compatible = evidence => evidence?.adapter === 'sandbox.v1'
    && evidence.root_dev === identity.dev && evidence.root_ino === identity.ino
    && flat(evidence.path);
  // Uninterpretable unresolved records must not silently lose their hold.
  if (!compatible(current) || !compatible(previous)) return true;
  if (current.path === previous.path) return true;
  let directory;
  try {
    const liveRoot = fs.lstatSync(root);
    if (!liveRoot.isDirectory() || liveRoot.isSymbolicLink() || !sameObject(liveRoot, identity)) return true;
    const lookup = name => {
      try { return fs.lstatSync(path.join(root, name)); }
      catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    };
    const a = lookup(current.path), b = lookup(previous.path);
    if (a && b) return sameObject(a, b);
    if (a || b) return false; // An equivalent name would resolve to the existing entry.

    // Neither target exists: ask the same filesystem using an isolated namespace
    // beneath the sandbox. No requested target is created or changed. These are
    // temporary operator metadata, not tool effects or a second governance store.
    directory = fs.mkdtempSync(path.join(root, '.kingpin-identity-'));
    const marker = path.join(directory, current.path);
    const fd = fs.openSync(marker, 'wx', 0o600);
    fs.closeSync(fd);
    try { return sameObject(fs.lstatSync(marker), fs.lstatSync(path.join(directory, previous.path))); }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  } catch { return true; } // Cannot establish separation: retain the hold.
  finally { if (directory) fs.rmSync(directory, { recursive: true, force: true }); }
}
