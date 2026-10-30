import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

export const evidenceKinds = new Set([
  'source_assertion',
  'derived_computation',
  'observed_render',
  'researcher_inference',
]);

export const submissionOutcomes = new Set([
  'accepted',
  'rejected',
  'pending',
  'unknown',
]);

export function successEnvelope(operation, summary, extra = {}) {
  return {
    ok: true,
    operation,
    summary,
    artifacts: [],
    warnings: [],
    ...extra,
  };
}

export function guardrailEnvelope(operation, code, summary, extra = {}) {
  return {
    ok: false,
    operation,
    code,
    summary,
    artifacts: [],
    warnings: [],
    ...extra,
  };
}

export function helpEnvelope(operation, usage, options, notes = []) {
  return successEnvelope(operation, 'Usage information', {
    usage,
    options,
    notes,
  });
}

export function emitJson(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

export function emitDiagnostics(lines = []) {
  const normalized = lines.filter(Boolean);
  if (normalized.length > 0) {
    process.stderr.write(`${normalized.join('\n')}\n`);
  }
}

export function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isIsoTimestamp(value) {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value));
}

export async function readJson(filePath) {
  const absolutePath = path.resolve(filePath);

  let content;
  try {
    content = await readFile(absolutePath, 'utf8');
  } catch (error) {
    const wrapped = new Error(`Could not read JSON file ${absolutePath}`);
    wrapped.validationFailure = true;
    wrapped.cause = error;
    throw wrapped;
  }

  try {
    return {
      absolutePath,
      directory: path.dirname(absolutePath),
      data: JSON.parse(content),
    };
  } catch (error) {
    const wrapped = new Error(`Invalid JSON in ${absolutePath}`);
    wrapped.validationFailure = true;
    wrapped.cause = error;
    throw wrapped;
  }
}

export function relativeArtifactPath(basePath, artifactPath) {
  return path.relative(process.cwd(), path.resolve(basePath, artifactPath));
}

export async function hashFile(filePath) {
  const bytes = await readFile(filePath);
  return createHash('sha256').update(bytes).digest('hex');
}

export async function validateArtifactRef(ref, context, baseDirectory, errors, warnings) {
  if (!isRecord(ref)) {
    errors.push(`${context} must be an object with at least a path field`);
    return null;
  }

  if (!isNonEmptyString(ref.path)) {
    errors.push(`${context}.path must be a non-empty string`);
    return null;
  }

  const absolutePath = path.resolve(baseDirectory, ref.path);

  try {
    await access(absolutePath);
  } catch {
    errors.push(`${context}.path does not exist: ${ref.path}`);
    return null;
  }

  if (ref.sha256 !== undefined && !isNonEmptyString(ref.sha256)) {
    errors.push(`${context}.sha256 must be a non-empty string when provided`);
    return null;
  }

  if (isNonEmptyString(ref.sha256)) {
    const actualHash = await hashFile(absolutePath);
    if (actualHash !== ref.sha256) {
      errors.push(`${context}.sha256 did not match ${ref.path}`);
    }
  } else {
    warnings.push(`${context} did not include sha256 for ${ref.path}`);
  }

  return {
    absolutePath,
    relativePath: relativeArtifactPath(baseDirectory, ref.path),
  };
}

export function claimRevision(claim) {
  if (isNonEmptyString(claim?.revision)) {
    return claim.revision;
  }

  if (claim?.kind === 'source_assertion' && isNonEmptyString(claim?.source?.revision)) {
    return claim.source.revision;
  }

  if (isNonEmptyString(claim?.computation?.output?.sha256)) {
    return claim.computation.output.sha256;
  }

  if (isNonEmptyString(claim?.render?.capture?.sha256)) {
    return claim.render.capture.sha256;
  }

  return 'unknown';
}

export function describeChanges(flags) {
  const changes = [];
  if (flags.inputChanged) {
    changes.push('input digest changed');
  }
  if (flags.stateChanged) {
    changes.push('fresh state changed');
  }
  if (flags.taskRevisionChanged) {
    changes.push('task revision changed');
  }
  return changes;
}
