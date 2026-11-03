import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { embedBackground } from '../src/execution.ts';

test('exact alternate models use public registry, preserve thinking and refuse old controllers', async () => {
  const events = new EventEmitter(); let calls = 0, accepted = true, failed = 0;
  events.on('workflow:child-admission', r => { r.handled = true; r.allowed = true; if (accepted) r.backendProtocolAccepted = 1; });
  events.on('workflow:child-backend-validation-failed', () => failed++);
  const runtime = embedBackground({ events, on() {}, registerTool() {}, registerCommand() {} }, (api: any) => api.registerTool({ name: 'subagent', execute(_id: string, args: any) {
    calls++; assert.equal(args.model, 'test/approved:high'); return { details: { runId: 'native' } };
  } }));
  const ctx: any = { cwd: tmpdir(), model: { provider: 'test', id: 'parent' }, modelRegistry: { find(provider: string, id: string) { return id === 'approved' ? { provider, id } : undefined; } } };
  await runtime.spawn('good', { name: 'reader', task: 'Read', model: 'test/approved:high' }, undefined, ctx);
  await assert.rejects(runtime.spawn('missing', { model: 'test/missing' }, undefined, ctx), /Unknown exact/);
  await assert.rejects(runtime.spawn('bare', { model: 'approved' }, undefined, ctx), /exact provider\/model/);
  accepted = false;
  await assert.rejects(runtime.spawn('old', { model: 'test/approved:high' }, undefined, ctx), /does not support/);
  assert.equal(calls, 1); assert.equal(failed, 1);
});
