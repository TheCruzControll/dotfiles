import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const EXCLUDED = new Set(['.git', 'node_modules', '.pi', '.observer-workspace', 'workflow-revisions', '.workflow-revisions']);
const contains = (root, child) => child === root || child.startsWith(root + path.sep);
const canonical = (name) => fs.realpathSync(name);

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    // Do not let the caller's Git environment redirect operations elsewhere.
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
  });
}

// Resolve existing ancestors before creating a store, including symlink aliases.
function prospectiveCanonical(name) {
  let cursor = path.resolve(name);
  const suffix = [];
  while (!fs.existsSync(cursor)) {
    suffix.unshift(path.basename(cursor));
    const parent = path.dirname(cursor);
    if (parent === cursor) throw new Error('Missing store ancestor');
    cursor = parent;
  }
  return path.join(canonical(cursor), ...suffix);
}

function copyTree(source, target) {
  fs.mkdirSync(target, { mode: 0o700 });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (EXCLUDED.has(entry.name)) continue;
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    const stat = fs.lstatSync(from);
    if (stat.isSymbolicLink()) throw new Error(`Symlinks are not allowed in isolation copies: ${from}`);
    if (stat.isDirectory()) copyTree(from, to);
    else if (stat.isFile()) fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
    else throw new Error(`Unsupported file type in isolation copy: ${from}`);
  }
}

function repository(source) {
  try {
    const root = canonical(git(source, 'rev-parse', '--show-toplevel').trim());
    if (root !== source) throw new Error('Source must be the Git repository root');
    return root;
  } catch (error) {
    // A broken repository or a subdirectory must not silently become a copy.
    for (let cursor = source;; cursor = path.dirname(cursor)) {
      if (fs.existsSync(path.join(cursor, '.git'))) throw error;
      if (path.dirname(cursor) === cursor) break;
    }
    return null;
  }
}

/** Create a retained, task-bound workspace. No source files are removed. */
export function prepareIsolation({ sourceRoot, storeRoot, taskId } = {}) {
  if (typeof taskId !== 'string' || !taskId.trim()) throw new Error('A taskId is required');
  if (typeof sourceRoot !== 'string' || !path.isAbsolute(sourceRoot) ||
      typeof storeRoot !== 'string' || !path.isAbsolute(storeRoot)) {
    throw new Error('Absolute sourceRoot and storeRoot paths are required');
  }
  if (fs.lstatSync(sourceRoot).isSymbolicLink()) throw new Error('Source symlinks are not allowed');
  const source = canonical(sourceRoot);
  if (!fs.statSync(source).isDirectory()) throw new Error('Source must be a directory');
  if (source === path.parse(source).root || source === canonical(os.homedir())) {
    throw new Error('Refusing filesystem root or home as source');
  }
  const store = prospectiveCanonical(storeRoot);
  if (contains(source, store) || contains(store, source)) {
    throw new Error('Source and store must not contain one another');
  }
  const repo = repository(source);
  let head, commonDir;
  if (repo) {
    if (git(source, 'status', '--porcelain', '--untracked-files=all').length) {
      throw new Error('Git source must be clean, including untracked files');
    }
    head = git(source, 'rev-parse', '--verify', 'HEAD').trim();
    commonDir = canonical(git(source, 'rev-parse', '--path-format=absolute', '--git-common-dir').trim());
  }
  fs.mkdirSync(store, { recursive: true, mode: 0o700 });
  if (canonical(store) !== store || !fs.statSync(store).isDirectory()) throw new Error('Invalid managed store');
  const id = randomUUID();
  const managedRoot = path.join(store, id);
  fs.mkdirSync(managedRoot, { mode: 0o700 });
  const cwd = path.join(managedRoot, 'workspace');
  if (repo) git(source, 'worktree', 'add', '--detach', cwd, head);
  else copyTree(source, cwd);
  const record = { id, cwd, kind: repo ? 'git-worktree' : 'copy', sourceRoot: source, taskId };
  fs.writeFileSync(path.join(managedRoot, 'isolation.json'), JSON.stringify({
    ...record, schemaVersion: 1, managedRoot, storeRoot: store, head, commonDir,
    gitDir: repo ? canonical(git(cwd, 'rev-parse', '--absolute-git-dir').trim()) : undefined,
  }), { flag: 'wx', mode: 0o600 });
  return record;
}

/** Fail closed on missing, moved, mismatched, or substituted workspaces. */
export function validateIsolation(record, { taskId } = {}) {
  try {
    if (!record || typeof taskId !== 'string' || !taskId.trim() || record.taskId !== taskId ||
        typeof record.id !== 'string' || !/^[0-9a-f-]{36}$/.test(record.id) ||
        typeof record.cwd !== 'string' || !path.isAbsolute(record.cwd)) return false;
    const managedRoot = path.dirname(record.cwd);
    const manifestPath = path.join(managedRoot, 'isolation.json');
    if (canonical(record.cwd) !== record.cwd || !fs.statSync(record.cwd).isDirectory() ||
        canonical(managedRoot) !== managedRoot || fs.lstatSync(manifestPath).isSymbolicLink()) return false;
    const saved = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (saved.schemaVersion !== 1 || saved.managedRoot !== managedRoot ||
        path.join(saved.storeRoot, saved.id) !== managedRoot ||
        path.join(managedRoot, 'workspace') !== record.cwd) return false;
    for (const key of ['id', 'cwd', 'kind', 'sourceRoot', 'taskId']) {
      if (record[key] !== saved[key]) return false;
    }
    if (saved.kind === 'copy') return !fs.existsSync(path.join(record.cwd, '.git'));
    if (saved.kind !== 'git-worktree') return false;
    return fs.lstatSync(path.join(record.cwd, '.git')).isFile() &&
      canonical(git(record.cwd, 'rev-parse', '--show-toplevel').trim()) === record.cwd &&
      canonical(git(record.cwd, 'rev-parse', '--absolute-git-dir').trim()) === saved.gitDir &&
      canonical(fs.readFileSync(path.join(saved.gitDir, 'gitdir'), 'utf8').trim()) === path.join(record.cwd, '.git') &&
      canonical(git(record.cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir').trim()) === saved.commonDir &&
      git(record.cwd, 'rev-parse', 'HEAD').trim() === saved.head &&
      git(record.cwd, 'rev-parse', '--abbrev-ref', 'HEAD').trim() === 'HEAD' &&
      git(record.cwd, 'worktree', 'list', '--porcelain', '-z').split('\0').includes(`worktree ${record.cwd}`);
  } catch {
    return false;
  }
}
