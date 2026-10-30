import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const GUARDRAIL_EXIT_CODE = 2;
export const INTERNAL_EXIT_CODE = 1;

export const GUARDRAIL_CODES = new Set([
  'validation_failed',
  'stale_state',
  'unsupported',
  'approval_required',
  'ambiguous_result',
]);

export class GuardrailStop extends Error {
  constructor(code, summary, details = undefined) {
    super(summary);
    this.name = 'GuardrailStop';
    this.code = code;
    this.summary = summary;
    this.details = details;
  }
}

export function ensure(condition, code, summary, details = undefined) {
  if (!condition) {
    throw new GuardrailStop(code, summary, details);
  }
}

export function stableJson(value) {
  return JSON.stringify(sortValue(value));
}

function sortValue(value) {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }

  if (value && typeof value === 'object' && value.constructor === Object) {
    return Object.keys(value)
      .sort()
      .reduce((accumulator, key) => {
        accumulator[key] = sortValue(value[key]);
        return accumulator;
      }, {});
  }

  return value;
}

export function sha256String(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

export function sha256Json(value) {
  return sha256String(stableJson(value));
}

export function readJsonFile(path) {
  try {
    const content = readFileSync(path, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    throw new GuardrailStop(
      'validation_failed',
      `Could not read JSON file at ${path}.`,
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }
}

export function writeJsonFile(path, value) {
  const resolvedPath = resolve(path);
  mkdirSync(dirname(resolvedPath), { recursive: true });
  writeFileSync(resolvedPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return resolvedPath;
}

export function writeStdoutJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function writeDiagnostic(message) {
  process.stderr.write(`${message}\n`);
}

export function buildSuccessEnvelope(operation, summary, extras = {}) {
  return {
    ok: true,
    operation,
    summary,
    artifacts: [],
    warnings: [],
    ...extras,
  };
}

export function buildGuardrailEnvelope(operation, error) {
  return {
    ok: false,
    operation,
    code: error.code,
    summary: error.summary,
    artifacts: [],
    warnings: [],
    ...(error.details ? { details: error.details } : {}),
  };
}

export function isGuardrailStop(error) {
  return error instanceof GuardrailStop || (error && GUARDRAIL_CODES.has(error.code));
}

export function normalizeIssue(rawIssue) {
  ensure(rawIssue && typeof rawIssue === 'object', 'validation_failed', 'Issue payload was missing or invalid.');

  return {
    id: rawIssue.id,
    number: rawIssue.number,
    title: rawIssue.title ?? '',
    body: rawIssue.body ?? '',
    state: rawIssue.state,
    stateReason: rawIssue.stateReason ?? rawIssue.state_reason ?? null,
    updatedAt: rawIssue.updatedAt ?? rawIssue.updated_at ?? null,
    htmlUrl: rawIssue.htmlUrl ?? rawIssue.html_url ?? null,
    pullRequest: Boolean(rawIssue.pullRequest ?? rawIssue.pull_request),
  };
}

export function issueSnapshot(issue) {
  const normalized = normalizeIssue(issue);
  return {
    id: normalized.id,
    number: normalized.number,
    titleSha256: sha256String(normalized.title),
    bodySha256: sha256String(normalized.body),
    state: normalized.state,
    stateReason: normalized.stateReason,
    updatedAt: normalized.updatedAt,
    pullRequest: normalized.pullRequest,
  };
}

export function matchesIssueSnapshot(issue, snapshot) {
  return stableJson(issueSnapshot(issue)) === stableJson(snapshot);
}

export function issueMarkerMatches(issue, marker) {
  return normalizeIssue(issue).body.includes(marker);
}

export function countMutations(operations) {
  return operations.filter((operation) => operation.stepType !== 'no_op').length;
}

export function countNoOps(operations) {
  return operations.filter((operation) => operation.stepType === 'no_op').length;
}

export function redactBodyText(body) {
  return {
    sha256: sha256String(body),
    bytes: Buffer.byteLength(body, 'utf8'),
  };
}

export function redactMutation(mutation) {
  if (!mutation || typeof mutation !== 'object') {
    return mutation;
  }

  const redacted = { ...mutation };
  if (typeof redacted.body === 'string') {
    redacted.body = redactBodyText(redacted.body);
  }
  return redacted;
}

function redactVerification(verification) {
  if (!verification || typeof verification !== 'object') {
    return verification;
  }

  const redacted = { ...verification };
  if (typeof redacted.body === 'string') {
    redacted.body = redactBodyText(redacted.body);
  }
  return redacted;
}

export function redactPlanForStdout(plan) {
  return {
    kind: plan.kind,
    version: plan.version,
    createdAt: plan.createdAt,
    repository: plan.repository,
    actor: plan.actor,
    binding: plan.binding,
    approval: plan.approval,
    operations: plan.operations.map((operation) => ({
      id: operation.id,
      requestedType: operation.requestedType,
      stepType: operation.stepType,
      summary: operation.summary,
      target: operation.target,
      precondition: operation.precondition,
      mutation: redactMutation(operation.mutation),
      verification: redactVerification(operation.verification),
    })),
    warnings: plan.warnings,
  };
}

export function summarizeAppliedOperations(results) {
  const mutated = results.filter((result) => result.status === 'applied').length;
  const noOps = results.filter((result) => result.status === 'no_op').length;
  return { mutated, noOps };
}

export function desiredIssueFromCurrent(currentIssue, operation) {
  const current = normalizeIssue(currentIssue);
  const desired = {
    title: operation.title ?? current.title,
    body: operation.body ?? current.body,
    state: operation.state ?? current.state,
    stateReason: current.stateReason,
  };

  if (desired.state === 'closed') {
    desired.stateReason = operation.stateReason ?? current.stateReason ?? null;
  } else {
    desired.stateReason = null;
  }

  return desired;
}

export function buildIssueMutation(currentIssue, desiredIssue) {
  const current = normalizeIssue(currentIssue);
  const mutation = {};

  if (desiredIssue.title !== current.title) {
    mutation.title = desiredIssue.title;
  }

  if (desiredIssue.body !== current.body) {
    mutation.body = desiredIssue.body;
  }

  if (desiredIssue.state !== current.state) {
    mutation.state = desiredIssue.state;
    if (desiredIssue.state === 'closed') {
      mutation.stateReason = desiredIssue.stateReason;
    }
  }

  return mutation;
}

export function verifyIssueFields(issue, expectedFields) {
  const normalized = normalizeIssue(issue);

  if (normalized.title !== expectedFields.title) {
    return `title mismatch: expected exact approved title`;
  }

  if (normalized.body !== expectedFields.body) {
    return `body mismatch: remote issue body differed from approved bytes`;
  }

  if (normalized.state !== expectedFields.state) {
    return `state mismatch: expected ${expectedFields.state} but found ${normalized.state}`;
  }

  const expectedReason = expectedFields.stateReason ?? null;
  if ((normalized.stateReason ?? null) !== expectedReason) {
    return `state reason mismatch: expected ${expectedReason ?? 'null'} but found ${normalized.stateReason ?? 'null'}`;
  }

  if (expectedFields.marker && !normalized.body.includes(expectedFields.marker)) {
    return 'marker mismatch: approved operation marker was missing after write';
  }

  return null;
}

export function computePlanBinding({ actor, repository, operations, inputDigest }) {
  const actorDigest = sha256Json(actor);
  const targetDigest = sha256Json({
    repository: {
      host: repository.host,
      owner: repository.owner,
      name: repository.name,
    },
    targets: operations.map((operation) => ({
      id: operation.id,
      stepType: operation.stepType,
      target: operation.target,
    })),
  });
  const preconditionDigest = sha256Json(
    operations.map((operation) => ({
      id: operation.id,
      precondition: operation.precondition,
    })),
  );
  const mutationDigest = sha256Json(
    operations.map((operation) => ({
      id: operation.id,
      stepType: operation.stepType,
      mutation: operation.mutation,
      verification: operation.verification,
    })),
  );
  const planDigest = sha256Json({
    inputDigest,
    actorDigest,
    targetDigest,
    preconditionDigest,
    mutationDigest,
  });

  return {
    actorDigest,
    targetDigest,
    preconditionDigest,
    mutationDigest,
    planDigest,
  };
}

export function helpEnvelope(operation, usage, description, options) {
  return buildSuccessEnvelope(operation, description, {
    help: {
      usage,
      options,
    },
  });
}
