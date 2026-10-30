#!/usr/bin/env node
import { parseArgs } from 'node:util';
import {
  describeChanges,
  emitDiagnostics,
  emitJson,
  guardrailEnvelope,
  helpEnvelope,
  isIsoTimestamp,
  isNonEmptyString,
  isRecord,
  readJson,
  submissionOutcomes,
  successEnvelope,
  validateArtifactRef,
} from './common.mjs';

const operation = 'submission:check';

function usage() {
  return helpEnvelope(
    operation,
    'node ./scripts/evidence/submission-check.mjs --task path/to/task.json --state path/to/fresh-state.json --receipt path/to/receipt.json',
    {
      '--task': 'Path to the task handoff record.',
      '--state': 'Path to the fresh-state record gathered before another submission.',
      '--receipt': 'Path to the most recent submission receipt.',
      '--help': 'Show machine-readable usage information.',
    },
    [
      'Stops unchanged retry loops and stale handoffs before another submission.',
      'Distinguishes accepted, rejected, pending, and unknown outcomes without performing any submission.',
    ],
  );
}

function validateTask(task, errors) {
  if (!isRecord(task)) {
    errors.push('task must be a JSON object');
    return;
  }

  if (!isNonEmptyString(task.task_id)) {
    errors.push('task.task_id must be a non-empty string');
  }
  if (!isNonEmptyString(task.target)) {
    errors.push('task.target must be a non-empty string');
  }
  if (!isNonEmptyString(task.task_revision)) {
    errors.push('task.task_revision must be a non-empty string');
  }
  if (!isIsoTimestamp(task.reviewed_at)) {
    errors.push('task.reviewed_at must be an ISO-8601 timestamp');
  }
  if (!isRecord(task.approved_submission)) {
    errors.push('task.approved_submission must be an object');
    return;
  }
  if (!isNonEmptyString(task.approved_submission.input_digest)) {
    errors.push('task.approved_submission.input_digest must be a non-empty string');
  }
}

function validateState(state, errors) {
  if (!isRecord(state)) {
    errors.push('state must be a JSON object');
    return;
  }

  if (!isNonEmptyString(state.state_id)) {
    errors.push('state.state_id must be a non-empty string');
  }
  if (!isNonEmptyString(state.task_id)) {
    errors.push('state.task_id must be a non-empty string');
  }
  if (!isNonEmptyString(state.target)) {
    errors.push('state.target must be a non-empty string');
  }
  if (!isNonEmptyString(state.task_revision)) {
    errors.push('state.task_revision must be a non-empty string');
  }
  if (!isIsoTimestamp(state.captured_at)) {
    errors.push('state.captured_at must be an ISO-8601 timestamp');
  }
  if (!isNonEmptyString(state.state_digest)) {
    errors.push('state.state_digest must be a non-empty string');
  }
  if (!isRecord(state.latest_feedback)) {
    errors.push('state.latest_feedback must be an object');
    return;
  }
  if (!submissionOutcomes.has(state.latest_feedback.outcome)) {
    errors.push(`state.latest_feedback.outcome must be one of ${Array.from(submissionOutcomes).join(', ')}`);
  }
  if (!isIsoTimestamp(state.latest_feedback.recorded_at)) {
    errors.push('state.latest_feedback.recorded_at must be an ISO-8601 timestamp');
  }
  if (!isNonEmptyString(state.latest_feedback.feedback_id)) {
    errors.push('state.latest_feedback.feedback_id must be a non-empty string');
  }
}

