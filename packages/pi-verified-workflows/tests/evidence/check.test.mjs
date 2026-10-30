import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';

import { createTempFixture, runScript, sha256, writeJson } from './helpers.mjs';

async function createEvidenceFixture(t, mutate = () => {}) {
  const directory = await createTempFixture(t);
  const sourceContent = 'report total: 42\n';
  const computationContent = '{"total":42}\n';
  const captureContent = 'rendered total: 42\n';

  await writeFile(path.join(directory, 'source.txt'), sourceContent);
  await writeFile(path.join(directory, 'computed.json'), computationContent);
  await writeFile(path.join(directory, 'capture.txt'), captureContent);

  const sourceHash = sha256(sourceContent);
  const computedHash = sha256(computationContent);
  const captureHash = sha256(captureContent);

  const manifest = {
    manifest_id: 'evidence-demo',
    claims: [
      {
        claim_id: 'C1',
        claim: 'Source report names the total as 42.',
        kind: 'source_assertion',
        source: {
          path: './source.txt',
          revision: 'rev-1',
          locator: 'line 1',
          sha256: sourceHash,
        },
      },
      {
        claim_id: 'C2',
        claim: 'The computed total is 42.',
        kind: 'derived_computation',
        revision: 'calc-1',
        input_claims: [{ claim_id: 'C1', expected_revision: 'rev-1' }],
        computation: {
          method: 'sum matching rows',
          output: {
            path: './computed.json',
            locator: '$.total',
            sha256: computedHash,
          },
        },
      },
      {
        claim_id: 'C3',
        claim: 'The rendered page displayed 42.',
        kind: 'observed_render',
        observed_at: '2025-01-01T00:00:00Z',
        input_claims: [{ claim_id: 'C2', expected_revision: 'calc-1' }],
        render: {
          page: '/reports/4471',
          locator: '#total',
          capture: {
            path: './capture.txt',
            sha256: captureHash,
          },
        },
      },
      {
        claim_id: 'C4',
        claim: 'The computation and render records refer to the same result.',
        kind: 'researcher_inference',
        input_claims: [
          { claim_id: 'C2', expected_revision: 'calc-1' },
          { claim_id: 'C3', expected_revision: captureHash },
        ],
        rationale: 'Both records identify the same route and displayed value.',
      },
    ],
  };

  await mutate({ directory, manifest, captureHash });

  const manifestPath = path.join(directory, 'manifest.json');
  await writeJson(manifestPath, manifest);

  return { directory, manifestPath };
}

test('evidence:check supports --help', () => {
  const result = runScript('scripts/evidence/check.mjs', ['--help']);
  assert.equal(result.status, 0);
  assert.equal(result.stdoutJson.operation, 'evidence:check');
  assert.match(result.stdoutJson.usage, /--manifest/);
});

test('evidence:check validates a complete manifest', async (t) => {
  const { manifestPath } = await createEvidenceFixture(t);
  const result = runScript('scripts/evidence/check.mjs', ['--manifest', manifestPath]);

  assert.equal(result.status, 0);
  assert.equal(result.stdoutJson.ok, true);
  assert.equal(result.stdoutJson.manifest.claim_count, 4);
  assert.deepEqual(result.stdoutJson.manifest.checked_claims, ['C1', 'C2', 'C3', 'C4']);
  assert.equal(result.stdoutJson.manifest.kinds.observed_render, 1);
});

test('evidence:check preserves explicit unknown revisions as warnings, not failures', async (t) => {
  const { manifestPath } = await createEvidenceFixture(t, async ({ manifest }) => {
    manifest.claims[0].source.revision = 'unknown';
    manifest.claims[1].input_claims[0].expected_revision = 'unknown';
  });

  const result = runScript('scripts/evidence/check.mjs', ['--manifest', manifestPath]);

  assert.equal(result.status, 0);
  assert.equal(result.stdoutJson.ok, true);
  assert.match(result.stderr, /explicitly unknown/);
  assert.ok(result.stdoutJson.warnings.length >= 1);
});

test('evidence:check rejects stale claim revision references', async (t) => {
  const { manifestPath } = await createEvidenceFixture(t, async ({ manifest }) => {
    manifest.claims[1].input_claims[0].expected_revision = 'rev-stale';
  });

  const result = runScript('scripts/evidence/check.mjs', ['--manifest', manifestPath]);

  assert.equal(result.status, 2);
  assert.equal(result.stdoutJson.code, 'validation_failed');
  assert.match(result.stderr, /expected revision rev-stale/);
});

test('evidence:check does not allow a derived computation to satisfy an observed render requirement', async (t) => {
  const { manifestPath } = await createEvidenceFixture(t);
  const result = runScript('scripts/evidence/check.mjs', [
    '--manifest',
    manifestPath,
    '--claim',
    'C2',
    '--require-kind',
    'observed_render',
  ]);

  assert.equal(result.status, 2);
  assert.equal(result.stdoutJson.code, 'validation_failed');
  assert.match(result.stderr, /Selected claim_id C2 has kind derived_computation/);
});

test('evidence:check rejects altered observed-render artifacts', async (t) => {
  const { manifestPath, directory } = await createEvidenceFixture(t, async ({ directory }) => {
    await writeFile(path.join(directory, 'capture.txt'), 'rendered total: 43\n');
  });

  const result = runScript('scripts/evidence/check.mjs', ['--manifest', manifestPath]);

  assert.equal(result.status, 2);
  assert.equal(result.stdoutJson.code, 'validation_failed');
  assert.match(result.stderr, /render\.capture\.sha256 did not match/);
});
