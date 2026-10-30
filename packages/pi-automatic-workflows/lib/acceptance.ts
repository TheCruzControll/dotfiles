import crypto from 'node:crypto';

export const REQUIRED_BEHAVIORAL_SCENARIOS = Object.freeze([
  'plan-only', 'review-read-only', 'investigation-read-only', 'stop-and-cancel',
  'routing-and-followups', 'architect-two-designs', 'delegated-implementation-and-review',
  'agent-limits-and-no-nesting', 'writer-isolation', 'parent-model-inheritance',
  'reload-and-branch-ownership', 'verification-and-skips', 'observer-compatibility',
  'approved-build-only', 'new-task-pinning-and-rollback', 'delivery-authorization',
  'specialized-stopping-conditions', 'global-applicability',
]);
const QUALITY_METRICS = ['missedSteps', 'routeErrors', 'boundaryViolations', 'unwantedActivations', 'corrections'];
const COST_METRICS = ['latencyMs', 'tokens'];
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
export const acceptanceDigest = report => digest(JSON.stringify(report));
const text = (v, max=1000) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const number = v => typeof v === 'number' && Number.isFinite(v) && v >= 0;

export function behavioralReportTemplate(context) {
  const metrics = () => Object.fromEntries([...QUALITY_METRICS, ...COST_METRICS].map(name => [name, null]));
  return {
    schemaVersion: 1, candidateId: context.candidateId, candidateDigest: context.candidateDigest, baseRevision: context.baseRevision,
    evaluator: { kind: 'trusted-behavior-runner', name: null, model: null },
    artifacts: [{ id: null, content: null, sha256: null }],
    scenarios: REQUIRED_BEHAVIORAL_SCENARIOS.map(id => ({ id, passed: null, rationale: null, evidence: [] })),
    independentReview: { passed: null, reviewer: null, evidence: [] },
    overheadTargets: { source: 'paired-baseline-study', rationale: null, latencyRatio: null, tokenRatio: null, evidence: [] },
    pilot: [0, 1].map(() => ({ project: null, kind: null, model: null, off: metrics(), on: metrics(), evidence: [] })),
  };
}

/** Validate evidence from the trusted evaluator; this does NOT itself run a model
 * or infer semantic correctness from resource keywords. The evaluator is trusted
 * application code, not candidate content. Same-user storage is not a sandbox. */
export function validateBehavioralReport(report, receipt) {
  const fail = message => { throw new Error(`Behavioral acceptance refused: ${message}`); };
  if (!report || report.schemaVersion !== 1 || report.candidateId !== receipt.candidateId || report.candidateDigest !== receipt.verifiedDigest || report.baseRevision !== receipt.baseRevision) fail('candidate digest or baseline mismatch');
  if (Buffer.byteLength(JSON.stringify(report)) > 4_000_000) fail('report exceeds evidence bound');
  if (!text(report.evaluator?.name) || !text(report.evaluator?.model) || report.evaluator?.kind !== 'trusted-behavior-runner') fail('trusted evaluator identity missing');
  if (!Array.isArray(report.artifacts) || !report.artifacts.length || report.artifacts.length > 100) fail('bounded evidence artifacts required');
  const artifacts = new Set();
  for (const artifact of report.artifacts) {
    if (!text(artifact.id,128) || artifacts.has(artifact.id) || !text(artifact.content,500_000) || artifact.sha256 !== digest(artifact.content)) fail('invalid, duplicated or altered evidence artifact');
    artifacts.add(artifact.id);
  }
  const evidence = references => Array.isArray(references) && references.length > 0 && references.length <= 100 && references.every(id => artifacts.has(id));
  if (!Array.isArray(report.scenarios) || report.scenarios.length !== REQUIRED_BEHAVIORAL_SCENARIOS.length) fail('complete scenario matrix required');
  const seen = new Set();
  for (const scenario of report.scenarios) {
    if (!REQUIRED_BEHAVIORAL_SCENARIOS.includes(scenario.id) || seen.has(scenario.id) || scenario.passed !== true || !text(scenario.rationale) || !evidence(scenario.evidence)) fail('a required scenario failed, is missing, or lacks evidence');
    seen.add(scenario.id);
  }
  if (report.independentReview?.passed !== true || !text(report.independentReview?.reviewer) || report.independentReview.reviewer === report.evaluator.name || !evidence(report.independentReview?.evidence)) fail('independent review evidence required');
  const targets = report.overheadTargets;
  if (targets?.source !== 'paired-baseline-study' || !text(targets?.rationale) || !evidence(targets?.evidence) || !number(targets?.latencyRatio) || !number(targets?.tokenRatio)) fail('explicit baseline-derived overhead targets required');
  if (!Array.isArray(report.pilot) || report.pilot.length < 2 || report.pilot.length > 50) fail('representative multi-project off/on pilot required');
  const projects = new Set(), kinds = new Set();
  for (const trial of report.pilot) {
    if (!text(trial.project,256) || !text(trial.kind,128) || !evidence(trial.evidence) || !text(trial.model) || trial.model !== report.evaluator.model || !trial.off || !trial.on) fail('paired pilot identity/evidence missing');
    projects.add(trial.project); kinds.add(trial.kind);
    for (const metric of [...QUALITY_METRICS,...COST_METRICS]) if (!number(trial.off[metric]) || !number(trial.on[metric])) fail('non-numeric or missing pilot metric');
    for (const metric of QUALITY_METRICS) if (trial.on[metric] > trial.off[metric]) fail(`pilot quality regression: ${metric}`);
    if (trial.on.boundaryViolations !== 0) fail('pilot boundary violation');
    if (trial.off.latencyMs <= 0 || trial.off.tokens <= 0 || trial.on.latencyMs > trial.off.latencyMs * targets.latencyRatio || trial.on.tokens > trial.off.tokens * targets.tokenRatio) fail('pilot overhead exceeds baseline-derived target');
  }
  if (projects.size < 2 || kinds.size < 2) fail('pilot must cover different projects and project kinds');
  return { passed: true, digest: acceptanceDigest(report), scenarioCount: seen.size, projectCount: projects.size };
}
