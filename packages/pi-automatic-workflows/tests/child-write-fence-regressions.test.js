import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createChildWriteFence} from '../lib/child-write-fence.ts';
const sdkBase='/Users/franciscruz/.pi/agent/install/releases/1.4.0/node_modules/@earendil-works/pi-coding-agent/dist';
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};

test('real Pi loader/Jiti global shim provenance initializes usable fenced tools', {skip:process.platform!=='darwin'}, async()=>{
 const base=await fs.mkdtemp(path.join(process.cwd(),'.fence-shim-test-'));
 for(const dir of ['extension','lib'])await fs.cp(new URL(`../${dir}`,import.meta.url),path.join(base,dir),{recursive:true});
 await fs.writeFile(path.join(base,'package.json'),'{"type":"module"}');
 const agentDir=path.join(base,'agent'),shim=path.join(agentDir,'extensions','automatic-workflows.js'),entry=path.join(base,'extension','index.js');
 await fs.mkdir(path.dirname(shim),{recursive:true});await fs.writeFile(shim,`export { default } from ${JSON.stringify(entry)};\n`);
 const saved=Object.fromEntries(['PI_SUBAGENT_CHILD','PI_SUBAGENT_ID','PI_CODING_AGENT_DIR'].map(k=>[k,process.env[k]]));
 process.env.PI_SUBAGENT_CHILD='1';delete process.env.PI_SUBAGENT_ID;process.env.PI_CODING_AGENT_DIR=agentDir;
 try{
  const {loadExtensions,createExtensionRuntime}=await import(sdkBase+'/core/extensions/loader.js');
  const runtime=createExtensionRuntime();let extension;
  runtime.getAllTools=()=>extension?[...extension.tools].map(([name,t])=>({name,...t.definition,sourceInfo:t.sourceInfo})):[];
  const result=await loadExtensions([shim],base,undefined,runtime);assert.deepEqual(result.errors,[]);assert.equal(result.extensions.length,1);extension=result.extensions[0];
  assert.equal(extension.tools.get('workflow_select').sourceInfo.path,shim);
  const ctx={cwd:base,hasUI:false,sessionManager:{getBranch:()=>[],getSessionId:()=> 'shim-fixture',getSessionFile:()=>undefined}};
  for(const hook of extension.handlers.get('session_start'))await hook({},ctx);
  const gate=extension.handlers.get('tool_call')[0];assert.equal(gate({toolName:'bash'},ctx),undefined);
  const execute=(name,args)=>extension.tools.get(name).definition.execute('fixture',args,undefined,undefined,ctx);
  await execute('write',{path:'inside.txt',content:'hello'});await execute('edit',{path:'inside.txt',edits:[{oldText:'hello',newText:'world'}]});
  assert.equal(await fs.readFile(path.join(base,'inside.txt'),'utf8'),'world');
  await execute('bash',{command:'printf shim-ok > shell.txt'});assert.equal(await fs.readFile(path.join(base,'shell.txt'),'utf8'),'shim-ok');
  const own=extension.tools.get('workflow_select');const origin=own.sourceInfo;own.sourceInfo={...origin,path:'/foreign/extension.js'};assert.ok(gate({toolName:'write'},ctx).block);own.sourceInfo=origin;
  await fs.writeFile(shim,'export default function untrustedForwarder() {}\n');
  for(const hook of extension.handlers.get('session_start'))await hook({},ctx);
  assert.ok(gate({toolName:'bash'},ctx).block,'An arbitrary forwarding entrypoint is not the managed shim');
 }finally{for(const [key,value]of Object.entries(saved))if(value===undefined)delete process.env[key];else process.env[key]=value;}
});

test('aborted mutation retains the SDK same-file queue until child close',async()=>{
 const base=await fs.mkdtemp(path.join(process.cwd(),'.fence-queue-test-'));await fs.writeFile(path.join(base,'file'),'hello');
 const tools=new Map(),sourceInfo={path:'/owned/extension/index.js',source:'local',scope:'project',origin:'top-level'};
 tools.set('workflow_select',{name:'workflow_select',sourceInfo});const pi={registerTool:t=>tools.set(t.name,{...t,sourceInfo}),getAllTools:()=>[...tools.values()]};
 const mutations=[],firstEntered=deferred(),secondEntered=deferred();
 const spawnProcess=(_command,args,options)=>{
  const child=new EventEmitter();child.stdin=new PassThrough();child.stderr=new PassThrough();
  if(args.includes('/usr/bin/true'))queueMicrotask(()=>child.emit('close',0));
  else{mutations.push(child);options.signal?.addEventListener('abort',()=>child.emit('error',new Error('abort requested')),{once:true});(mutations.length===1?firstEntered:secondEntered).resolve(options.signal);}
  return child;
 };
 const fence=createChildWriteFence(pi,sourceInfo.path,{child:true,platform:'darwin',loadSDK:()=>import(sdkBase+'/index.js'),spawnProcess});
 const ctx={cwd:base};await fence.initialize(ctx);assert.equal(fence.guard({toolName:'edit'},ctx),undefined);
 const execute=(newText,signal)=>tools.get('edit').execute('fixture',{path:'file',edits:[{oldText:'hello',newText}]},signal,undefined,ctx);
 const controller=new AbortController(),first=execute('one',controller.signal);let settled=false;first.then(()=>{settled=true;},()=>{settled=true;});
 assert.equal(await firstEntered.promise,controller.signal);controller.abort();const second=execute('two');
 await new Promise(setImmediate);assert.equal(settled,false);assert.equal(mutations.length,1,'Second operation must not enter before closure');
 mutations[0].emit('close',null);await assert.rejects(first,/abort/i);await secondEntered.promise;
 assert.equal(mutations.length,2);mutations[1].emit('close',0);await second;
});
