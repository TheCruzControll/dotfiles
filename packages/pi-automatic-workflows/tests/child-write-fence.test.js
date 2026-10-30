import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createChildWriteFence } from '../lib/child-write-fence.ts';
const sdkPath = '/Users/franciscruz/.pi/agent/install/releases/1.4.0/node_modules/@earendil-works/pi-coding-agent/dist/index.js';
function fixture(options = {}) {
  const tools = new Map();
  const sourceInfo = { path: '/owned/extension/index.js', source: 'local', scope: 'project', origin: 'top-level' };
  tools.set('workflow_select', { name: 'workflow_select', sourceInfo });
  const pi = { registerTool: t => tools.set(t.name, { ...t, sourceInfo }), getAllTools: () => [...tools.values()] };
  return { tools, fence: createChildWriteFence(pi, sourceInfo.path, { child: true, loadSDK: () => import(sdkPath), ...options }) };
}
test('parent unchanged; uninitialized, unsupported and failed children fail closed even without routing', async () => {
  const ctx = { cwd: process.cwd() };
  const parent = fixture({ child: false });
  await parent.fence.initialize(ctx);
  assert.equal(parent.tools.size, 1);
  assert.equal(parent.fence.guard({ toolName: 'bash' }, ctx), undefined);
  assert.equal(parent.fence.userBash({}, ctx), undefined);
  for (const options of [{ platform: 'linux' }, { loadSDK: async () => { throw Error('SDK failed'); } }]) {
    const { fence } = fixture(options);
    assert.ok(fence.guard({ toolName: 'write' }, ctx).block);
    assert.throws(() => fence.userBash({}, ctx));
    await fence.initialize(ctx);
    assert.ok(fence.guard({ toolName: 'edit' }, ctx).block);
    assert.throws(() => fence.userBash({}, ctx));
  }
});
test('disabled routing and project opt-out cannot bypass the child gate', async () => {
  const base = await fs.mkdtemp(path.join(process.cwd(), '.fence-test-disabled-'));
  for (const dir of ['extension', 'lib']) await fs.cp(new URL(`../${dir}`, import.meta.url), path.join(base, dir), { recursive: true });
  const stub = path.join(base, 'node_modules/typebox');
  await fs.mkdir(stub, { recursive: true });
  await fs.writeFile(path.join(base, 'package.json'), '{"type":"module"}');
  await fs.writeFile(path.join(stub, 'package.json'), '{"type":"module","exports":"./index.js"}');
  await fs.writeFile(path.join(stub, 'index.js'), 'export const Type=new Proxy({}, {get:()=> (...args)=>args[0]});');
  await fs.writeFile(path.join(base, '.pi-workflows-off'), '');
  const previous = process.env.PI_SUBAGENT_CHILD;
  process.env.PI_SUBAGENT_CHILD = '1';
  try {
    const { default: install } = await import(pathToFileURL(path.join(base, 'extension/index.js')));
    const hooks = new Map();
    install({ on: (name, fn) => hooks.set(name, fn), registerTool() {}, registerCommand() {}, events: { on() {} } });
    const ctx = { cwd: base, hasUI: false, sessionManager: { getBranch: () => [{ type: 'custom', customType: 'automatic-workflows', data: { schemaVersion: 1, action: 'setting', enabled: false } }] } };
    assert.ok(hooks.get('tool_call')({ toolName: 'bash' }, ctx).block);
    await hooks.get('session_start')({}, ctx);
    assert.ok(hooks.get('tool_call')({ toolName: 'write' }, ctx).block);
    assert.throws(() => hooks.get('user_bash')({}, ctx));
  } finally {
    if (previous === undefined) delete process.env.PI_SUBAGENT_CHILD;
    else process.env.PI_SUBAGENT_CHILD = previous;
  }
});
test('Darwin actual SDK operations enforce write scope and preserve normal contracts', { skip: process.platform !== 'darwin' }, async () => {
  // Both allowed root and denied sibling live in the owned repository.
  const base = await fs.mkdtemp(path.join(process.cwd(), '.fence-test-'));
  const inside = path.join(base, 'inside');
  await fs.mkdir(inside);
  const ctx = { cwd: inside, sessionManager: { getSessionId: () => 'fixture', getSessionFile: () => undefined } };
  const { fence, tools } = fixture();
  await fence.initialize(ctx);
  assert.equal(fence.guard({ toolName: 'bash' }, ctx), undefined);
  const execute = (name, args, signal) => tools.get(name).execute('test', args, signal, undefined, ctx);
  const failed = async promise => { try { const r = await promise; assert.equal(r.isError, true); } catch (e) { if (e.code === 'ERR_ASSERTION') throw e; } };
  await execute('write', { path: 'nested/a', content: 'hello' });
  await execute('edit', { path: 'nested/a', edits: [{ oldText: 'hello', newText: 'world' }] });
  assert.equal(await fs.readFile(path.join(inside, 'nested/a'), 'utf8'), 'world');
  await execute('bash', { command: 'printf ok > shell' });
  assert.equal(await fs.readFile(path.join(inside, 'shell'), 'utf8'), 'ok');
  const temp = await fs.mkdtemp('/tmp/workflow-fence-test-');
  const canonicalTemp = await fs.realpath(temp);
  for (const [index, root] of [temp, canonicalTemp].entries()) {
    const target = path.join(root, `nested/log-${index}`);
    await execute('write', { path: target, content: 'hello' });
    await execute('edit', { path: target, edits: [{ oldText: 'hello', newText: 'world' }] });
    assert.equal(await fs.readFile(target, 'utf8'), 'world');
    await execute('bash', { command: `printf logged > '${root}/shell-${index}'` });
    assert.equal(await fs.readFile(path.join(root, `shell-${index}`), 'utf8'), 'logged');
  }
  await fs.writeFile(path.join(base, 'outside'), 'untouched');
  await fs.symlink(base, path.join(inside, 'escape'));
  await fs.symlink(base, path.join(temp, 'escape'));
  for (const target of ['../outside', 'escape/outside', `${temp}/escape/outside`, `${canonicalTemp}/escape/outside`]) {
    await failed(execute('write', { path: target, content: 'bad' }));
    await failed(execute('edit', { path: target, edits: [{ oldText: 'untouched', newText: 'bad' }] }));
    await failed(execute('bash', { command: `printf bad > ${target}` }));
  }
  await failed(execute('write', { path: '../denied/a', content: 'bad' }));
  await assert.rejects(fs.stat(path.join(base, 'denied')));
  assert.equal(await fs.readFile(path.join(base, 'outside'), 'utf8'), 'untouched');
  await failed(execute('bash', { command: 'sleep 5', timeout: 0.05 }));
  const abort = new AbortController();
  const pending = execute('bash', { command: 'sleep 5' }, abort.signal);
  abort.abort();
  await failed(pending);
  const ops = fence.userBash({}, ctx).operations;
  const tempResult = await ops.exec(`printf monitored > '${temp}/user-shell'`, inside, { onData() {} });
  assert.equal(tempResult.exitCode, 0);
  assert.equal(await fs.readFile(path.join(temp, 'user-shell'), 'utf8'), 'monitored');
  const userResult = await ops.exec('printf bad > ../outside', inside, { onData() {} });
  assert.notEqual(userResult.exitCode, 0);
  assert.ok(fence.guard({ toolName: 'write' }, { cwd: base }).block);
  tools.get('bash').sourceInfo = { path: '/other' };
  assert.ok(fence.guard({ toolName: 'bash' }, ctx).block);
  assert.throws(() => fence.userBash({}, ctx));
});
