import { it } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkPreflight } from '../src/preflight.ts';

it('checks declared cwd, dependencies and verification executable without running it', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'preflight-'));
  try {
    mkdirSync(join(cwd, 'node_modules'));
    const tool = join(cwd, 'verify;echo unsafe');
    writeFileSync(tool, '#!/bin/sh\nexit 99\n'); chmodSync(tool, 0o700);
    checkPreflight({ cwd, paths: ['node_modules'], executables: ['./verify;echo unsafe'] }, cwd, {});
    checkPreflight({ executables: ['verify;echo unsafe'] }, cwd, { PATH: cwd });
    assert.throws(() => checkPreflight({ cwd: tmpdir() }, cwd, {}), /cwd/);
    assert.throws(() => checkPreflight({ paths: ['missing'] }, cwd, {}), /path #1/);
    assert.throws(() => checkPreflight({ executables: ['missing'] }, cwd, {}), /executable #1/);
    assert.throws(() => checkPreflight({ paths: Array(17).fill('x') }, cwd, {}), /Invalid/);
    assert.throws(() => checkPreflight({ executables: ['bad\0name'] }, cwd, {}), /Invalid/);
    checkPreflight(undefined, '/does-not-exist', {});
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
