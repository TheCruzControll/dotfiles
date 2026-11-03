import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import hybrid, { __test__ } from '../index.ts';
import { registerWorkflows } from '../src/workflows.ts';
import { backgroundRequest, embedBackground, readExecutionMode, writeExecutionMode } from '../src/execution.ts';

test('persistent preference defaults to Background; Pane and reset round-trip', () => {
  const old = process.env.PI_CODING_AGENT_DIR;
  const dir = mkdtempSync(join(tmpdir(), 'hybrid-mode-'));
  process.env.PI_CODING_AGENT_DIR = dir;
  try {
    assert.equal(readExecutionMode(), 'background');
    writeExecutionMode('pane'); assert.equal(readExecutionMode(), 'pane');
    writeExecutionMode('reset'); assert.equal(readExecutionMode(), 'background');
    writeFileSync(join(dir, 'hybrid-execution.json'), '{"executionMode":"oops"}');
    assert.throws(readExecutionMode, /Invalid/);
  } finally { if (old === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = old; rmSync(dir, { recursive: true }); }
});

test('translation preserves explicit restrictions; unsupported child config fails before execution', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hybrid-request-'));
  try {
    const request = backgroundRequest({ name: 'Review', task: 'Review', tools: 'read,grep', skills: 'review', systemPrompt: 'Be precise' }, dir);
    assert.deepEqual(request.definition.tools, ['read', 'grep']);
    assert.deepEqual(request.definition.skills, ['review']);
    assert.equal(request.definition.systemPrompt, 'Be precise');
    assert.equal(request.definition.inheritProjectContext, true);
    assert.equal(request.definition.inheritGlobalContext, true);
    assert.equal(request.definition.inheritSkills, true);
    assert.equal(request.context, 'fresh');
    assert.equal(backgroundRequest({ name: 'X', fork: true }, dir).context, 'fork');
    assert.throws(() => backgroundRequest({ interactive: true }, dir), /Pane/);
    mkdirSync(join(dir, '.pi', 'agent'), { recursive: true });
    assert.throws(() => backgroundRequest({}, dir), /child-specific.*Pane/);
  } finally { rmSync(dir, { recursive: true }); }
});

