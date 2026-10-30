import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const thisFile = fileURLToPath(import.meta.url);
export const testsRoot = path.dirname(thisFile);
export const repoRoot = path.resolve(testsRoot, '..', '..');
export const challengeRoot = path.resolve(testsRoot, 'fixtures/support-kb');

export async function createTempSpec(t, spec) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'source-preview-spec-'));
  t.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const specPath = path.join(tempDir, 'preview-spec.json');
  await fs.writeFile(specPath, JSON.stringify(spec, null, 2));
  return specPath;
}

export function baseValidSpec(overrides = {}) {
  return {
    sourceRoot: challengeRoot,
    entry: 'src/routes/kb/incidents/4471/+page.svx',
    aliases: {
      '#lib': 'src/lib',
    },
    layouts: {
      runbook: 'src/lib/layouts/runbook.svelte',
    },
    trust: {
      mode: 'reviewed-local',
      reviewed: true,
      reviewedBy: 'test-suite',
      reviewedAt: '2026-10-05T00:00:00Z',
    },
    render: {
      artifactBaseName: 'incident-4471-preview',
      artifactDir: './artifacts',
      browserInspection: 'existing-browser',
      clock: {
        freezeAt: '2026-10-05T00:00:00Z',
        timezone: 'UTC',
        locale: 'en-US',
      },
    },
    ...overrides,
  };
}

export function runCli(scriptRelativePath, args) {
  const result = spawnSync(process.execPath, [scriptRelativePath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  const stdout = result.stdout?.trim() ?? '';
  const stderr = result.stderr?.trim() ?? '';

  return {
    ...result,
    stdout,
    stderr,
    json: stdout ? JSON.parse(stdout) : null,
  };
}
