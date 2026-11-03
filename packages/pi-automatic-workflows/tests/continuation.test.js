import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { continuationStore, equivalentSelection } from '../lib/continuation.ts';
import { makeTask, applyUpdate } from '../lib/policy.ts';
import { scheduleWait, reconcileWait } from '../lib/waits.ts';
const binding = { sessionId: 'source', projectRoot: '/project', branchAnchor: 'root' };
const make = () => makeTask({ ...binding, taskId: 'task', route: 'feature', scope: 'Approved work', reason: 'test', constraints: ['No deploy'] });
const input = { id: 'job', check: 'Read result', authorization: 'Owner approved read only', responseRef: 'r1', nextDue: 2000, deadline: 10000, maxAttempts: 5 };
test('non-consuming export, validated atomic claim, original binding and duplicate safety', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'continuation-'));
  try {
    const store = continuationStore(dir), task = make();
    scheduleWait(task, input, binding, 0).attempts = 2;
    const cancelled = store.export(task); task.outgoingTicket = cancelled.transferId;
    assert.equal(store.owns(task, 'source'), true);
    store.invalidate(task);
    assert.throws(() => store.import(cancelled, { ...binding, sessionId: 'dest' }), /Stale/);
    const snapshot = store.export(task); task.outgoingTicket = snapshot.transferId;
    assert.throws(() => store.import({ ...snapshot, task: { ...snapshot.task, scope: 'expanded' } }, { ...binding, sessionId: 'dest' }), /Stale/);
    assert.throws(() => store.import(snapshot, { ...binding, sessionId: 'dest', projectRoot: '/wrong' }), /binding/);
    const imported = store.import(snapshot, { ...binding, sessionId: 'dest', branchAnchor: 'new-root' });
    assert.equal(store.owns(task, 'source'), false);
    const historical = structuredClone(task); delete historical.outgoingTicket;
    assert.equal(store.owns(historical, 'source'), false);
    assert.equal(store.owns(imported, 'dest'), true);
    assert.equal(store.owns(imported, 'fork'), false);
    assert.throws(() => store.import(snapshot, { ...binding, sessionId: 'second' }), /duplicate/);
    assert.throws(() => store.import(snapshot, { ...binding, sessionId: 'dest', branchAnchor: 'new-root' }), /duplicate/);
    assert.equal(imported.waits[0].attempts, 2);
    assert.equal(imported.waits[0].deadline, 10000);
    assert.equal(imported.waits[0].nextDue, 2000); // overdue remains due, never given a new deadline
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('export omits undefined optional properties without mutating source state', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'continuation-'));
  try {
    const store = continuationStore(dir), task = make();
    task.continuationGeneration = 0;
    task.latestResponseRef = undefined;
    task.childRuns.push({ childId: 'child', status: 'completed', isolationId: undefined, paneId: undefined, metadata: { optional: undefined, retained: false } });
    const before = structuredClone(task);
    const snapshot = store.export(task);
    assert.deepEqual(snapshot, JSON.parse(JSON.stringify(snapshot)));
    const persisted = JSON.parse(fs.readFileSync(path.join(dir, 'continuations', `${snapshot.transferId}.json`), 'utf8'));
    assert.deepEqual(snapshot, persisted.snapshot);
    assert.deepEqual(task, before);
    assert.equal(Object.hasOwn(task.childRuns[0], 'isolationId'), true);
    const imported = store.import(snapshot, { ...binding, sessionId: 'dest' });
    assert.deepEqual(imported.childRuns, [{ childId: 'child', status: 'completed', metadata: { retained: false } }]);
    assert.equal(imported.scope, task.scope);
    assert.deepEqual(imported.constraints, task.constraints);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('export does not coerce invalid JSON values into valid continuation data', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'continuation-'));
  try {
    const store = continuationStore(dir);
    for (const value of [NaN, Infinity, new Date(), [undefined]]) {
      const task = make();
      task.extra = value;
      assert.deepEqual(store.export(task).task.extra, value);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('interrupted checks require reconciliation within original budget', () => {
  const task = make(), job = scheduleWait(task, input, binding, 0);
  job.status = 'suspended'; job.reconciliationRequired = true; job.attempts = 2;
  assert.throws(() => scheduleWait(task, { ...input, id: 'bypass' }, binding, 0), /reconciliation/);
  reconcileWait(task, { id: 'job', responseRef: 'read-only-observation', nextDue: 4000 }, 3000);
  assert.equal(job.attempts, 2); assert.equal(job.deadline, 10000); assert.equal(job.status, 'scheduled');
  job.status = 'suspended'; job.attempts = 5;
  assert.throws(() => reconcileWait(task, { id: 'job', responseRef: 'r2', nextDue: 6000 }, 5000), /budget/);
});
test('equivalent cancellation/rescheduling never refreshes attempts or deadline', () => {
  const task = make();
  const first = scheduleWait(task, input, binding, 0);
  first.attempts = 2; first.status = 'cancelled';
  const second = scheduleWait(task, { ...input, id: 'second', deadline: 20000, maxAttempts: 20 }, binding, 0);
  assert.equal(second.attempts, 2); assert.equal(second.deadline, 10000); assert.equal(second.maxAttempts, 5);
  second.attempts = 5; second.status = 'cancelled';
  assert.throws(() => scheduleWait(task, { ...input, id: 'third', deadline: 20000, maxAttempts: 20 }, binding, 0), /budget exhausted/);
});
test('failure breaker independent of polling, cosmetic selection/reason/model changes do not reset', () => {
  const task = make();
  for (const check of ['Build result', ' Build   result ', 'build result']) applyUpdate(task, { action: 'verification', check, result: 'failed' });
  assert.equal(task.continuationStopped, true);
  assert.equal(equivalentSelection(task, { route: 'feature', scope: ' Approved   work ', constraints: ['No deploy'], reason: 'different', model: 'different' }, binding), true);
  assert.equal(equivalentSelection(task, { route: 'feature', scope: 'different', constraints: ['No deploy'] }, binding), false);
  applyUpdate(task, { action: 'correction', value: 'use another model' });
  assert.equal(task.continuationStopped, true);
  applyUpdate(task, { action: 'verification', check: 'other check', result: 'passed' });
  assert.equal(task.continuationStopped, true);
  applyUpdate(task, { action: 'verification', check: 'build result', result: 'passed' });
  assert.equal(task.continuationStopped, false);
});

test('divergent ancestor exports cannot revive source or stale budgets', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'continuation-'));
  try {
    const store = continuationStore(dir), task = make(), ancestor = structuredClone(task);
    const a = store.export(task);
    // Pointer lost on ancestor, but source activity still revokes A.
    ancestor.scope = 'updated'; store.invalidate(ancestor);
    const b = store.export(ancestor);
    assert.throws(() => store.import(a, { ...binding, sessionId: 'd1' }), /Stale/);
    const dest = store.import(b, { ...binding, sessionId: 'd2' });
    assert.equal(store.owns(task, 'source'), false);
    assert.equal(store.owns(dest, 'd2'), true);
    assert.throws(() => store.export(task), /stale/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('same destination replay and rewound state fail closed after progress', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'continuation-'));
  try {
    const store = continuationStore(dir), task = make();
    scheduleWait(task, input, binding, 0);
    const snapshot = store.export(task), dest = store.import(snapshot, { ...binding, sessionId: 'dest' });
    const ancestor = structuredClone(dest);
    dest.waits[0].attempts++; dest.continuationStopped = true; store.invalidate(dest);
    assert.equal(store.owns(ancestor, 'dest'), false);
    assert.equal(store.owns(dest, 'dest'), true);
    assert.throws(() => store.import(snapshot, { ...binding, sessionId: 'dest' }), /duplicate/);
    assert.equal(dest.waits[0].attempts, 1); assert.equal(dest.continuationStopped, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('competing subprocess claims across divergent tickets have exactly one owner', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'continuation-'));
  try {
    const store = continuationStore(dir), task = make();
    const a = store.export(task), b = store.export(structuredClone(task));
    const module = pathToFileURL(path.resolve(import.meta.dirname, '../lib/continuation.ts')).href;
    const gate = path.join(dir, 'go');
    const launch = (snapshot, sessionId) => new Promise(resolve => {
      const code = `import fs from 'node:fs'; import {continuationStore} from ${JSON.stringify(module)}; process.stdout.write('ready\\n'); while (!fs.existsSync(${JSON.stringify(gate)})) await new Promise(r=>setTimeout(r,1)); try { continuationStore(${JSON.stringify(dir)}).import(${JSON.stringify(snapshot)}, ${JSON.stringify({ ...binding, sessionId })}); process.exitCode=0; } catch { process.exitCode=2; }`;
      const child = spawn(process.execPath, ['--input-type=module', '-e', code]);
      child.stdout.once('data', () => { ready++; if (ready === 2) fs.writeFileSync(gate, 'go'); });
      child.on('exit', resolve);
    });
    let ready = 0;
    const results = await Promise.all([launch(a, 'd1'), launch(b, 'd2')]);
    assert.equal(results.filter(code => code === 0).length, 1);
    assert.equal(store.owns(task, 'source'), false);
    // Also race two valid claims of the same current ticket, not only divergent tickets.
    const current = store.export({ ...make(), taskId: 'second-task' });
    fs.unlinkSync(gate); ready = 0;
    const sameTicket = await Promise.all([launch(current, 'd3'), launch(current, 'd4')]);
    assert.equal(sameTicket.filter(code => code === 0).length, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
