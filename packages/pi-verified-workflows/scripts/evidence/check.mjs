#!/usr/bin/env node
import { parseArgs } from 'node:util';
import {
  claimRevision,
  emitDiagnostics,
  emitJson,
  evidenceKinds,
  guardrailEnvelope,
  helpEnvelope,
  isIsoTimestamp,
  isNonEmptyString,
  isRecord,
  readJson,
  successEnvelope,
  validateArtifactRef,
} from './common.mjs';

const operation = 'evidence:check';

function usage() {
  return helpEnvelope(
    operation,
    'node ./scripts/evidence/check.mjs --manifest path/to/manifest.json [--claim CLAIM_ID] [--require-kind KIND]',
    {
      '--manifest': 'Path to an evidence manifest JSON file.',
      '--claim': 'Optional claim_id to highlight in the result.',
      '--require-kind': 'Optional claim kind guardrail for the selected claim or checked set.',
      '--help': 'Show machine-readable usage information.',
    },
    [
      'Validates record structure, claim references, and artifact pointers only.',
      'Does not prove the truth of any claim.',
    ],
  );
}

function validateClaimReference(ref, context, currentClaimId, claimIds, revisions, errors, warnings) {
  let claimId = null;
  let expectedRevision = null;

  if (isNonEmptyString(ref)) {
    claimId = ref;
  } else if (isRecord(ref)) {
    if (!isNonEmptyString(ref.claim_id)) {
      errors.push(`${context}.claim_id must be a non-empty string`);
      return;
    }
    claimId = ref.claim_id;
    if (ref.expected_revision !== undefined && !isNonEmptyString(ref.expected_revision)) {
      errors.push(`${context}.expected_revision must be a non-empty string when provided`);
      return;
    }
    expectedRevision = ref.expected_revision ?? null;
  } else {
    errors.push(`${context} must be a claim_id string or claim reference object`);
    return;
  }

  if (claimId === currentClaimId) {
    errors.push(`${context} cannot reference its own claim_id ${claimId}`);
    return;
  }

  if (!claimIds.has(claimId)) {
    errors.push(`${context} references unknown claim_id ${claimId}`);
    return;
  }

  const actualRevision = revisions.get(claimId) ?? 'unknown';
  if (expectedRevision === null) {
    return;
  }

  if (expectedRevision === 'unknown') {
    if (actualRevision !== 'unknown') {
      warnings.push(`${context} left expected_revision unknown while ${claimId} now resolves to ${actualRevision}`);
    }
    return;
  }

  if (actualRevision !== expectedRevision) {
    errors.push(`${context} expected revision ${expectedRevision} but ${claimId} resolves to ${actualRevision}`);
  }
}

async function validateManifest(manifest, baseDirectory) {
  const errors = [];
  const warnings = [];
  const claimIds = new Set();
  const revisions = new Map();
  const kinds = {};

  if (!isRecord(manifest)) {
    errors.push('manifest must be a JSON object');
    return { errors, warnings, claimIds, revisions, kinds };
  }

  if (!isNonEmptyString(manifest.manifest_id)) {
    errors.push('manifest.manifest_id must be a non-empty string');
  }

  if (!Array.isArray(manifest.claims) || manifest.claims.length === 0) {
    errors.push('manifest.claims must be a non-empty array');
    return { errors, warnings, claimIds, revisions, kinds };
  }

  for (let index = 0; index < manifest.claims.length; index += 1) {
    const claim = manifest.claims[index];
    const context = `claims[${index}]`;

    if (!isRecord(claim)) {
      errors.push(`${context} must be an object`);
      continue;
    }

    if (!isNonEmptyString(claim.claim_id)) {
      errors.push(`${context}.claim_id must be a non-empty string`);
      continue;
    }

    if (claimIds.has(claim.claim_id)) {
      errors.push(`${context}.claim_id duplicates ${claim.claim_id}`);
      continue;
    }
    claimIds.add(claim.claim_id);

    if (!isNonEmptyString(claim.claim)) {
      errors.push(`${context}.claim must be a non-empty string`);
    }

    if (!evidenceKinds.has(claim.kind)) {
      errors.push(`${context}.kind must be one of ${Array.from(evidenceKinds).join(', ')}`);
      continue;
    }

    kinds[claim.kind] = (kinds[claim.kind] ?? 0) + 1;
    revisions.set(claim.claim_id, claimRevision(claim));

    if (claim.kind === 'source_assertion') {
      if (!isRecord(claim.source)) {
        errors.push(`${context}.source must be an object`);
        continue;
      }
      if (!isNonEmptyString(claim.source.revision)) {
        errors.push(`${context}.source.revision must be a non-empty string`);
      } else if (claim.source.revision === 'unknown') {
        warnings.push(`${context}.source.revision is explicitly unknown`);
      }
      if (!isNonEmptyString(claim.source.locator)) {
        errors.push(`${context}.source.locator must be a non-empty string`);
      }
      await validateArtifactRef(claim.source, `${context}.source`, baseDirectory, errors, warnings);
      continue;
    }

    if (claim.kind === 'derived_computation') {
      if (!Array.isArray(claim.input_claims) || claim.input_claims.length === 0) {
        errors.push(`${context}.input_claims must be a non-empty array`);
      }
      if (!isRecord(claim.computation)) {
        errors.push(`${context}.computation must be an object`);
        continue;
      }
      const method = claim.computation.formula ?? claim.computation.command ?? claim.computation.method;
      if (!isNonEmptyString(method)) {
        errors.push(`${context}.computation must include formula, command, or method`);
      }
      if (!isRecord(claim.computation.output)) {
        errors.push(`${context}.computation.output must be an object`);
        continue;
      }
      const output = claim.computation.output;
      if (!isNonEmptyString(claim.revision) && !isNonEmptyString(output.sha256)) {
        warnings.push(`${context} does not expose a stable revision; dependent revision pinning may be impossible`);
      }
      if (output.path !== undefined) {
        await validateArtifactRef(output, `${context}.computation.output`, baseDirectory, errors, warnings);
      } else if (!isNonEmptyString(output.locator)) {
        errors.push(`${context}.computation.output must include path or locator`);
      }
      continue;
    }

    if (claim.kind === 'observed_render') {
      if (!isIsoTimestamp(claim.observed_at)) {
        errors.push(`${context}.observed_at must be an ISO-8601 timestamp`);
      }
      if (!isRecord(claim.render)) {
        errors.push(`${context}.render must be an object`);
        continue;
      }
      if (!isNonEmptyString(claim.render.page)) {
        errors.push(`${context}.render.page must be a non-empty string`);
      }
      if (!isNonEmptyString(claim.render.locator)) {
        errors.push(`${context}.render.locator must be a non-empty string`);
      }
      await validateArtifactRef(claim.render.capture, `${context}.render.capture`, baseDirectory, errors, warnings);
      continue;
    }

    if (!Array.isArray(claim.input_claims) || claim.input_claims.length === 0) {
      errors.push(`${context}.input_claims must be a non-empty array`);
    }
    if (!isNonEmptyString(claim.rationale)) {
      errors.push(`${context}.rationale must be a non-empty string`);
    }
  }

  for (let index = 0; index < manifest.claims.length; index += 1) {
    const claim = manifest.claims[index];
    const context = `claims[${index}]`;

    if (!isRecord(claim) || !isNonEmptyString(claim.claim_id) || !evidenceKinds.has(claim.kind)) {
      continue;
    }

    if (!Array.isArray(claim.input_claims)) {
      continue;
    }

    for (let refIndex = 0; refIndex < claim.input_claims.length; refIndex += 1) {
      validateClaimReference(
        claim.input_claims[refIndex],
        `${context}.input_claims[${refIndex}]`,
        claim.claim_id,
        claimIds,
        revisions,
        errors,
        warnings,
      );
    }
  }

  return { errors, warnings, claimIds, revisions, kinds };
}

