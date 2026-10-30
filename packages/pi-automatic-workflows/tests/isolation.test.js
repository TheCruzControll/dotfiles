import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { prepareIsolation, validateIsolation } from '../lib/isolation.js';

function fixture(fn) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-isolation-')));
  const sourceRoot = path.join(root, 'source');
  const storeRoot = path.join(root, 'store');
  fs.mkdirSync(sourceRoot);
  fs.mkdirSync(storeRoot);
  fs.writeFileSync(path.join(sourceRoot, 'file.txt'), 'original');
  try { fn({ root, sourceRoot, storeRoot, taskId: 'task-a' }); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}
function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
  });
}
function init(source) {
  git(source, 'init');
  git(source, 'add', '.');
  git(source, '-c', 'user.name=Isolation Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture');
}

test('copy retains the source, excludes operational stores, and creates unique task-bound workspaces', () => fixture((options) => {
  for (const name of ['node_modules', '.pi', '.observer-workspace', 'workflow-revisions', '.workflow-revisions']) {
    fs.mkdirSync(path.join(options.sourceRoot, name));
    fs.writeFileSync(path.join(options.sourceRoot, name, 'private'), 'exclude');
  }
  const record = prepareIsolation(options);
  assert.equal(record.kind, 'copy');
  assert.equal(record.sourceRoot, options.sourceRoot);
  assert.equal(validateIsolation(record, { taskId: options.taskId }), true);
  assert.equal(validateIsolation(record, { taskId: 'task-b' }), false);
  assert.equal(validateIsolation({ ...record, sourceRoot: options.root }, { taskId: options.taskId }), false);
  for (const name of ['node_modules', '.pi', '.observer-workspace', 'workflow-revisions', '.workflow-revisions']) {
    assert.equal(fs.existsSync(path.join(record.cwd, name)), false);
    assert.equal(fs.existsSync(path.join(options.sourceRoot, name, 'private')), true);
  }
  fs.writeFileSync(path.join(record.cwd, 'file.txt'), 'changed');
  assert.equal(fs.readFileSync(path.join(options.sourceRoot, 'file.txt'), 'utf8'), 'original');
  const second = prepareIsolation(options);
  assert.notEqual(record.id, second.id);
  assert.equal(fs.readFileSync(path.join(second.cwd, 'file.txt'), 'utf8'), 'original');
  fs.rmSync(record.cwd, { recursive: true });
  assert.equal(validateIsolation(record, { taskId: options.taskId }), false);
}));

test('copy rejects symlinks without touching the source or target', () => fixture((options) => {
  const target = path.join(options.root, 'target');
  fs.writeFileSync(target, 'untouched');
  fs.symlinkSync(target, path.join(options.sourceRoot, 'link'));
  assert.throws(() => prepareIsolation(options), /Symlinks/);
  assert.equal(fs.readFileSync(target, 'utf8'), 'untouched');
  assert.equal(fs.lstatSync(path.join(options.sourceRoot, 'link')).isSymbolicLink(), true);
}));

test('rejects unsafe roots, recursive stores, missing sources and source aliases', () => fixture((options) => {
  for (const sourceRoot of ['/', os.homedir(), path.join(options.root, 'missing')]) {
    assert.throws(() => prepareIsolation({ ...options, sourceRoot }));
  }
  assert.throws(() => prepareIsolation({ ...options, storeRoot: options.sourceRoot }), /contain/);
  assert.throws(() => prepareIsolation({ ...options, storeRoot: path.join(options.sourceRoot, 'nested') }), /contain/);
  assert.equal(fs.existsSync(path.join(options.sourceRoot, 'nested')), false);
  assert.throws(() => prepareIsolation({ ...options, storeRoot: options.root }), /contain/);
  const alias = path.join(options.root, 'alias');
  fs.symlinkSync(options.sourceRoot, alias);
  assert.throws(() => prepareIsolation({ ...options, storeRoot: path.join(alias, 'nested') }), /contain/);
  assert.throws(() => prepareIsolation({ ...options, sourceRoot: alias }), /symlinks/);
}));

test('dirty Git tracked and untracked files are refused', () => fixture((options) => {
  init(options.sourceRoot);
  fs.writeFileSync(path.join(options.sourceRoot, 'untracked'), 'new');
  assert.throws(() => prepareIsolation(options), /clean/);
  fs.unlinkSync(path.join(options.sourceRoot, 'untracked'));
  fs.writeFileSync(path.join(options.sourceRoot, 'file.txt'), 'dirty');
  assert.throws(() => prepareIsolation(options), /clean/);
  assert.equal(fs.readFileSync(path.join(options.sourceRoot, 'file.txt'), 'utf8'), 'dirty');
  assert.deepEqual(fs.readdirSync(options.storeRoot), []);
}));

test('clean Git creates a detached registered worktree and preserves source files and HEAD', () => fixture((options) => {
  init(options.sourceRoot);
  const head = git(options.sourceRoot, 'rev-parse', 'HEAD');
  const record = prepareIsolation(options);
  assert.equal(record.kind, 'git-worktree');
  assert.equal(validateIsolation(record, { taskId: options.taskId }), true);
  assert.equal(validateIsolation(record, { taskId: 'another' }), false);
  assert.equal(git(record.cwd, 'rev-parse', '--abbrev-ref', 'HEAD').trim(), 'HEAD');
  fs.writeFileSync(path.join(record.cwd, 'file.txt'), 'isolated');
  assert.equal(validateIsolation(record, { taskId: options.taskId }), true);
  assert.equal(fs.readFileSync(path.join(options.sourceRoot, 'file.txt'), 'utf8'), 'original');
  assert.equal(git(options.sourceRoot, 'rev-parse', 'HEAD'), head);
  assert.equal(git(options.sourceRoot, 'status', '--porcelain'), '');
  const pointer = path.join(record.cwd, '.git');
  const originalPointer = fs.readFileSync(pointer, 'utf8');
  fs.writeFileSync(pointer, `gitdir: ${path.join(options.sourceRoot, '.git')}\n`);
  assert.equal(validateIsolation(record, { taskId: options.taskId }), false);
  fs.writeFileSync(pointer, originalPointer);
  assert.equal(validateIsolation(record, { taskId: options.taskId }), true);
  // A different worktree cannot be substituted at the recorded location.
  const moved = record.cwd + '-moved';
  fs.renameSync(record.cwd, moved);
  fs.symlinkSync(moved, record.cwd);
  assert.equal(validateIsolation(record, { taskId: options.taskId }), false);
}));

test('validation fails closed on malformed records and tampered manifests', () => fixture((options) => {
  assert.equal(validateIsolation(null, { taskId: options.taskId }), false);
  const record = prepareIsolation(options);
  assert.equal(validateIsolation({ ...record, cwd: `${record.cwd}/../workspace` }, { taskId: options.taskId }), false);
  const manifest = path.join(path.dirname(record.cwd), 'isolation.json');
  const saved = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  saved.taskId = 'different';
  fs.writeFileSync(manifest, JSON.stringify(saved));
  assert.equal(validateIsolation(record, { taskId: options.taskId }), false);
}));
