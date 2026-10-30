import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';

import { createTempFixture, runScript, sha256, writeJson } from './helpers.mjs';

async function createSubmissionFixture(t, mutate = () => {}) {
  const directory = await createTempFixture(t);
  const responseContent = 'Desk receipt response\n';
  await writeFile(path.join(directory, 'response.txt'), responseContent);
  const responseHash = sha256(responseContent);

  const task = {
    task_id: 'task-4471',
    target: 'issue://repo/4471',
    task_revision: 'task-r1',
    reviewed_at: '2025-01-02T10:00:00Z',
    approved_submission: {
      input_digest: 'input-v1',
      summary: 'Approved issue update payload',
    },
  };

  const state = {
    state_id: 'state-r1',
    task_id: 'task-4471',
    target: 'issue://repo/4471',
    task_revision: 'task-r1',
    captured_at: '2025-01-02T10:01:00Z',
    state_digest: 'state-v1',
    latest_feedback: {
      outcome: 'accepted',
      recorded_at: '2025-01-02T09:59:00Z',
      feedback_id: 'desk-1',
      summary: 'Accepted',
    },
  };

  const receipt = {
    operation_id: 'op-1',
    target: 'issue://repo/4471',
    input_digest: 'input-v1',
    outcome: 'accepted',
    remote_receipt_id: 'remote-1',
    response_ref: {
      path: './response.txt',
      sha256: responseHash,
    },
    precondition_ref: {
      state_id: 'state-r1',
      state_digest: 'state-v1',
      task_id: 'task-4471',
      task_revision: 'task-r1',
    },
    reason_codes: [],
    next_prerequisite: null,
  };

  await mutate({ directory, task, state, receipt });

  const taskPath = path.join(directory, 'task.json');
  const statePath = path.join(directory, 'state.json');
  const receiptPath = path.join(directory, 'receipt.json');
  await writeJson(taskPath, task);
  await writeJson(statePath, state);
  await writeJson(receiptPath, receipt);

  return { taskPath, statePath, receiptPath };
}

test('submission:check supports --help', () => {
  const result = runScript('scripts/evidence/submission-check.mjs', ['--help']);
  assert.equal(result.status, 0);
  assert.equal(result.stdoutJson.operation, 'submission:check');
  assert.match(result.stdoutJson.usage, /--task/);
});

test('submission:check treats accepted receipts as a no-op', async (t) => {
  const { taskPath, statePath, receiptPath } = await createSubmissionFixture(t);
  const result = runScript('scripts/evidence/submission-check.mjs', [
    '--task',
    taskPath,
    '--state',
    statePath,
    '--receipt',
    receiptPath,
  ]);

  assert.equal(result.status, 0);
  assert.equal(result.stdoutJson.ok, true);
  assert.equal(result.stdoutJson.outcome, 'accepted');
  assert.equal(result.stdoutJson.resubmission.allowed, false);
});

test('submission:check allows progress after a rejection when prerequisites changed', async (t) => {
  const { taskPath, statePath, receiptPath } = await createSubmissionFixture(t, async ({ task, state, receipt }) => {
    task.task_revision = 'task-r2';
    task.reviewed_at = '2025-01-02T10:05:00Z';
    task.approved_submission.input_digest = 'input-v2';
    state.task_revision = 'task-r2';
    state.state_id = 'state-r2';
    state.state_digest = 'state-v2';
    state.latest_feedback.outcome = 'rejected';
    state.latest_feedback.recorded_at = '2025-01-02T10:04:00Z';
    state.latest_feedback.summary = 'Need exact start-challenge ticket';
    receipt.outcome = 'rejected';
    receipt.input_digest = 'input-v1';
    receipt.precondition_ref.state_id = 'state-r1';
    receipt.precondition_ref.state_digest = 'state-v1';
    receipt.precondition_ref.task_revision = 'task-r1';
    receipt.reason_codes = ['MISSING_REQUIRED_SIGNATURE'];
    receipt.next_prerequisite = 'Refresh the exact signature requirement';
  });

  const result = runScript('scripts/evidence/submission-check.mjs', [
    '--task',
    taskPath,
    '--state',
    statePath,
    '--receipt',
    receiptPath,
  ]);

  assert.equal(result.status, 0);
  assert.equal(result.stdoutJson.ok, true);
  assert.equal(result.stdoutJson.outcome, 'rejected');
  assert.equal(result.stdoutJson.resubmission.allowed, true);
  assert.equal(result.stdoutJson.resubmission.reason, 'changed_prerequisite');
  assert.equal(result.stdoutJson.resubmission.changes.inputChanged, true);
  assert.equal(result.stdoutJson.resubmission.changes.stateChanged, true);
});

test('submission:check stops unchanged rejection retry loops', async (t) => {
  const { taskPath, statePath, receiptPath } = await createSubmissionFixture(t, async ({ state, receipt }) => {
    state.latest_feedback.outcome = 'rejected';
    state.latest_feedback.summary = 'Still missing required signature';
    receipt.outcome = 'rejected';
    receipt.reason_codes = ['MISSING_REQUIRED_SIGNATURE'];
    receipt.next_prerequisite = 'Use the exact start-challenge ticket';
  });

  const result = runScript('scripts/evidence/submission-check.mjs', [
    '--task',
    taskPath,
    '--state',
    statePath,
    '--receipt',
    receiptPath,
  ]);

  assert.equal(result.status, 2);
  assert.equal(result.stdoutJson.code, 'unchanged_retry_loop');
  assert.equal(result.stdoutJson.outcome, 'rejected');
  assert.equal(result.stdoutJson.resubmission.allowed, false);
});

test('submission:check rejects stale task handoffs when newer feedback exists', async (t) => {
  const { taskPath, statePath, receiptPath } = await createSubmissionFixture(t, async ({ state, receipt }) => {
    state.latest_feedback.outcome = 'rejected';
    state.latest_feedback.recorded_at = '2025-01-02T10:03:00Z';
    state.latest_feedback.summary = 'Need the exact start ticket signature';
    receipt.outcome = 'rejected';
    receipt.reason_codes = ['MISSING_REQUIRED_SIGNATURE'];
  });

  const result = runScript('scripts/evidence/submission-check.mjs', [
    '--task',
    taskPath,
    '--state',
    statePath,
    '--receipt',
    receiptPath,
  ]);

  assert.equal(result.status, 2);
  assert.equal(result.stdoutJson.code, 'stale_state');
  assert.match(result.stderr, /older than the latest recorded feedback/);
});

test('submission:check stops when state and receipt disagree about the outcome', async (t) => {
  const { taskPath, statePath, receiptPath } = await createSubmissionFixture(t, async ({ state, receipt }) => {
    state.latest_feedback.outcome = 'accepted';
    receipt.outcome = 'rejected';
    receipt.reason_codes = ['MISSING_REQUIRED_SIGNATURE'];
  });

  const result = runScript('scripts/evidence/submission-check.mjs', [
    '--task',
    taskPath,
    '--state',
    statePath,
    '--receipt',
    receiptPath,
  ]);

  assert.equal(result.status, 2);
  assert.equal(result.stdoutJson.code, 'ambiguous_result');
  assert.match(result.stderr, /did not match receipt\.outcome/);
});