async function main() {
  const { values } = parseArgs({
    options: {
      manifest: { type: 'string' },
      claim: { type: 'string' },
      'require-kind': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: true,
    allowPositionals: false,
  });

  if (values.help) {
    emitJson(usage());
    return 0;
  }

  if (!values.manifest) {
    const payload = guardrailEnvelope(operation, 'validation_failed', 'Missing required --manifest option');
    emitDiagnostics(['Missing required --manifest option']);
    emitJson(payload);
    return 2;
  }

  if (values['require-kind'] && !evidenceKinds.has(values['require-kind'])) {
    const payload = guardrailEnvelope(
      operation,
      'validation_failed',
      `Unsupported claim kind ${values['require-kind']}`,
    );
    emitDiagnostics([`Unsupported claim kind ${values['require-kind']}`]);
    emitJson(payload);
    return 2;
  }

  const { absolutePath, directory, data } = await readJson(values.manifest);
  const { errors, warnings, kinds } = await validateManifest(data, directory);

  if (values.claim) {
    const selectedClaim = Array.isArray(data.claims)
      ? data.claims.find((claim) => claim?.claim_id === values.claim)
      : undefined;

    if (!selectedClaim) {
      errors.push(`Selected claim_id ${values.claim} was not found in the manifest`);
    } else if (values['require-kind'] && selectedClaim.kind !== values['require-kind']) {
      errors.push(
        `Selected claim_id ${values.claim} has kind ${selectedClaim.kind}, expected ${values['require-kind']}`,
      );
    }
  } else if (values['require-kind']) {
    for (const claim of Array.isArray(data.claims) ? data.claims : []) {
      if (claim?.kind !== values['require-kind']) {
        errors.push(
          `Manifest contains claim_id ${claim?.claim_id ?? '<unknown>'} with kind ${claim?.kind ?? '<missing>'}, expected ${values['require-kind']}`,
        );
      }
    }
  }

  if (errors.length > 0) {
    const payload = guardrailEnvelope(operation, 'validation_failed', `Manifest validation failed with ${errors.length} issue(s)`, {
      artifacts: [absolutePath],
      warnings,
      errors,
    });
    emitDiagnostics([...errors, ...warnings.map((warning) => `warning: ${warning}`)]);
    emitJson(payload);
    return 2;
  }

  const checkedClaims = values.claim ? [values.claim] : data.claims.map((claim) => claim.claim_id);
  const payload = successEnvelope(operation, `Validated ${checkedClaims.length} claim(s)`, {
    artifacts: [absolutePath],
    warnings,
    manifest: {
      manifest_id: data.manifest_id,
      claim_count: data.claims.length,
      checked_claims: checkedClaims,
      kinds,
    },
  });

  emitDiagnostics(warnings.map((warning) => `warning: ${warning}`));
  emitJson(payload);
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
    emitJson(guardrailEnvelope(operation, 'internal_error', 'Unexpected failure while checking evidence'));
    process.exitCode = 1;
  }
}
