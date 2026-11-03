import test from 'node:test';
import assert from 'node:assert/strict';
import { FRICTION_TYPES, normalizeWorkflowEvidence, registerWorkflowEvidenceListener, summarizeFriction } from '../extension/workflow-observer/lib/workflow-evidence.js';

test('owner friction facts reuse bounded evidence events during running and remain advisory', () => {
  const handlers = new Map();
  const records = [];
  registerWorkflowEvidenceListener({ events: { on: (name, fn) => handlers.set(name, fn) } }, {
    recordWorkflowEvidence: (record) => records.push(normalizeWorkflowEvidence(record)),
  });
  FRICTION_TYPES.forEach((eventType, i) => handlers.get('workflow:evidence')({
    schemaVersion: 1, eventId: `event-${i}`, eventType, projectPath: process.cwd(),
    sessionAnchor: 'session-1', taskId: 'task-1', workflowRevision: 'rev-1',
    timestamp: new Date(0).toISOString(), evidenceRefs: ['owner-fact-1'],
  }));
  assert.equal(records.length, 7);
  assert.throws(() => normalizeWorkflowEvidence({ ...records[0], evidenceRefs: [] }), /source ref/);
  assert.deepEqual(Object.values(summarizeFriction([...records, ...records]).counts), Array(7).fill(1));
  assert.equal(summarizeFriction(records).advisory, true);
  const size = records.length;
  handlers.get('workflow:evidence')({ ...records[0], transcript: 'private' });
  assert.equal(records.length, size);
  assert.deepEqual(Object.values(summarizeFriction([{ eventId: 'gap', eventType: 'settled' }]).counts), Array(7).fill(0));
});
