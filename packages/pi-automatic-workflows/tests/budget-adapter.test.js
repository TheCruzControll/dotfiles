import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

async function fixture(run){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'workflow-budget-'));
  const keys=['PI_AUTOMATIC_WORKFLOWS_REVISION_STORE','PI_SUBAGENT_ID','PI_SUBAGENT_CHILD'];
  const saved=keys.map(key=>[key,process.env[key]]);
  try{
    for(const dir of ['extension','lib','workflows','principles'])fs.cpSync(path.join(root,dir),path.join(temp,dir),{recursive:true});
    fs.writeFileSync(path.join(temp,'package.json'),JSON.stringify({type:'module'}));
    const stub=path.join(temp,'node_modules/typebox');fs.mkdirSync(stub,{recursive:true});
    fs.writeFileSync(path.join(stub,'package.json'),JSON.stringify({type:'module',exports:'./index.js'}));
    fs.writeFileSync(path.join(stub,'index.js'),'export const Type=new Proxy({}, {get:()=> (...args)=>args[0]});');
    process.env.PI_AUTOMATIC_WORKFLOWS_REVISION_STORE=path.join(temp,'store');
    delete process.env.PI_SUBAGENT_ID;delete process.env.PI_SUBAGENT_CHILD;
    const hooks=new Map(),tools=new Map(),bus=new Map(),entries=[];
    const pi={on:(n,h)=>hooks.set(n,h),registerTool:t=>tools.set(t.name,t),registerCommand:()=>{},appendEntry:(customType,data)=>entries.push({type:'custom',customType,data:structuredClone(data)}),events:{on:(n,h)=>bus.set(n,h),emit:(n,p)=>bus.get(n)?.(p)}};
    const ctx={cwd:temp,model:{provider:'test',id:'parent'},hasUI:true,hasPendingMessages:()=>false,ui:{setStatus(){},notify(){},confirm:async()=>false},sessionManager:{getBranch:()=>entries,getSessionId:()=> 'budget-fixture'}};
    const {default:install}=await import(pathToFileURL(path.join(temp,'extension/index.js')).href);
    install(pi);hooks.get('session_start')({},ctx);
    const execute=(name,args={})=>tools.get(name).execute(name,args,undefined,undefined,ctx);
    await execute('workflow_select',{route:'architect',scope:'Fixture task',reason:'fixture'});
    await run({temp,ctx,hooks,tools,bus,entries,execute,state:()=>entries.at(-1).data.task});
  }finally{
    for(const [key,value]of saved)if(value===undefined)delete process.env[key];else process.env[key]=value;
    fs.rmSync(temp,{recursive:true,force:true});
  }
}

test('within-budget requests never prompt or shrink the 16-launch allowance',async()=>fixture(async f=>{
  let prompts=0;
  f.ctx.ui.confirm=async()=>{prompts++;return true;};
  for(const launches of [1,8,16]) {
    const result=await f.execute('workflow_request_budget',{launches,reason:'Use existing allowance'});
    assert.equal(result.isError,undefined);
    assert.deepEqual(result.details,{approvalRequired:false,totalLimit:16,remaining:16});
    assert.equal(f.state().launchAllowance,undefined);
  }
  assert.equal(prompts,0);
  f.ctx.hasUI=false;
  assert.equal((await f.execute('workflow_request_budget',{launches:1,reason:'No prompt needed'})).details.approvalRequired,false);
  const resource=await f.execute('workflow_resource');
  assert.match(resource.content[0].text,/16 total launches/);
  assert.doesNotMatch(resource.content[0].text,/eight total launches/);
}));

test('the sixteenth launch fits and the seventeenth needs approval',async()=>fixture(async f=>{
  const restoreCount=count=>{
    const task=structuredClone(f.state());
    task.childRuns=Array.from({length:count},(_,i)=>({childId:`fixture-${i}`,status:'completed',isolated:true}));
    f.entries.push({type:'custom',customType:'automatic-workflows',data:{schemaVersion:1,action:'updated',task}});
    f.hooks.get('session_tree')({},f.ctx);
  };
  let prompts=0;
  f.ctx.ui.confirm=async()=>{prompts++;return true;};
  restoreCount(15);
  assert.equal((await f.execute('workflow_request_budget',{launches:1,reason:'Sixteenth'})).details.approvalRequired,false);
  assert.equal(prompts,0);
  restoreCount(16);
  const result=await f.execute('workflow_request_budget',{launches:1,reason:'Seventeenth'});
  assert.equal(prompts,1);
  assert.equal(result.details.totalLimit,17);
  assert.equal(f.state().childRuns.length,16,'approval never launches children');
}));

