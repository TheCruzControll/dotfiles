import {
  GuardrailStop,
  buildIssueMutation,
  computePlanBinding,
  countMutations,
  countNoOps,
  desiredIssueFromCurrent,
  ensure,
  issueMarkerMatches,
  issueSnapshot,
  normalizeIssue,
  sha256Json,
} from './common.mjs';

function validateActor(actor) {
  ensure(actor && typeof actor === 'object', 'validation_failed', 'Request actor is required.');
  ensure(typeof actor.login === 'string' && actor.login.length > 0, 'validation_failed', 'Request actor.login is required.');
  ensure(typeof actor.host === 'string' && actor.host.length > 0, 'validation_failed', 'Request actor.host is required.');
}

function validateRepository(repository) {
  ensure(repository && typeof repository === 'object', 'validation_failed', 'Request repository is required.');
  ensure(typeof repository.owner === 'string' && repository.owner.length > 0, 'validation_failed', 'Request repository.owner is required.');
  ensure(typeof repository.name === 'string' && repository.name.length > 0, 'validation_failed', 'Request repository.name is required.');
  ensure(typeof repository.host === 'string' && repository.host.length > 0, 'validation_failed', 'Request repository.host is required.');
}

function validateOperations(operations) {
  ensure(Array.isArray(operations) && operations.length > 0, 'validation_failed', 'Request operations must contain at least one item.');

  for (const [index, operation] of operations.entries()) {
    ensure(operation && typeof operation === 'object', 'validation_failed', `Operation ${index + 1} must be an object.`);
    ensure(typeof operation.id === 'string' && operation.id.length > 0, 'validation_failed', `Operation ${index + 1} is missing id.`);
    ensure(operation.type === 'create_issue' || operation.type === 'update_issue', 'unsupported', `Operation ${operation.id} used unsupported type ${operation.type}.`);

    if (operation.type === 'create_issue') {
      ensure(typeof operation.title === 'string' && operation.title.length > 0, 'validation_failed', `Operation ${operation.id} requires title.`);
      ensure(typeof operation.body === 'string', 'validation_failed', `Operation ${operation.id} requires body.`);
      ensure(typeof operation.marker === 'string' && operation.marker.length > 0, 'validation_failed', `Operation ${operation.id} requires marker.`);
      ensure(operation.body.includes(operation.marker), 'validation_failed', `Operation ${operation.id} body must contain its marker.`);
      ensure(!('state' in operation) && !('stateReason' in operation), 'unsupported', `Operation ${operation.id} cannot create a non-open issue in v1.`);
    }

    if (operation.type === 'update_issue') {
      ensure(operation.issue && Number.isInteger(operation.issue.number) && operation.issue.number > 0, 'validation_failed', `Operation ${operation.id} requires issue.number.`);

      if ('state' in operation) {
        ensure(operation.state === 'open' || operation.state === 'closed', 'validation_failed', `Operation ${operation.id} state must be open or closed.`);
      }

      if ('stateReason' in operation) {
        ensure(operation.stateReason === 'completed' || operation.stateReason === 'not_planned', 'validation_failed', `Operation ${operation.id} stateReason must be completed or not_planned.`);
        ensure(operation.state === 'closed', 'validation_failed', `Operation ${operation.id} stateReason requires state=closed.`);
      }
    }
  }
}

function validateRequest(request) {
  ensure(request && typeof request === 'object', 'validation_failed', 'Request payload must be a JSON object.');
  validateActor(request.actor);
  validateRepository(request.repository);
  validateOperations(request.operations);
}

function summarizeCreatePlan(stepType, number) {
  if (stepType === 'create_issue') {
    return 'Create a new issue from the approved title/body.';
  }

  if (stepType === 'patch_issue') {
    return `Reuse existing marker-matched issue #${number} instead of creating a duplicate.`;
  }

  return `Marker-matched issue #${number} already satisfies the approved state.`;
}

function summarizeUpdatePlan(stepType, number) {
  if (stepType === 'patch_issue') {
    return `Update issue #${number} to the exact approved state.`;
  }

  return `Issue #${number} already satisfies the approved state.`;
}

