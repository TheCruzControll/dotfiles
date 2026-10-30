import test from 'node:test';
import assert from 'node:assert/strict';

import { baseValidSpec, createTempSpec, runCli } from './helpers.mjs';

test('source-preview:check validates a reviewed-local support-kb spec', async (t) => {
  const specPath = await createTempSpec(t, baseValidSpec());
  const result = runCli('./scripts/source-preview/check.mjs', ['--spec', specPath]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.json.ok, true);
  assert.equal(result.json.operation, 'source-preview:check');
  assert.equal(result.json.source.frontmatter.layout, 'runbook');
  assert.equal(result.json.source.frontmatter.fields.owner, 'support desk');
  assert.equal(result.json.source.layouts.runbook.endsWith('src/lib/layouts/runbook.svelte'), true);
  assert.equal(result.json.renderPlan.adapterContract.handwrittenHtmlFallback, 'forbidden');
  assert.equal(result.json.toolchain.packages.length, 4);
  assert.match(result.stderr, /source-preview:check:/u);

  const entryDigest = result.json.source.anchorDigests.find((item) => item.kind === 'entry');
  assert.ok(entryDigest?.digest?.startsWith('sha256:'), 'expected entry sha256 digest');
});

test('source-preview:check refuses unreviewed input', async (t) => {
  const specPath = await createTempSpec(
    t,
    baseValidSpec({
      trust: {
        mode: 'reviewed-local',
        reviewed: false,
      },
    }),
  );
  const result = runCli('./scripts/source-preview/check.mjs', ['--spec', specPath]);

  assert.equal(result.status, 2);
  assert.equal(result.json.ok, false);
  assert.equal(result.json.code, 'unsupported');
  assert.match(result.json.summary, /trusted reviewed-local source/u);
});

test('source-preview:check refuses remote source roots', async (t) => {
  const specPath = await createTempSpec(
    t,
    baseValidSpec({
      sourceRoot: 'https://example.invalid/support-kb',
    }),
  );
  const result = runCli('./scripts/source-preview/check.mjs', ['--spec', specPath]);

  assert.equal(result.status, 2);
  assert.equal(result.json.ok, false);
  assert.equal(result.json.code, 'unsupported');
  assert.match(result.json.summary, /local filesystem path/u);
});
