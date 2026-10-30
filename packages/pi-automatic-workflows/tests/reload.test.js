import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function installedJiti() {
  try { return createRequire(import.meta.url)('jiti').createJiti; }
  catch {
    const install=path.join(os.homedir(),'.pi/agent/install');
    const version=fs.readFileSync(path.join(install,'current-version'),'utf8').trim();
    assert.match(version,/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/);
    const host=createRequire(path.join(install,'releases',version,'node_modules/@earendil-works/pi-coding-agent/package.json'));
    return host('jiti').createJiti;
  }
}

test('Pi/Jiti reload sees new helper exports and edits without native JS cache leakage',async()=>{
  const createJiti=installedJiti();
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'workflow-jiti-reload-'));
  try {
    for(const dir of ['extension','lib'])fs.cpSync(path.join(root,dir),path.join(temp,dir),{recursive:true});
    fs.writeFileSync(path.join(temp,'package.json'),JSON.stringify({type:'module'}));
    const stub=path.join(temp,'schema-stub.js');
    fs.writeFileSync(stub,'export const Type=new Proxy({}, {get:()=> (...args)=>args[0]});');
    const entry=path.join(temp,'extension/index.js'),helper=path.join(temp,'lib/revisions.ts');
    // Pi supplies host packages through Jiti aliases, not local node_modules.
    const load=()=>createJiti(import.meta.url,{moduleCache:false,alias:{typebox:stub}}).import(entry);
    assert.equal(typeof (await load()).default,'function');
    fs.appendFileSync(helper,'\nexport function reloadProbe(){return 2;}\n');
    fs.appendFileSync(entry,"\nimport {reloadProbe} from '../lib/revisions.ts'; export function readReloadProbe(){return reloadProbe();}\n");
    assert.equal((await load()).readReloadProbe(),2);
    fs.writeFileSync(helper,fs.readFileSync(helper,'utf8').replace('reloadProbe(){return 2;}','reloadProbe(){return 3;}'));
    assert.equal((await load()).readReloadProbe(),3);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});

test('runtime helper imports stay reload-safe and legacy JS entrypoints retain exports',async()=>{
  const files=[path.join(root,'extension/index.js'),...fs.readdirSync(path.join(root,'lib')).filter(name=>name.endsWith('.ts')).map(name=>path.join(root,'lib',name))];
  for(const filename of files){
    const source=fs.readFileSync(filename,'utf8');
    for(const [,specifier] of source.matchAll(/from\s+['"]([^'"]+)['"]/g))if(specifier.startsWith('.'))assert.ok(specifier.endsWith('.ts'),`${filename}: ${specifier} can retain stale exports`);
  }
  for(const name of ['registry','policy','isolation','revisions','acceptance']){
    const legacy=await import(`../lib/${name}.js`),current=await import(`../lib/${name}.ts`);
    assert.deepEqual(Object.keys(legacy),Object.keys(current));
    for(const key of Object.keys(current))assert.equal(legacy[key],current[key]);
  }
});
