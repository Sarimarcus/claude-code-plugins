import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function git(root, args) {
  return spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

const snapName = f => crypto.createHash('sha1').update(f).digest('hex');
const sha = file => (fs.existsSync(file) ? crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex') : null);

/** Absolute paths of modified, added, deleted and untracked files under root, minus `ignore` folders. */
export function dirtyFiles(root, ignore = []) {
  const top = git(root, ['rev-parse', '--show-toplevel']).stdout.trim();
  const out = git(root, ['status', '--porcelain', '-z', '-uall', '--', '.']).stdout.split('\0').filter(Boolean);
  const files = [];
  for (let i = 0; i < out.length; i++) {
    const entry = out[i];
    const code = entry.slice(0, 2);
    files.push(path.join(top, entry.slice(3)));
    if (/[RC]/.test(code)) i++;
  }
  const skip = ignore.map(p => path.resolve(p) + path.sep);
  return files.filter(f => !skip.some(s => f.startsWith(s)));
}

/** Copy every dirty file aside so a rejected fix can be undone without touching anyone else's edits. */
export function snapshot(files, snapDir) {
  fs.rmSync(snapDir, { recursive: true, force: true });
  fs.mkdirSync(snapDir, { recursive: true });
  return files.map(f => {
    const h = sha(f);
    if (h) fs.copyFileSync(f, path.join(snapDir, snapName(f)));
    return { file: f, sha: h };
  });
}

/** Files whose content differs from the snapshot (a file clean at snapshot time and dirty now counts). */
export function changedSince(root, ignore, manifest) {
  const now = new Set(dirtyFiles(root, ignore));
  const before = new Map(manifest.map(m => [m.file, m.sha]));
  const changed = new Set();
  for (const f of now) if (!before.has(f) || before.get(f) !== sha(f)) changed.add(f);
  for (const [f, h] of before) if (!now.has(f) && h !== sha(f)) changed.add(f);
  return [...changed].sort();
}

export function protectedHits(root, files, globs) {
  return files.filter(f => {
    const rel = path.relative(root, f).split(path.sep).join('/');
    return globs.some(g => path.matchesGlob(rel, g));
  });
}

/**
 * Put each file back to its snapshot content, or to HEAD when it was clean. A new untracked file is never deleted
 * (it may belong to another session sharing the checkout): the runner returns those paths so they get reported.
 */
export function revert(root, files, manifest, snapDir) {
  const before = new Map(manifest.map(m => [m.file, m.sha]));
  const left = [];
  for (const f of files) {
    if (before.has(f)) {
      const h = before.get(f);
      if (h === null) fs.rmSync(f, { force: true });
      else fs.copyFileSync(path.join(snapDir, snapName(f)), f);
    } else if (git(root, ['ls-files', '--error-unmatch', '--', f]).status === 0) {
      git(root, ['restore', '--worktree', '--source=HEAD', '--', f]);
    } else {
      left.push(f);
    }
  }
  return left;
}
