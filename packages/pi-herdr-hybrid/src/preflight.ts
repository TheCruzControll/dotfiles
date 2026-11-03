import { accessSync, constants, realpathSync, statSync } from 'node:fs';
import { delimiter, isAbsolute, resolve } from 'node:path';
import { Type } from 'typebox';

export interface Preflight { cwd?: string; executables?: string[]; paths?: string[] }
const item = Type.String({ minLength: 1, maxLength: 4096 });
export const PreflightSchema = Type.Object({
  cwd: Type.Optional(item),
  executables: Type.Optional(Type.Array(item, { maxItems: 16 })),
  paths: Type.Optional(Type.Array(item, { maxItems: 16 })),
}, { additionalProperties: false, description: 'Optional readiness assertions before pane creation. Executables are checked, never run; paths (e.g. node_modules or a verification script) must exist relative to child cwd. No installation or version validation.' });

/** No commands execute here: even shell metacharacters are literal path characters. */
export function checkPreflight(checks: Preflight | undefined, cwd: string, env: Record<string, string | undefined>): void {
  if (checks === undefined) return;
  const valid = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 4096 && !value.includes('\0');
  if (!checks || typeof checks !== 'object' || Object.keys(checks).some(k => !['cwd', 'executables', 'paths'].includes(k)) ||
      (checks.cwd !== undefined && (!valid(checks.cwd) || !isAbsolute(checks.cwd))) ||
      [checks.executables, checks.paths].some(list => list !== undefined && (!Array.isArray(list) || list.length > 16 || !list.every(valid)))) {
    throw Error('Invalid preflight declaration: use absolute cwd and at most 16 nonempty executable/path names');
  }
  try {
    if (!statSync(cwd).isDirectory()) throw Error();
    if (checks.cwd !== undefined && realpathSync(checks.cwd) !== realpathSync(cwd)) throw Error();
  } catch { throw Error('Preflight cwd mismatch or unavailable directory; select the intended child cwd'); }
  for (const [index, path] of (checks.paths ?? []).entries()) {
    try { accessSync(resolve(cwd, path), constants.R_OK); }
    catch { throw Error(`Preflight required path #${index + 1} unavailable; prepare dependencies or verification files before launch`); }
  }
  const search = (env.PATH ?? '').split(delimiter).slice(0, 256);
  for (const [index, executable] of (checks.executables ?? []).entries()) {
    const candidates = executable.includes('/') ? [resolve(cwd, executable)] : search.map(dir => resolve(cwd, dir, executable));
    if (!candidates.some(path => {
      try { accessSync(path, constants.X_OK); return statSync(path).isFile(); } catch { return false; }
    })) throw Error(`Preflight executable #${index + 1} unavailable; prepare the required runtime/tool or child PATH before launch`);
  }
}
