import {
  GuardrailStop,
  computePlanBinding,
  ensure,
  issueMarkerMatches,
  issueSnapshot,
  matchesIssueSnapshot,
  summarizeAppliedOperations,
  verifyIssueFields,
} from './common.mjs';

function validatePlanArtifact(plan) {
  ensure(plan && typeof plan === 'object', 'validation_failed', 'Plan payload must be a JSON object.');
  ensure(plan.kind === 'pi.github.issue.plan', 'validation_failed', 'Plan kind must be pi.github.issue.plan.');
  ensure(plan.version === 1, 'validation_failed', 'Only plan version 1 is supported.');
  ensure(Array.isArray(plan.operations) && plan.operations.length > 0, 'validation_failed', 'Plan must contain operations.');
  ensure(plan.actor?.actual, 'validation_failed', 'Plan actor.actual is required.');
  ensure(plan.repository?.owner && plan.repository?.name && plan.repository?.host, 'validation_failed', 'Plan repository is required.');
  ensure(plan.inputDigest, 'validation_failed', 'Plan inputDigest is required.');
  ensure(plan.binding?.planDigest, 'validation_failed', 'Plan binding is required.');
  ensure(plan.approval?.status === 'approved', 'approval_required', 'Plan approval.status must be approved before apply.');
  ensure(plan.approval.planDigest === plan.binding.planDigest, 'approval_required', 'Plan approval digest did not match the plan binding digest.');
}

function ensurePlanBinding(plan) {
  const recomputed = computePlanBinding({
    actor: plan.actor.actual,
    repository: plan.repository,
    operations: plan.operations,
    inputDigest: plan.inputDigest,
  });

  ensure(
    recomputed.actorDigest === plan.binding.actorDigest &&
      recomputed.targetDigest === plan.binding.targetDigest &&
      recomputed.preconditionDigest === plan.binding.preconditionDigest &&
      recomputed.mutationDigest === plan.binding.mutationDigest &&
      recomputed.planDigest === plan.binding.planDigest,
    'validation_failed',
    'Plan binding digests no longer match the serialized plan artifact.',
  );
}

async function ensureActorAndRepository(plan, transport) {
  const actor = await transport.getActor({ host: plan.repository.host });
  ensure(actor.login === plan.actor.actual.login, 'validation_failed', `Authenticated actor ${actor.login} did not match approved actor ${plan.actor.actual.login}.`);
  ensure(actor.host === plan.actor.actual.host, 'validation_failed', `Authenticated host ${actor.host} did not match approved host ${plan.actor.actual.host}.`);

  const repository = await transport.getRepository({
    host: plan.repository.host,
    owner: plan.repository.owner,
    name: plan.repository.name,
  });

  ensure(repository.fullName === plan.repository.fullName, 'validation_failed', 'Repository full name changed since planning.');
  return { actor, repository };
}

async function recheckPrecondition(step, plan, transport) {
  const repository = {
    host: plan.repository.host,
    owner: plan.repository.owner,
    name: plan.repository.name,
  };

  if (step.target.type === 'issue_marker' && step.precondition.matchCount === 0) {
    const issues = await transport.listIssues(repository);
    const matches = issues.filter((issue) => issueMarkerMatches(issue, step.target.marker));
    ensure(
      matches.length === 0,
      'stale_state',
      `Operation ${step.id} found ${matches.length} marker matches after approval instead of 0.`,
    );
    return null;
  }

  const currentIssue = await transport.getIssue({
    ...repository,
    number: step.target.issueNumber,
  });

  ensure(currentIssue, 'stale_state', `Operation ${step.id} could not re-read issue #${step.target.issueNumber}.`);
  ensure(
    matchesIssueSnapshot(currentIssue, step.precondition.issue),
    'stale_state',
    `Operation ${step.id} detected remote state drift on issue #${step.target.issueNumber}.`,
  );
  return currentIssue;
}

async function verifyCreateUniqueness(step, plan, transport, createdIssue) {
  const repository = {
    host: plan.repository.host,
    owner: plan.repository.owner,
    name: plan.repository.name,
  };
  const matches = (await transport.listIssues(repository)).filter((issue) => issueMarkerMatches(issue, step.verification.marker));
  ensure(
    matches.length === 1 && Number(matches[0].number) === Number(createdIssue.number),
    'ambiguous_result',
    `Operation ${step.id} could not prove a unique marker match after create.`,
  );
}

async function applyCreate(step, plan, transport) {
  const repository = {
    host: plan.repository.host,
    owner: plan.repository.owner,
    name: plan.repository.name,
  };
  const createdIssue = await transport.createIssue({
    ...repository,
    title: step.mutation.title,
    body: step.mutation.body,
  });

  ensure(createdIssue?.number, 'ambiguous_result', `Operation ${step.id} did not return a created issue number.`);

  const verifiedIssue = await transport.getIssue({
    ...repository,
    number: createdIssue.number,
  });

  ensure(verifiedIssue, 'ambiguous_result', `Operation ${step.id} could not read back created issue #${createdIssue.number}.`);
  const mismatch = verifyIssueFields(verifiedIssue, step.verification);
  ensure(!mismatch, 'ambiguous_result', `Operation ${step.id} failed verification: ${mismatch}.`);
  await verifyCreateUniqueness(step, plan, transport, createdIssue);

  return {
    id: step.id,
    status: 'applied',
    target: {
      issueNumber: verifiedIssue.number,
      issueId: verifiedIssue.id,
    },
  };
}

async function applyPatch(step, plan, transport) {
  const repository = {
    host: plan.repository.host,
    owner: plan.repository.owner,
    name: plan.repository.name,
  };

  await transport.patchIssue({
    ...repository,
    number: step.target.issueNumber,
    fields: step.mutation,
  });

  const verifiedIssue = await transport.getIssue({
    ...repository,
    number: step.target.issueNumber,
  });

  ensure(verifiedIssue, 'ambiguous_result', `Operation ${step.id} could not read back issue #${step.target.issueNumber}.`);
  const mismatch = verifyIssueFields(verifiedIssue, step.verification);
  ensure(!mismatch, 'ambiguous_result', `Operation ${step.id} failed verification: ${mismatch}.`);

  return {
    id: step.id,
    status: 'applied',
    target: {
      issueNumber: verifiedIssue.number,
      issueId: verifiedIssue.id,
    },
  };
}

function noOpResult(step) {
  return {
    id: step.id,
    status: 'no_op',
    target: step.target,
  };
}

export async function applyGithubPlan({ plan, transport }) {
  validatePlanArtifact(plan);
  ensurePlanBinding(plan);
  await ensureActorAndRepository(plan, transport);

  for (const step of plan.operations) {
    await recheckPrecondition(step, plan, transport);
  }

  const results = [];
  for (const step of plan.operations) {
    if (step.stepType === 'no_op') {
      results.push(noOpResult(step));
      continue;
    }

    if (step.stepType === 'create_issue') {
      results.push(await applyCreate(step, plan, transport));
      continue;
    }

    if (step.stepType === 'patch_issue') {
      results.push(await applyPatch(step, plan, transport));
      continue;
    }

    throw new GuardrailStop('unsupported', `Plan step ${step.id} used unsupported stepType ${step.stepType}.`);
  }

  const summary = summarizeAppliedOperations(results);
  return {
    kind: 'pi.github.issue.apply.result',
    version: 1,
    planDigest: plan.binding.planDigest,
    repository: plan.repository,
    results,
    stats: {
      mutationCount: summary.mutated,
      noOpCount: summary.noOps,
    },
  };
}
