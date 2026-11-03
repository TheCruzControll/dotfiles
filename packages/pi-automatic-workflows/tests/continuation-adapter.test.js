import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

test('export/import adapter preserves overdue reads, fences source and rejects duplicate destination', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'continuation-adapter-'));
  const oldStore = process.env.PI_AUTOMATIC_WORKFLOWS_REVISION_STORE;
  const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout, originalNow = Date.now;
  let now = 1000, timer;
  globalThis.setTimeout = (fn, delay) => (timer = { fn, delay }); globalThis.clearTimeout = () => {}; Date.now = () => now;
  try {
    const root = path.resolve(import.meta.dirname, '..');
    for (const dir of ['extension', 'lib', 'workflows', 'principles']) fs.cpSync(path.join(root, dir), path.join(temp, dir), { recursive: true });
    fs.writeFileSync(path.join(temp, 'package.json'), '{"type":"module"}');
    const stub = path.join(temp, 'node_modules/typebox'); fs.mkdirSync(stub, { recursive: true });
    fs.writeFileSync(path.join(stub, 'package.json'), '{"type":"module","exports":"./index.js"}');
    fs.writeFileSync(path.join(stub, 'index.js'), 'export const Type=new Proxy({}, {get:()=> (...args)=>args[0]});');
    process.env.PI_AUTOMATIC_WORKFLOWS_REVISION_STORE = path.join(temp, 'store');
    const { default: install } = await import(pathToFileURL(path.join(temp, 'extension/index.js')));
    function runtime(id, entries = []) {
      const hooks = new Map(), tools = new Map(), bus = new Map(), emitted = [], sent = [];
      const pi = { sendMessage: message => sent.push(message), on: (n, h) => hooks.set(n, h), registerTool: t => tools.set(t.name, t), registerCommand: () => {}, appendEntry: (customType, data) => entries.push({ id: `e${entries.length}`, type: 'custom', customType, data: structuredClone(data) }), events: { on: (n, h) => bus.set(n, h), emit: (n, data) => emitted.push({ n, data }) } };
      const ctx = { cwd: temp, hasUI: false, isIdle: () => true, hasPendingMessages: () => false, sessionManager: { getBranch: () => entries, getSessionId: () => id } };
      install(pi);
      return { hooks, tools, bus, ctx, entries, emitted, sent, call: (name, args) => tools.get(name).execute('test', args, null, null, ctx) };
    }
    const source = runtime('source'); await source.hooks.get('session_start')({}, source.ctx);
    const selection = { route: 'feature', scope: 'Read review', reason: 'fixture' };
    await source.call('workflow_select', selection);
    await source.call('workflow_wait', { action: 'schedule', check: 'Read review result', authorization: 'Owner read authorization', responseRef: 'r1', nextDue: 2000, deadline: 10000, maxAttempts: 5 });
    const before = structuredClone(source.entries.at(-1).data.task);
    await source.call('workflow_select', { ...selection, reason: 'cosmetic change' });
    assert.deepEqual(source.entries.at(-1).data.task, before);
    const preExportBranch = structuredClone(source.entries);
    let snapshot;
    source.bus.get('workflow:continuation-export')({ projectRoot: temp, respond: value => { snapshot = value; } });
    assert.equal(snapshot.schemaVersion, 1);
    const rewoundSource = runtime('source', preExportBranch);
    await rewoundSource.hooks.get('session_start')({}, rewoundSource.ctx);
    assert.equal((await rewoundSource.call('workflow_update', { action: 'stage', value: 'changed' })).isError, true);
    let divergentExport;
    rewoundSource.bus.get('workflow:continuation-export')({ projectRoot: temp, respond: value => { divergentExport = value; } });
    assert.equal(divergentExport, undefined); // fail closed rather than exporting ancestor budgets
    now = 3000;
    const transfer = { id: 'transfer', type: 'custom', customType: 'workflow:continuation-transfer', data: snapshot };
    const dest = runtime('dest', [transfer]); await dest.hooks.get('session_start')({}, dest.ctx);
    const job = dest.entries.at(-1).data.task.waits[0];
    assert.equal(job.nextDue, 2000); assert.equal(job.deadline, 10000); assert.equal(job.status, 'scheduled');
    assert.equal(timer.delay, 0);
    timer.fn();
    assert.equal(dest.sent.length, 1);
    assert.equal(dest.entries.at(-1).data.task.waits[0].attempts, 1);
    let interruptedSnapshot;
    dest.bus.get('workflow:continuation-export')({ projectRoot: temp, respond: value => { interruptedSnapshot = value; } });
    // A further explicit transfer suspends an interrupted check, never replays it.
    const interrupted = runtime('interrupted', [{ ...transfer, data: interruptedSnapshot }]);
    await interrupted.hooks.get('session_start')({}, interrupted.ctx);
    const recovered = interrupted.entries.at(-1).data.task.waits[0];
    assert.equal(recovered.status, 'suspended'); assert.equal(recovered.reconciliationRequired, true);
    assert.equal(recovered.attempts, 1); assert.equal(interrupted.sent.length, 0);
    assert.equal((await dest.call('workflow_wait', { action: 'list' })).isError, true);
    assert.equal(interrupted.hooks.get('tool_call')({ toolName: 'bash', input: {} }, interrupted.ctx).block, true);
    assert.equal((await source.call('workflow_wait', { action: 'list' })).isError, true);
    assert.equal(source.hooks.get('tool_call')({ toolName: 'bash', input: {} }, source.ctx).block, true);
    const duplicate = runtime('duplicate', [transfer]); await duplicate.hooks.get('session_start')({}, duplicate.ctx);
    assert.equal(duplicate.entries.length, 1);
    // Different inputs and failure classifications cannot trip one shared budget.
    for (const [command, code] of [['secret command', 'ENOENT'], ['secret command', 'EACCES'], ['different command', 'ENOENT']]) interrupted.hooks.get('tool_result')({ toolName: 'bash', input: { command }, details: { code }, isError: true });
    assert.notEqual(interrupted.entries.at(-1).data.task.continuationStopped, true);
    // Real failure dispatch hashes command identity and emits metadata only.
    for (let i = 0; i < 3; i++) interrupted.hooks.get('tool_result')({ toolName: 'bash', input: { command: ' secret command ', model: `m${i}` }, isError: true });
    assert.equal(interrupted.entries.at(-1).data.task.continuationStopped, true);
    assert.equal(interrupted.hooks.get('tool_call')({ toolName: 'bash', input: {} }, interrupted.ctx).block, true);
    assert.equal(interrupted.hooks.get('tool_call')({ toolName: 'read', input: {} }, interrupted.ctx), undefined);
    const repeats = interrupted.emitted.filter(e => e.n === 'workflow:evidence' && e.data.eventType === 'equivalent_failure');
    assert.equal(repeats.length, 2);
    assert.ok(!JSON.stringify(repeats).includes('secret command'));
    const failedState = structuredClone(interrupted.entries.at(-1).data.task);
    interrupted.entries.splice(1); // rewind to transfer custom entry, after attempt and breaker progress
    await interrupted.hooks.get('session_tree')({}, interrupted.ctx);
    assert.equal(interrupted.entries.length, 1);
    assert.equal((await interrupted.call('workflow_wait', { action: 'list' })).isError, true);
    assert.equal(interrupted.hooks.get('tool_call')({ toolName: 'bash', input: {} }, interrupted.ctx).block, true);
    assert.equal(failedState.continuationStopped, true);
    assert.equal(failedState.waits[0].attempts, 1);
    assert.deepEqual(interrupted.emitted.find(e => e.n === 'workflow:continuation-state').data, { schemaVersion: 1, state: 'suspended', reason: 'equivalent-failure-budget', count: 3 });
  } finally {
    globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear; Date.now = originalNow;
    if (oldStore === undefined) delete process.env.PI_AUTOMATIC_WORKFLOWS_REVISION_STORE; else process.env.PI_AUTOMATIC_WORKFLOWS_REVISION_STORE = oldStore;
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
