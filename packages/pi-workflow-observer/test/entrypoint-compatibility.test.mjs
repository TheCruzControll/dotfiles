import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../extension/workflow-observer');

function installedJiti() {
  try { return createRequire(import.meta.url)('jiti').createJiti; }
  catch {
    const install=path.join(os.homedir(),'.pi/agent/install');
    const version=fs.readFileSync(path.join(install,'current-version'),'utf8').trim();
    assert.match(version,/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/);
    return createRequire(path.join(install,'releases',version,'node_modules/@earendil-works/pi-coding-agent/package.json'))('jiti').createJiti;
  }
}

test('observer helper exports reload through the installed Pi/Jiti loader options',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'observer-jiti-reload-'));
  try {
    fs.cpSync(source,path.join(root,'extension'),{recursive:true});
    fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({type:'module'}));
    const stub=path.join(root,'host-stub.js');
    fs.writeFileSync(stub,'export class SessionManager {} export const matchesKey=()=>false,truncateToWidth=x=>x,visibleWidth=x=>x.length,wrapTextWithAnsi=x=>[x];');
    const entry=path.join(root,'extension/index.js'),helper=path.join(root,'extension/lib/herdr.ts');
    const createJiti=installedJiti();
    const load=()=>createJiti(import.meta.url,{moduleCache:false,alias:{'@earendil-works/pi-coding-agent':stub,'@earendil-works/pi-tui':stub}}).import(entry);
    assert.equal(typeof (await load()).default,'function');
    fs.appendFileSync(helper,'\nexport function reloadProbe(){return 2;}\n');
    fs.appendFileSync(entry,"\nimport {reloadProbe} from './lib/herdr.ts'; export function readReloadProbe(){return reloadProbe();}\n");
    assert.equal((await load()).readReloadProbe(),2);
    fs.writeFileSync(helper,fs.readFileSync(helper,'utf8').replace('reloadProbe(){return 2;}','reloadProbe(){return 3;}'));
    assert.equal((await load()).readReloadProbe(),3);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('observer entrypoint resolves projects even when the host retains the older Herdr helper API', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'observer-entry-compat-')));
  try {
    fs.cpSync(source, path.join(root, 'extension'), { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({type:'module'}));
    // Model the older helper interface loaded in a long-lived host.
    fs.writeFileSync(path.join(root, 'extension/lib/herdr.ts'), 'export const OBSERVER_BUILD_WORKSPACE_LABEL="Workflow builds"; export function findDedicatedBuildWorkspace(){return undefined;}\n');
    for (const [name, content] of [
      ['@earendil-works/pi-coding-agent', 'export class SessionManager {}'],
      ['@earendil-works/pi-tui', 'export const matchesKey=()=>false,truncateToWidth=x=>x,visibleWidth=x=>x.length,wrapTextWithAnsi=x=>[x];'],
    ]) {
      const target=path.join(root,'node_modules',name);
      fs.mkdirSync(target,{recursive:true});
      fs.writeFileSync(path.join(target,'package.json'),JSON.stringify({type:'module',exports:'./index.js'}));
      fs.writeFileSync(path.join(target,'index.js'),content);
    }
    // Import only: never instantiate the observer or open its global database.
    const entry = await import(pathToFileURL(path.join(root,'extension/index.js')).href);
    assert.equal(typeof entry.default,'function');
    assert.equal(typeof entry.resolveObserverProjectPath,'function');
    const a=path.join(root,'a'),b=path.join(root,'b'),alias=path.join(root,'alias');
    fs.mkdirSync(a);fs.mkdirSync(b);fs.symlinkSync(a,alias,'dir');
    const recorded=entry.resolveObserverProjectPath(alias);
    fs.unlinkSync(alias);fs.symlinkSync(b,alias,'dir');
    assert.equal(recorded,a);
    assert.equal(entry.resolveObserverProjectPath(recorded),a);
    assert.equal(entry.resolveObserverProjectPath(alias),b);
    assert.throws(()=>entry.resolveObserverProjectPath('relative'),/absolute project path/);
    assert.throws(()=>entry.resolveObserverProjectPath(path.join(root,'missing')));
    assert.throws(()=>entry.resolveObserverProjectPath(path.join(root,'package.json')),/not a directory/);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});
