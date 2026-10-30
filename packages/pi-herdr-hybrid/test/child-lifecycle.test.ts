import { it } from 'node:test';
import assert from 'node:assert/strict';
import { CHILD_LIFECYCLE, outcomeStatus, recordChildLifecycle } from '../src/child-lifecycle.ts';

it('classifies observation loss conservatively, terminal evidence separately', () => {
  assert.equal(outcomeStatus({ kind: 'cancelled' }), 'unresolved');
  assert.equal(outcomeStatus({ kind: 'ping', name: 'child', message: 'help' }), 'unresolved');
  assert.equal(outcomeStatus({ kind: 'gap-exit', summary: null, exitCode: null }), 'unresolved');
  assert.equal(outcomeStatus({ kind: 'gap-exit', summary: null, exitCode: 0 }), 'completed');
  assert.equal(outcomeStatus({ kind: 'completed', summary: 'done', exitCode: 0, summarySource: 'sidecar' } as any), 'completed');
  assert.equal(outcomeStatus({ kind: 'crashed', summary: null, exitCode: 1, paneOutput: null }), 'failed');
  assert.equal(outcomeStatus({ kind: 'pane-killed', summary: null }), 'failed');
});

it('persists a versioned identity record before notifying subscribers', () => {
  const calls: any[] = [];
  const record = recordChildLifecycle({
    appendEntry: (type, data) => { calls.push(['durable', type, data]); },
    events: { emit: (type, data) => { calls.push(['event', type, data]); throw Error('subscriber'); } },
  }, { id: 'id', name: 'child', sessionFile: '/child.jsonl' }, 'unresolved', 'observation lost');
  assert.equal(calls[0][0], 'durable');
  assert.equal(calls[1][0], 'event');
  assert.equal(calls[0][1], CHILD_LIFECYCLE);
  assert.deepEqual(calls[0][2], calls[1][2]);
  assert.equal(record.version, 1);
  assert.ok(Date.parse(record.timestamp));
  assert.equal(record.status, 'unresolved');
});