test('lineage-only profile maps to fresh, explicit standalone fails closed', () => {
  const old = process.env.PI_CODING_AGENT_DIR;
  const dir = mkdtempSync(join(tmpdir(), 'hybrid-lineage-'));
  process.env.PI_CODING_AGENT_DIR = dir;
  try {
    mkdirSync(join(dir, 'agents'));
    writeFileSync(join(dir, 'agents', 'lineage-contract.md'), '---\nsession-mode: lineage-only\n---\nKeep lineage.\n');
    assert.equal(backgroundRequest({ name: 'X', agent: 'lineage-contract' }, tmpdir()).context, 'fresh');
    writeFileSync(join(dir, 'agents', 'relative-contract.md'), '---\ncwd: child-relative\ninheritSkills: false\n---\nRead only.\n');
    const relative = backgroundRequest({ name: 'X', agent: 'relative-contract' }, tmpdir());
    assert.equal(relative.cwd, join(dir, 'child-relative'));
    assert.equal(relative.definition.inheritSkills, false);
    assert.equal(relative.definition.inheritProjectContext, true);
    assert.equal(relative.definition.inheritGlobalContext, true);
    writeFileSync(join(dir, 'agents', 'standalone-contract.md'), '---\nsession-mode: standalone\n---\nNo parent.\n');
    assert.throws(() => backgroundRequest({ name: 'X', agent: 'standalone-contract' }, tmpdir()), /standalone.*Pane/);
  } finally { if (old === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = old; rmSync(dir, { recursive: true }); }
});

test('facade captures repins, omits loader deliberately, and forwards lifecycle/events/native management', async () => {
  const registered: any[] = [], handlers: any[] = [];
  const events = {};
  let facade: any;
  const pi = { events, registerTool: (t: any) => registered.push(t), registerCommand() {}, on: (...a: any[]) => handlers.push(a) };
  const runtime = embedBackground(pi, (api: any) => {
    facade = api;
    api.on('session_start', () => {});
    api.registerTool({ name: 'subagents_enable' });
    api.registerTool({ name: 'subagent', execute: () => 'first' });
  });
  assert.equal(facade.events, events);
  assert.equal(handlers.length, 1);
  assert.deepEqual(registered.map(t => t.name), ['subagent_native']);
  assert.equal(await runtime.execute('id', {}, null, null, {}), 'first');
  facade.registerTool({ name: 'subagent', execute: () => 'repinned' });
  assert.equal(await runtime.execute('id', {}, null, null, {}), 'repinned');
});

test('background spawn uses captured executor asynchronously and retains exact upstream id', async () => {
  let args: any;
  const runtime = embedBackground({ on() {}, registerTool() {}, registerCommand() {} }, (api: any) => {
    api.registerTool({ name: 'subagent', execute: (_id: any, params: any) => {
      args = params;
      return { content: [], details: { runId: 'original-run-42' } };
    } });
  });
  const result = await runtime.spawn('call', { name: 'Worker', task: 'Work', tools: 'read' }, undefined, { cwd: tmpdir() });
  assert.equal(args.async, true);
  assert.equal(args.options.context, 'fresh');
  assert.equal(result.details.id, 'original-run-42');
  assert.equal(result.details.executionMode, 'background');
});

test('Hybrid routes exact background resume and interrupt identities; conversions fail closed', async () => {
  const old = process.env.PI_CODING_AGENT_DIR;
  const dir = mkdtempSync(join(tmpdir(), 'hybrid-resume-'));
  process.env.PI_CODING_AGENT_DIR = dir;
  const calls: any[] = [], tools = new Map<string, any>();
  __test__.setBackgroundInitializer((api: any) => api.registerTool({ name: 'subagent', execute: (_id: any, params: any) => {
    calls.push(params);
    return { content: [], details: { runId: params.action === 'resume' ? 'run-2' : 'run-1' } };
  } }));
  try {
    hybrid({ registerTool(t: any) { tools.set(t.name, t); }, registerCommand() {}, registerMessageRenderer() {}, on() {}, events: { on() {}, emit() {} }, appendEntry() {} } as any);
    const ctx = { cwd: tmpdir(), sessionManager: { getSessionFile: () => '/parent.jsonl' } };
    const spawn = await tools.get('subagent').execute('launch', { name: 'Worker', task: 'Work' }, undefined, undefined, ctx);
    assert.equal(spawn.details.id, 'run-1');
    writeExecutionMode('pane');
    await tools.get('subagent_resume').execute('resume', { sessionPath: 'run-1' }, undefined, undefined, ctx);
    assert.equal(calls[1].action, 'resume'); assert.equal(calls[1].id, 'run-1');
    await tools.get('subagent_interrupt').execute('interrupt', { id: 'run-2' });
    assert.equal(calls[2].action, 'interrupt'); assert.equal(calls[2].id, 'run-2');
    const refused = await tools.get('subagent_resume').execute('convert', { sessionPath: 'run-1', executionMode: 'pane' }, undefined, undefined, ctx);
    assert.equal(refused.details.error, 'unsupported resume');
    assert.equal(calls.length, 3);
  } finally {
    __test__.setBackgroundInitializer(undefined); __test__.reset();
    if (old === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = old;
    rmSync(dir, { recursive: true });
  }
});

test('chain freezes backend across preference changes', async () => {
  const old = process.env.PI_CODING_AGENT_DIR;
  const dir = mkdtempSync(join(tmpdir(), 'hybrid-chain-mode-'));
  process.env.PI_CODING_AGENT_DIR = dir;
  try {
    let tool: any;
    const launched: any[] = [];
    const observe = registerWorkflows({ registerTool(t: any) { tool = t; }, on() {}, appendEntry() {}, sendMessage() {} }, async (params: any) => {
      launched.push(params); return { details: { id: `child-${launched.length}` } };
    }, async () => {});
    await tool.execute('call', { action: 'start', mode: 'chain', steps: [{ key: 'a', task: 'A' }, { key: 'b', task: 'B' }] }, undefined, undefined, {});
    writeExecutionMode('pane');
    await observe('child-1', { kind: 'completed', summary: 'done' });
    assert.deepEqual(launched.map(p => p.executionMode), ['background', 'background']);
  } finally { if (old === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = old; rmSync(dir, { recursive: true }); }
});
