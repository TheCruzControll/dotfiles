#!/usr/bin/env node
import { parseArgs } from 'node:util';

import {
  GUARDRAIL_EXIT_CODE,
  INTERNAL_EXIT_CODE,
  GuardrailStop,
  buildGuardrailEnvelope,
  buildSuccessEnvelope,
  countMutations,
  countNoOps,
  helpEnvelope,
  isGuardrailStop,
  readJsonFile,
  redactPlanForStdout,
  writeDiagnostic,
  writeJsonFile,
  writeStdoutJson,
} from './common.mjs';
import { buildGithubPlan } from './plan-core.mjs';
import { loadTransport } from './transport.mjs';

const OPERATION = 'github:plan';

const HELP = helpEnvelope(
  OPERATION,
  'node ./scripts/github/plan.mjs --input <request.json> [--output <plan.json>]',
  'Build a local GitHub issue mutation preview without remote writes.',
  {
    '--input <path>': 'Required JSON request file with actor, repository, and operations.',
    '--output <path>': 'Optional plan artifact path. When provided, stdout stays redacted by default.',
    '--help': 'Show command usage as JSON.',
  },
);

async function main() {
  const { values } = parseArgs({
    options: {
      input: { type: 'string' },
      output: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: true,
    allowPositionals: false,
  });

  if (values.help) {
    writeStdoutJson(HELP);
    return;
  }

  if (!values.input) {
    throw new GuardrailStop('validation_failed', 'Missing required --input argument.');
  }

  const request = readJsonFile(values.input);
  const transport = await loadTransport(process.env);
  const plan = await buildGithubPlan({ request, transport });

  let artifactPaths = [];
  if (values.output) {
    const artifactPath = writeJsonFile(values.output, plan);
    artifactPaths = [artifactPath];
    writeDiagnostic(`Wrote plan artifact to ${artifactPath}`);
  }

  const summary = `Planned ${countMutations(plan.operations)} mutation(s) and ${countNoOps(plan.operations)} no-op(s).`;
  writeStdoutJson(
    buildSuccessEnvelope(OPERATION, summary, {
      artifacts: artifactPaths,
      plan: values.output ? redactPlanForStdout(plan) : plan,
    }),
  );
}

main().catch((error) => {
  if (isGuardrailStop(error)) {
    writeDiagnostic(error.summary);
    writeStdoutJson(buildGuardrailEnvelope(OPERATION, error));
    process.exitCode = GUARDRAIL_EXIT_CODE;
    return;
  }

  writeDiagnostic(error instanceof Error ? error.message : String(error));
  writeStdoutJson({
    ok: false,
    operation: OPERATION,
    code: 'internal_error',
    summary: 'github:plan failed unexpectedly.',
    artifacts: [],
    warnings: [],
  });
  process.exitCode = INTERNAL_EXIT_CODE;
});
