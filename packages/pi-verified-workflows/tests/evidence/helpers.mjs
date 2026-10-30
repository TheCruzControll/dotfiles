import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
export const packageRoot = path.resolve(testDirectory, '..', '..');

export function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

export async function createTempFixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pi-evidence-'));
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

export async function writeJson(filePath, data) {
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

export function runScript(relativeScriptPath, args = []) {
  const absoluteScriptPath = path.join(packageRoot, relativeScriptPath);
  const result = spawnSync(process.execPath, [absoluteScriptPath, ...args], {
    cwd: packageRoot,
    encoding: 'utf8',
  });

  let stdoutJson = null;
  const trimmedStdout = result.stdout.trim();
  if (trimmedStdout.length > 0) {
    stdoutJson = JSON.parse(trimmedStdout);
  }

  return {
    status: result.status,
    stdoutJson,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}
