import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { EventEmitter } from 'node:events';
import { embedBackground } from '../src/execution.ts';

test('real controller and fake native executor enforce background admission, binding, cancellation and exact resume', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'background-admission-'));
  const old = process.env.PI_AUTOMATIC_WORKFLOWS_REVISION_STORE;
  try {
    const root = path.resolve(import.meta.dirname, '../../pi-automatic-workflows');
    for (const dir of ['extension', 'lib', 'workflows', 'principles']) fs.cpSync(path.join(root, dir), path.join(temp, dir), { recursive: true });
    fs.writeFileSync(path.join(temp, 'package.json'), '{"type":"module"}');
    const stub = path.join(temp, 'node_modules/typebox'); fs.mkdirSync(stub, { recursive: true });
    fs.writeFileSync(path.join(stub, 'package.json'), '{"type":"module","exports":"./index.js"}');
    fs.writeFileSync(path.join(stub, 'index.js'), 'export const Type=new Proxy({}, {get:()=> (...args)=>args[0]});');
    process.env.PI_AUTOMATIC_WORKFLOWS_REVISION_STORE = path.join(temp, 'store');
    const { default: install } = await import(pathToFileURL(path.join(temp, 'extension/index.js')).href);
    const hooks = new Map(), tools = new Map(), entries: any[] = [], events = new EventEmitter();
    const pi: any = { events, on: (n: string, h: any) => hooks.set(n, h), registerTool: (t: any) => tools.set(t.name, t), registerCommand() {}, appendEntry: (customType: string, data: any) => entries.push({ type: 'custom', customType, data: structuredClone(data) }) };
    const ctx: any = { cwd: temp, model: { provider: 'test', id: 'parent' }, hasUI: false, hasPendingMessages: () => false, sessionManager: { getBranch: () => entries, getSessionId: () => 'fixture', getSessionFile: () => '/parent' } };
    install(pi); hooks.get('session_start')({}, ctx);
    await tools.get('workflow_select').execute('select', { route: 'investigation', scope: 'Read source', reason: 'fixture' }, null, null, ctx);
    events.on('workflow:child-admission-probe', r => { r.supported = true; });
    let executed = 0, uncertain = false; const nativeCalls: any[] = [];
    let interrupted: string | undefined;
    events.on('workflow:child-interrupt-request', r => { interrupted = r.id; });
    const runtime = embedBackground(pi, (api: any) => api.registerTool({ name: 'subagent', execute(call: string, args: any) {
      executed++; nativeCalls.push(args);
      if (uncertain) throw Error('transport lost after dispatch');
      const id = `native-${executed}`;
      // Pinned 0.84 start payload identifies the runtime agent, not toolCallId.
      events.emit('subagent:async-started', { id, agent: args.agent ?? entries.findLast(e => e.customType === 'hybrid-background-definition')?.data.name, sessionRoot: '/real/root' });
      if (executed === 1) { ctx.signal = { aborted: true }; hooks.get('agent_end')({}, ctx); ctx.signal = { aborted: false }; }
      return { details: { runId: id } };
    } }));
    const latest = () => entries.findLast(e => e.data?.task)?.data.task;
    const call: any = { toolName: 'subagent', toolCallId: 'launch', input: { name: 'scout', task: 'Read-only analysis', model: 'test/parent:high' } };
    assert.equal(hooks.get('tool_call')(call, ctx), undefined);
    const result = await runtime.spawn('launch', call.input, undefined, ctx);
    assert.equal(executed, 1); assert.equal(nativeCalls[0].model, 'test/parent:high');
    assert.equal(latest().childRuns[0].runtimeId, result.details.id);
    assert.equal(interrupted, result.details.id, 'started-before-tool-return cancellation uses the native id');
    assert.equal(latest().childRuns[0].sessionFile, undefined);
    const count = executed;
    for (const input of [ { ...call.input, model: 'bad/model' }, { ...call.input, _workflowTaskId: 'stale' }, { ...call.input, task: 'Implement code changes' } ]) {
      await assert.rejects(runtime.spawn('denied', input, undefined, ctx));
      assert.equal(executed, count);
    }
    ctx.signal = { aborted: true }; hooks.get('agent_end')({}, ctx);
    assert.equal(interrupted, result.details.id);
    ctx.signal = { aborted: false };
    events.emit('subagent:async-complete', { runId: result.details.id, results: [{ success: true, sessionPath: '/real/session.jsonl' }] });
    assert.equal(latest().childRuns[0].sessionFile, '/real/session.jsonl');
    const resume: any = { toolName: 'subagent_resume', toolCallId: 'resume', input: { sessionPath: result.details.id, message: 'Read-only followup' } };
    assert.equal(hooks.get('tool_call')(resume, ctx), undefined);
    await runtime.execute('resume', { ...resume.input, action: 'resume', id: result.details.id }, undefined, undefined, ctx);
    assert.equal(latest().childRuns.length, 2);
    assert.equal(latest().childRuns[1].resumedFrom, latest().childRuns[0].childId);
    assert.equal(nativeCalls[1].model, undefined, 'native resume must reuse the persisted model without an override');
    assert.equal(latest().childRuns[1].resolvedModel, 'test/parent:high', 'controller still authorizes the saved model');
    assert.equal(nativeCalls[1].cwd, temp);
    assert.ok(hooks.get('tool_call')(resume, ctx)?.block);
    uncertain = true;
    await assert.rejects(runtime.spawn('uncertain', call.input, undefined, ctx), /transport lost/);
    hooks.get('tool_result')({ toolName: 'subagent', toolCallId: 'uncertain', isError: true });
    assert.equal(latest().childRuns.at(-1).status, 'active', 'unknown dispatch failure retains ownership');
    uncertain = false;
    await runtime.spawn('internal-1', call.input, undefined, ctx);
    await runtime.spawn('internal-2', call.input, undefined, ctx);
    const beforeLimit = executed;
    await assert.rejects(runtime.spawn('over-limit', call.input, undefined, ctx), /limit/i);
    assert.equal(executed, beforeLimit);
  } finally {
    if (old === undefined) delete process.env.PI_AUTOMATIC_WORKFLOWS_REVISION_STORE; else process.env.PI_AUTOMATIC_WORKFLOWS_REVISION_STORE = old;
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