async function planCreateOperation({ operation, repository, transport }) {
  const issues = await transport.listIssues(repository);
  const matches = issues.filter((issue) => issueMarkerMatches(issue, operation.marker));

  ensure(
    matches.filter((issue) => issue.pullRequest).length === 0,
    'ambiguous_result',
    `Operation ${operation.id} matched a pull request body with the approved marker. Resolve manually before applying.`,
  );
  ensure(matches.length <= 1, 'ambiguous_result', `Operation ${operation.id} matched multiple issues with the same marker.`);

  const desired = {
    title: operation.title,
    body: operation.body,
    state: 'open',
    stateReason: null,
    marker: operation.marker,
  };

  if (matches.length === 0) {
    return {
      id: operation.id,
      requestedType: operation.type,
      stepType: 'create_issue',
      summary: summarizeCreatePlan('create_issue'),
      target: {
        type: 'issue_marker',
        marker: operation.marker,
      },
      precondition: {
        marker: operation.marker,
        matchCount: 0,
      },
      mutation: {
        title: operation.title,
        body: operation.body,
      },
      verification: desired,
    };
  }

  const currentIssue = normalizeIssue(matches[0]);
  const mutation = buildIssueMutation(currentIssue, desired);
  const stepType = Object.keys(mutation).length === 0 ? 'no_op' : 'patch_issue';

  return {
    id: operation.id,
    requestedType: operation.type,
    stepType,
    summary: summarizeCreatePlan(stepType, currentIssue.number),
    target: {
      type: 'issue',
      issueNumber: currentIssue.number,
      issueId: currentIssue.id,
      marker: operation.marker,
    },
    precondition: {
      marker: operation.marker,
      matchCount: 1,
      issue: issueSnapshot(currentIssue),
    },
    mutation: stepType === 'no_op' ? null : mutation,
    verification: desired,
  };
}

async function planUpdateOperation({ operation, repository, transport }) {
  const currentIssue = await transport.getIssue({
    ...repository,
    number: operation.issue.number,
  });

  ensure(currentIssue, 'validation_failed', `Operation ${operation.id} could not find issue #${operation.issue.number}.`);
  ensure(!currentIssue.pullRequest, 'unsupported', `Operation ${operation.id} targeted a pull request, not a plain issue.`);

  if (currentIssue.state === 'closed' && operation.stateReason && operation.stateReason !== currentIssue.stateReason && (!('state' in operation) || operation.state === 'closed')) {
    throw new GuardrailStop(
      'unsupported',
      `Operation ${operation.id} would change close reason on an already closed issue. Approve a separate reopen/close sequence instead.`,
    );
  }

  if (operation.state === 'closed' && !operation.stateReason && currentIssue.state !== 'closed') {
    throw new GuardrailStop(
      'validation_failed',
      `Operation ${operation.id} must provide stateReason when closing an open issue.`,
    );
  }

  const desired = desiredIssueFromCurrent(currentIssue, operation);
  const mutation = buildIssueMutation(currentIssue, desired);
  const stepType = Object.keys(mutation).length === 0 ? 'no_op' : 'patch_issue';

  return {
    id: operation.id,
    requestedType: operation.type,
    stepType,
    summary: summarizeUpdatePlan(stepType, currentIssue.number),
    target: {
      type: 'issue',
      issueNumber: currentIssue.number,
      issueId: currentIssue.id,
    },
    precondition: {
      issue: issueSnapshot(currentIssue),
    },
    mutation: stepType === 'no_op' ? null : mutation,
    verification: desired,
  };
}

function ensureUniqueMutationTargets(operations) {
  const seenTargets = new Set();

  for (const operation of operations) {
    if (operation.stepType === 'no_op') {
      continue;
    }

    const key = operation.target.type === 'issue_marker'
      ? `marker:${operation.target.marker}`
      : `issue:${operation.target.issueNumber}`;

    ensure(!seenTargets.has(key), 'unsupported', 'A single plan cannot mutate the same issue target more than once in v1.');
    seenTargets.add(key);
  }
}

export async function buildGithubPlan({ request, transport, createdAt = new Date().toISOString() }) {
  validateRequest(request);

  const actor = await transport.getActor({ host: request.actor.host });
  ensure(actor.login === request.actor.login, 'validation_failed', `Authenticated actor ${actor.login} did not match approved actor ${request.actor.login}.`);
  ensure(actor.host === request.actor.host, 'validation_failed', `Authenticated host ${actor.host} did not match approved host ${request.actor.host}.`);

  const repository = await transport.getRepository({
    host: request.repository.host,
    owner: request.repository.owner,
    name: request.repository.name,
  });

  const plannedOperations = [];
  for (const operation of request.operations) {
    const plannedOperation = operation.type === 'create_issue'
      ? await planCreateOperation({ operation, repository: request.repository, transport })
      : await planUpdateOperation({ operation, repository: request.repository, transport });
    plannedOperations.push(plannedOperation);
  }

  ensureUniqueMutationTargets(plannedOperations);

  const inputDigest = sha256Json(request);
  const binding = computePlanBinding({
    actor,
    repository,
    operations: plannedOperations,
    inputDigest,
  });

  return {
    kind: 'pi.github.issue.plan',
    version: 1,
    createdAt,
    actor: {
      expected: request.actor,
      actual: actor,
    },
    repository,
    inputDigest,
    binding,
    approval: {
      status: 'pending',
      planDigest: binding.planDigest,
      approvedAt: null,
      approvedBy: null,
    },
    operations: plannedOperations,
    warnings: [],
    stats: {
      mutationCount: countMutations(plannedOperations),
      noOpCount: countNoOps(plannedOperations),
    },
  };
}