test('launch allowance requires owner confirmation and survives route phases and reload',async()=>fixture(async f=>{
  let prompts=0;
  f.ctx.ui.confirm=async(_title,message)=>{prompts++;assert.match(message,/exactly the next 20/);return false;};
  assert.equal((await f.execute('workflow_request_budget',{launches:20,reason:'Finish bounded live checks'})).details.approved,false);
  assert.equal(f.state().launchAllowance,undefined);
  f.ctx.hasUI=false;
  assert.equal((await f.execute('workflow_request_budget',{launches:20,reason:'No UI'})).isError,true);
  assert.equal(prompts,1);
  f.ctx.hasUI=true;f.ctx.ui.confirm=async()=>true;
  process.env.PI_SUBAGENT_ID='fixture-child';
  assert.equal((await f.execute('workflow_request_budget',{launches:20,reason:'Child request'})).isError,true);
  delete process.env.PI_SUBAGENT_ID;
  const result=await f.execute('workflow_request_budget',{launches:20,reason:'Finish bounded live checks'});
  assert.equal(result.details.totalLimit,20);
  assert.equal(f.state().childRuns.length,0,'approval never starts an agent');
  const allowance=structuredClone(f.state().launchAllowance);
  await f.execute('workflow_select',{route:'review',scope:'Review fixture',reason:'next phase'});
  assert.deepEqual(f.state().launchAllowance,allowance);
  f.hooks.get('session_tree')({},f.ctx);
  await f.execute('workflow_update',{action:'stage',value:'verify'});
  assert.deepEqual(f.state().launchAllowance,allowance);
}));

test('changed task while owner approval is pending rejects the stale confirmation',async()=>fixture(async f=>{
  let resolve;
  f.ctx.ui.confirm=()=>new Promise(yes=>{resolve=yes;});
  const waiting=f.execute('workflow_request_budget',{launches:20,reason:'Fixture pending approval'});
  await f.execute('workflow_select',{route:'plan',scope:'Changed phase',reason:'scope changed'});
  resolve(true);
  assert.equal((await waiting).isError,true);
  assert.equal(f.state().launchAllowance,undefined);
}));

test('changed launch count while owner approval is pending rejects the stale confirmation',async()=>fixture(async f=>{
  let resolve;
  f.ctx.ui.confirm=()=>new Promise(yes=>{resolve=yes;});
  const waiting=f.execute('workflow_request_budget',{launches:20,reason:'Fixture pending approval'});
  f.bus.set('workflow:child-admission-probe',r=>{r.supported=true;});
  f.hooks.get('tool_call')({toolName:'subagent',toolCallId:'fixture',input:{name:'scout',task:'Read-only fixture'}},f.ctx);
  resolve(true);
  assert.equal((await waiting).isError,true);
  assert.equal(f.state().launchAllowance,undefined);
}));

test('scoped isolation copies only a canonical in-project subdirectory',async()=>fixture(async f=>{
  const source=path.join(f.temp,'small');fs.mkdirSync(source);fs.writeFileSync(path.join(source,'fixture.txt'),'source');
  const result=await f.execute('workflow_prepare_child',{sourcePath:'small'});
  assert.equal(result.isError,undefined,result.content?.[0]?.text);
  assert.equal(result.details.sourceRoot,fs.realpathSync(source));
  assert.deepEqual(fs.readdirSync(result.details.cwd).filter(name=>name!=='manifest.json'),['fixture.txt']);
  assert.equal(fs.readFileSync(path.join(source,'fixture.txt'),'utf8'),'source');
  for(const sourcePath of ['../outside',source])assert.equal((await f.execute('workflow_prepare_child',{sourcePath})).isError,true);
  fs.symlinkSync(source,path.join(f.temp,'alias'),'dir');
  assert.equal((await f.execute('workflow_prepare_child',{sourcePath:'alias'})).isError,true);
}));