function validateReceipt(receipt, errors) {
  if (!isRecord(receipt)) {
    errors.push('receipt must be a JSON object');
    return;
  }

  if (!isNonEmptyString(receipt.operation_id)) {
    errors.push('receipt.operation_id must be a non-empty string');
  }
  if (!isNonEmptyString(receipt.target)) {
    errors.push('receipt.target must be a non-empty string');
  }
  if (!isNonEmptyString(receipt.input_digest)) {
    errors.push('receipt.input_digest must be a non-empty string');
  }
  if (!submissionOutcomes.has(receipt.outcome)) {
    errors.push(`receipt.outcome must be one of ${Array.from(submissionOutcomes).join(', ')}`);
  }
  if (!isRecord(receipt.precondition_ref)) {
    errors.push('receipt.precondition_ref must be an object');
    return;
  }
  if (!isNonEmptyString(receipt.precondition_ref.state_id)) {
    errors.push('receipt.precondition_ref.state_id must be a non-empty string');
  }
  if (!isNonEmptyString(receipt.precondition_ref.state_digest)) {
    errors.push('receipt.precondition_ref.state_digest must be a non-empty string');
  }
  if (!isNonEmptyString(receipt.precondition_ref.task_id)) {
    errors.push('receipt.precondition_ref.task_id must be a non-empty string');
  }
  if (!isNonEmptyString(receipt.precondition_ref.task_revision)) {
    errors.push('receipt.precondition_ref.task_revision must be a non-empty string');
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      task: { type: 'string' },
      state: { type: 'string' },
      receipt: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: true,
    allowPositionals: false,
  });

  if (values.help) {
    emitJson(usage());
    return 0;
  }

  const missing = ['task', 'state', 'receipt'].filter((option) => !values[option]);
  if (missing.length > 0) {
    const summary = `Missing required option(s): ${missing.map((item) => `--${item}`).join(', ')}`;
    emitDiagnostics([summary]);
    emitJson(guardrailEnvelope(operation, 'validation_failed', summary));
    return 2;
  }

  const taskFile = await readJson(values.task);
  const stateFile = await readJson(values.state);
  const receiptFile = await readJson(values.receipt);
  const errors = [];
  const warnings = [];

  validateTask(taskFile.data, errors);
  validateState(stateFile.data, errors);
  validateReceipt(receiptFile.data, errors);

  if (isRecord(receiptFile.data?.response_ref)) {
    await validateArtifactRef(
      receiptFile.data.response_ref,
      'receipt.response_ref',
      receiptFile.directory,
      errors,
      warnings,
    );
  }

  if (errors.length > 0) {
    emitDiagnostics([...errors, ...warnings.map((warning) => `warning: ${warning}`)]);
    emitJson(
      guardrailEnvelope(operation, 'validation_failed', `Submission records failed validation with ${errors.length} issue(s)`, {
        artifacts: [taskFile.absolutePath, stateFile.absolutePath, receiptFile.absolutePath],
        warnings,
        errors,
      }),
    );
    return 2;
  }

  const task = taskFile.data;
  const state = stateFile.data;
  const receipt = receiptFile.data;

  const relationErrors = [];
  if (task.task_id !== state.task_id) {
    relationErrors.push(`task.task_id ${task.task_id} did not match state.task_id ${state.task_id}`);
  }
  if (task.task_id !== receipt.precondition_ref.task_id) {
    relationErrors.push(`task.task_id ${task.task_id} did not match receipt.precondition_ref.task_id ${receipt.precondition_ref.task_id}`);
  }
  if (task.task_revision !== state.task_revision) {
    relationErrors.push(`task.task_revision ${task.task_revision} did not match state.task_revision ${state.task_revision}`);
  }
  if (task.target !== state.target || task.target !== receipt.target) {
    relationErrors.push('task.target, state.target, and receipt.target must match');
  }
  if (state.latest_feedback.outcome !== receipt.outcome) {
    relationErrors.push(
      `state.latest_feedback.outcome ${state.latest_feedback.outcome} did not match receipt.outcome ${receipt.outcome}`,
    );
  }

  if (relationErrors.length > 0) {
    emitDiagnostics(relationErrors);
    emitJson(
      guardrailEnvelope(operation, 'ambiguous_result', `Submission records disagree on ${relationErrors.length} relationship(s)`, {
        artifacts: [taskFile.absolutePath, stateFile.absolutePath, receiptFile.absolutePath],
        warnings,
        errors: relationErrors,
      }),
    );
    return 2;
  }

  if (Date.parse(state.latest_feedback.recorded_at) > Date.parse(task.reviewed_at)) {
    const summary = 'Task review is older than the latest recorded feedback';
    emitDiagnostics([summary]);
    emitJson(
      guardrailEnvelope(operation, 'stale_state', summary, {
        artifacts: [taskFile.absolutePath, stateFile.absolutePath, receiptFile.absolutePath],
        warnings,
        outcome: receipt.outcome,
      }),
    );
    return 2;
  }

  const changes = {
    inputChanged: receipt.input_digest !== task.approved_submission.input_digest,
    stateChanged: receipt.precondition_ref.state_digest !== state.state_digest,
    taskRevisionChanged: receipt.precondition_ref.task_revision !== task.task_revision,
  };
  const changeDescriptions = describeChanges(changes);

  if (receipt.outcome === 'accepted') {
    const payload = successEnvelope(operation, 'Submission already accepted; no further submission is needed', {
      artifacts: [taskFile.absolutePath, stateFile.absolutePath, receiptFile.absolutePath],
      warnings,
      outcome: receipt.outcome,
      resubmission: {
        allowed: false,
        reason: 'accepted_noop',
      },
    });
    emitDiagnostics(warnings.map((warning) => `warning: ${warning}`));
    emitJson(payload);
    return 0;
  }

  if (receipt.outcome === 'pending') {
    const summary = 'Submission is still pending; wait for a definitive receipt before retrying';
    emitDiagnostics([summary, ...warnings.map((warning) => `warning: ${warning}`)]);
    emitJson(
      guardrailEnvelope(operation, 'pending_outcome', summary, {
        artifacts: [taskFile.absolutePath, stateFile.absolutePath, receiptFile.absolutePath],
        warnings,
        outcome: receipt.outcome,
      }),
    );
    return 2;
  }

  if (receipt.outcome === 'unknown') {
    const summary = 'Submission outcome is unknown; reconcile the authoritative state before retrying';
    emitDiagnostics([summary, ...warnings.map((warning) => `warning: ${warning}`)]);
    emitJson(
      guardrailEnvelope(operation, 'ambiguous_result', summary, {
        artifacts: [taskFile.absolutePath, stateFile.absolutePath, receiptFile.absolutePath],
        warnings,
        outcome: receipt.outcome,
      }),
    );
    return 2;
  }

  if (changeDescriptions.length === 0) {
    const summary = 'Last receipt was rejected and neither input nor fresh state changed; stop the unchanged retry loop';
    emitDiagnostics([summary, ...warnings.map((warning) => `warning: ${warning}`)]);
    emitJson(
      guardrailEnvelope(operation, 'unchanged_retry_loop', summary, {
        artifacts: [taskFile.absolutePath, stateFile.absolutePath, receiptFile.absolutePath],
        warnings,
        outcome: receipt.outcome,
        resubmission: {
          allowed: false,
          reason: 'unchanged_rejection',
        },
      }),
    );
    return 2;
  }

  const summary = `Last receipt was rejected, but ${changeDescriptions.join(', ')}`;
  emitDiagnostics(warnings.map((warning) => `warning: ${warning}`));
  emitJson(
    successEnvelope(operation, summary, {
      artifacts: [taskFile.absolutePath, stateFile.absolutePath, receiptFile.absolutePath],
      warnings,
      outcome: receipt.outcome,
      resubmission: {
        allowed: true,
        reason: 'changed_prerequisite',
        changes,
      },
    }),
  );
  return 0;
}

try {
  const code = await main();
  process.exitCode = code;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);

  if (error?.validationFailure) {
    emitDiagnostics([message]);
    emitJson(guardrailEnvelope(operation, 'validation_failed', message));
    process.exitCode = 2;
  } else {
    emitDiagnostics([message]);
    emitJson(guardrailEnvelope(operation, 'internal_error', 'Unexpected failure while checking submission records'));
    process.exitCode = 1;
  }
}
