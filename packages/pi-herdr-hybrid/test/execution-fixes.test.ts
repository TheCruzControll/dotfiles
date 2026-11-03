import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import hybrid, { __test__ } from '../index.ts';
import { embedBackground } from '../src/execution.ts';
import { registerAgent } from 'pi-subagents/agents';
import { resolveSubagentLaunchContract } from 'pi-subagents/preflight';

test('runtime registrations are released after 220 identical launches and 220 failures', async () => {
  let fail = false;
  const runtime = embedBackground({ on() {}, registerTool() {}, registerCommand() {} }, (api: any) => {
    api.registerTool({ name: 'subagent', execute() {
      if (fail) throw Error('fixture failure');
      return { details: { runId: 'run' } };
    } });
  });
  for (let i = 0; i < 220; i++) await runtime.spawn('call', { name: 'Worker', task: 'Read' }, undefined, { cwd: tmpdir() });
  fail = true;
  for (let i = 0; i < 220; i++) await assert.rejects(runtime.spawn('call', { name: 'Worker', task: 'Read' }, undefined, { cwd: tmpdir() }), /fixture failure/);
  fail = false;
  await runtime.spawn('call', { name: 'Worker', task: 'Read' }, undefined, { cwd: tmpdir() });
});

test('upstream 0.84.0 public preflight cannot resolve public runtime registrations (not required for selector admission)', async () => {
  const pi = { on() {}, registerTool() {} };
  const name = 'hybrid-preflight-regression';
  const registration = registerAgent({ pi: pi as any, name, definition: { description: 'Fixture', systemPrompt: 'Read only', model: 'test/parent', tools: ['read'] } });
  try {
    const result = await resolveSubagentLaunchContract({ agent: name, cwd: tmpdir(), runtimeSnapshotHost: pi as any,
      parentModel: { provider: 'test', id: 'parent' }, availableModels: [{ provider: 'test', id: 'parent' }] });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'missing_agent');
  } finally { registration.dispose(); }
});

test('saved definitions are recreated only for resume, then released again', async () => {
  const entries: any[] = [];
  let facade: any;
  const runtime = embedBackground({ on() {}, registerTool() {}, registerCommand() {}, appendEntry(customType: string, data: any) { entries.push({ customType, data }); } }, (api: any) => {
    facade = api;
    api.registerTool({ name: 'subagent', execute(_id: string, args: any) {
      if (args.action === 'resume') {
        const saved = entries.find(entry => entry.customType === 'hybrid-background-definition').data;
        assert.throws(() => registerAgent({ pi: facade, name: saved.name, definition: saved.definition }), /collides/);
      }
      return { details: { runId: args.action === 'resume' ? 'resumed' : 'original' } };
    } });
  });
  const ctx = { cwd: tmpdir(), sessionManager: { getBranch: () => entries } };
  await runtime.spawn('spawn', { name: 'Worker', task: 'Read' }, undefined, ctx);
  const saved = entries.find(entry => entry.customType === 'hybrid-background-definition').data;
  registerAgent({ pi: facade, name: saved.name, definition: saved.definition }).dispose();
  await runtime.execute('resume', { action: 'resume', id: 'original' }, undefined, undefined, ctx);
  assert.equal(entries.at(-1).data.id, 'resumed');
  registerAgent({ pi: facade, name: saved.name, definition: saved.definition }).dispose();
});

test('session_tree restores branch native identities without retaining identities from another branch', async () => {
  const hooks = new Map(), tools = new Map(), calls: any[] = [];
  __test__.setBackgroundInitializer((api: any) => api.registerTool({ name: 'subagent', execute(_id: string, input: any) { calls.push(input); return { details: {} }; } }));
  try {
    hybrid({ registerTool(t: any) { tools.set(t.name, t); }, registerCommand() {}, registerMessageRenderer() {},
      on(name: string, handler: any) { hooks.set(name, handler); }, events: { on() {}, emit() {} }, appendEntry() {} } as any);
    const ctx = (id: string) => ({ cwd: tmpdir(), sessionManager: { getBranch: () => [{ customType: 'hybrid-background', data: { id } }], getSessionFile: () => '/parent' } });
    hooks.get('session_tree')({}, ctx('branch-a'));
    hooks.get('session_tree')({}, ctx('branch-b'));
    const refused = await tools.get('subagent_resume').execute('preflight', { sessionPath: 'branch-b', preflight: { cwd: '/missing' } }, undefined, undefined, ctx('branch-b'));
    assert.ok(refused.details.error, 'Background resume must not silently discard preflight');
    assert.equal(calls.length, 0);
    await tools.get('subagent_resume').execute('call', { sessionPath: 'branch-b' }, undefined, undefined, ctx('branch-b'));
    assert.equal(calls[0].id, 'branch-b');
    const previous = await tools.get('subagent_resume').execute('call', { sessionPath: 'branch-a' }, undefined, undefined, ctx('branch-b'));
    assert.equal(calls.length, 1);
    assert.ok(previous.details.error);
  } finally { __test__.setBackgroundInitializer(undefined); __test__.reset(); }
});

test('owned Background tools advertise admission without requiring a Herdr pane', () => {
  const handlers = new Map(), tools = new Map();
  const old = process.env.HERDR_PANE_ID;
  delete process.env.HERDR_PANE_ID;
  __test__.setBackgroundInitializer(() => {});
  try {
    hybrid({ registerTool(t: any) { tools.set(t.name, { ...t, sourceInfo: { path: new URL('../index.ts', import.meta.url).pathname } }); },
      getAllTools: () => [...tools.values()], registerCommand() {}, registerMessageRenderer() {}, on() {},
      events: { on(name: string, handler: any) { handlers.set(name, handler); }, emit() {} }, appendEntry() {} } as any);
    const probe = { version: 1, toolName: 'subagent', supported: false };
    handlers.get('workflow:child-admission-probe')(probe);
    assert.equal(probe.supported, true);
  } finally {
    if (old !== undefined) process.env.HERDR_PANE_ID = old;
    __test__.setBackgroundInitializer(undefined); __test__.reset();
  }
});
