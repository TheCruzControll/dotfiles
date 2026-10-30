import fs from 'node:fs/promises';
import { AsyncLocalStorage } from 'node:async_hooks';
import { constants } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const protectedNames = ['bash', 'write', 'edit'];
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const mutation = `const fs=require('node:fs/promises');(async()=>{let s='';for await(const c of process.stdin)s+=c;const [op,p,content]=JSON.parse(s);if(op==='mkdir')await fs.mkdir(p,{recursive:true});else await fs.writeFile(p,content,'utf8');})().catch(e=>{console.error(e.message);process.exitCode=1});`;

function run(profile, cwd, args, input = '', signal, spawnProcess = spawn) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess('/usr/bin/sandbox-exec', ['-p', profile, ...args], { cwd, signal, stdio: ['pipe', 'ignore', 'pipe'] });
    let error = '', processError;
    child.stderr?.on('data', data => { error += data; });
    child.stdin?.on('error', () => {});
    // An AbortError requests termination; keep SDK mutation serialization until close.
    child.on('error', cause => { processError ??= cause; });
    child.on('close', code => processError ? reject(processError) : code === 0 ? resolve() : reject(new Error(error || `Child write fence exited ${code}`)));
    child.stdin?.end(input);
  });
}

// No SDK import at module load: Pi resolves this package through its runtime aliases.
export function createChildWriteFence(pi, extensionPath, { child = !!process.env.PI_SUBAGENT_ID || process.env.PI_SUBAGENT_CHILD === '1', platform = process.platform, loadSDK = () => import('@earendil-works/pi-coding-agent'), spawnProcess = spawn } = {}) {
  const signals = new AsyncLocalStorage();
  let ready = false, failure = 'not initialized', cwd, canonical, operations, trustedSource;
  const sourceKeys = ['path', 'source', 'scope', 'origin', 'baseDir'];
  const sameSource = (a, b) => !!a && !!b && sourceKeys.every(key => a[key] === b[key]);
  function assert(ctx) {
    if (!child) return;
    if (!ready) throw new Error(`Child write fence: ${failure}`);
    if (path.resolve(ctx.cwd) !== cwd) throw new Error('Child write fence: cwd changed');
    const tools = pi.getAllTools();
    const own = tools.find(t => t.name === 'workflow_select')?.sourceInfo;
    if (!sameSource(own, trustedSource)) throw new Error('Child write fence: own source identity unavailable');
    for (const name of protectedNames) {
      const winner = tools.find(t => t.name === name)?.sourceInfo;
      if (!sameSource(winner, trustedSource)) throw new Error(`Child write fence: ${name} registration shadowed`);
    }
  }
  return {
    async initialize(ctx) {
      if (!child) return;
      ready = false;
      failure = 'initialization failed';
      try {
        if (platform !== 'darwin') throw new Error(`unsupported host ${platform}`);
        cwd = path.resolve(ctx.cwd);
        canonical = await fs.realpath(cwd);
        const temp = await fs.realpath('/tmp');
        const profile = `(version 1) (allow default) (deny file-write*) (allow file-write* (subpath ${JSON.stringify(canonical)}) (subpath ${JSON.stringify(temp)}) (literal "/dev/null"))`;
        await run(profile, cwd, ['/usr/bin/true'], '', undefined, spawnProcess);
        const sdk = await loadSDK();
        const own = pi.getAllTools().find(tool => tool.name === 'workflow_select')?.sourceInfo;
        const managedShim = path.join(sdk.getAgentDir(), 'extensions', 'automatic-workflows.js');
        const direct = own?.path === extensionPath;
        const shim = own?.path === managedShim && (await fs.readFile(managedShim, 'utf8')).trim() === `export { default } from ${JSON.stringify(extensionPath)};`;
        if (!own || (!direct && !shim)) throw new Error('Child write fence: own source identity unavailable');
        trustedSource = { ...own };
        const local = sdk.createLocalBashOperations();
        operations = { exec: async (command, dir, options) => {
          assert({ cwd: dir });
          if (await fs.realpath(cwd) !== canonical) throw new Error('Child write fence: cwd target changed');
          return local.exec(`/usr/bin/sandbox-exec -p ${quote(profile)} /bin/bash -c ${quote(command)}`, dir, options);
        } };
        const mutate = async (op, target, content) => {
          assert(ctx);
          if (await fs.realpath(cwd) !== canonical) throw new Error('Child write fence: cwd target changed');
          await run(profile, cwd, [process.execPath, '-e', mutation], JSON.stringify([op, target, content]), signals.getStore(), spawnProcess);
        };
        const definitions = [
          sdk.createBashToolDefinition(cwd, { operations }),
          sdk.createWriteToolDefinition(cwd, { operations: { mkdir: dir => mutate('mkdir', dir), writeFile: (p, c) => mutate('write', p, c) } }),
          sdk.createEditToolDefinition(cwd, { operations: { readFile: fs.readFile, access: p => fs.access(p, constants.R_OK | constants.W_OK), writeFile: (p, c) => mutate('write', p, c) } }),
        ];
        for (const definition of definitions) pi.registerTool({ ...definition, execute: (id, params, signal, update, callCtx) => {
          assert(callCtx);
          return signals.run(signal, () => definition.execute(id, params, signal, update, callCtx));
        } });
        ready = true;
        assert(ctx);
      } catch (error) {
        ready = false;
        failure = error.message;
      }
    },
    guard(event, ctx) {
      if (!child || !protectedNames.includes(event.toolName)) return;
      try { assert(ctx); } catch (error) { return { block: true, reason: error.message }; }
    },
    userBash(_event, ctx) {
      if (!child) return;
      assert(ctx);
      return { operations };
    },
  };
}
