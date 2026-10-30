import test from 'node:test';
import assert from 'node:assert/strict';

import { baseValidSpec, createTempSpec, runCli } from './helpers.mjs';

test('source-preview:render returns a provenance-rich guardrail refusal instead of fabricated HTML', async (t) => {
  const specPath = await createTempSpec(t, baseValidSpec());
  const result = runCli('./scripts/source-preview/render.mjs', ['--spec', specPath]);

  assert.equal(result.status, 2, result.stderr);
  assert.equal(result.json.ok, false);
  assert.equal(result.json.operation, 'source-preview:render');
  assert.equal(result.json.code, 'unsupported');
  assert.equal(result.json.render.status, 'refused');
  assert.equal(result.json.render.substituteHtmlForbidden, true);
  assert.equal(result.json.artifacts.length, 3);
  assert.equal(result.json.render.provenance.browserInspection, 'existing-browser');
  assert.equal(result.json.render.provenance.adapterContract.adapter, 'vite+svelte+mdsvex');

  const reason = result.json.render.reason;
  assert.ok(
    reason === 'missing_reviewed_shared_toolchain' || reason === 'adapter_execution_disabled',
    `unexpected refusal reason: ${reason}`,
  );
});

test('source-preview:render refuses inline HTML substitute fields', async (t) => {
  const specPath = await createTempSpec(
    t,
    baseValidSpec({
      inlineHtml: '<html><body>fake</body></html>',
    }),
  );
  const result = runCli('./scripts/source-preview/render.mjs', ['--spec', specPath]);

  assert.equal(result.status, 2);
  assert.equal(result.json.ok, false);
  assert.equal(result.json.code, 'unsupported');
  assert.match(result.json.summary, /refuses inline rendered substitutes/u);
});
