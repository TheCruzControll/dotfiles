import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {beginCandidate,loadActiveRevision} from '../lib/revisions.js';
import {behavioralFixture} from './helpers/behavioral-fixture.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

async function fixture(run){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'candidate-adapter-'));
  const storeRoot=path.join(temp,'revision-store');
  const keys=['PI_AUTOMATIC_WORKFLOWS_REVISION_STORE','PI_AUTOMATIC_WORKFLOWS_ENABLE_PROMOTION','PI_SUBAGENT_ID','PI_SUBAGENT_CHILD'];
  const saved=keys.map(key=>[key,process.env[key]]);
  try {
    for(const dir of ['extension','lib','workflows','principles','tests'])fs.cpSync(path.join(root,dir),path.join(temp,dir),{recursive:true});
    fs.writeFileSync(path.join(temp,'package.json'),JSON.stringify({type:'module'}));
    const stub=path.join(temp,'node_modules/typebox');fs.mkdirSync(stub,{recursive:true});
    fs.writeFileSync(path.join(stub,'package.json'),JSON.stringify({type:'module',exports:'./index.js'}));
    fs.writeFileSync(path.join(stub,'index.js'),'export const Type=new Proxy({}, {get:()=> (...args)=>args[0]});');
    process.env.PI_AUTOMATIC_WORKFLOWS_REVISION_STORE=storeRoot;
    process.env.PI_AUTOMATIC_WORKFLOWS_ENABLE_PROMOTION='1';
    delete process.env.PI_SUBAGENT_ID;delete process.env.PI_SUBAGENT_CHILD;
    const c=beginCandidate({sourceProjectPath:temp,packageRoot:temp,storeRoot});
    fs.appendFileSync(path.join(c.candidateRoot,'workflows/plan.md'),'\nScoped candidate fixture note.\n');
    const hooks=new Map(),tools=new Map(),bus=new Map(),commands=new Map(),entries=[],notices=[];
    const pi={on:(name,handler)=>hooks.set(name,handler),registerTool:tool=>tools.set(tool.name,tool),registerCommand:(name,command)=>commands.set(name,command),appendEntry:(customType,data)=>entries.push({type:'custom',customType,data:structuredClone(data)}),events:{on:(name,handler)=>bus.set(name,handler),emit:(name,data)=>bus.get(name)?.(data)}};
    const ctx={cwd:c.candidateRoot,model:{provider:'test',id:'fixture'},hasUI:false,hasPendingMessages:()=>false,ui:{notify:message=>notices.push(message)},sessionManager:{getBranch:()=>entries,getSessionId:()=> 'candidate-fixture'}};
    const {default:install}=await import(pathToFileURL(path.join(temp,'extension/index.js')).href);
    install(pi);hooks.get('session_start')({},ctx);
    const execute=(name,args={})=>tools.get(name).execute(name,args,undefined,undefined,ctx);
    assert.equal((await execute('workflow_select',{route:'eval',scope:'Evaluate fixture',reason:'synthetic unit fixture'})).isError,undefined);
    process.env.PI_SUBAGENT_CHILD='1';
    assert.equal((await execute('workflow_candidate_context')).isError,true,'child must not bind the first context');
    delete process.env.PI_SUBAGENT_CHILD;
    const getSessionId=ctx.sessionManager.getSessionId;
    ctx.sessionManager.getSessionId=()=>undefined;
    assert.equal((await execute('workflow_candidate_context')).isError,true,'missing identity must not bind');
    ctx.sessionManager.getSessionId=getSessionId;
    assert.equal((await execute('workflow_candidate_complete')).isError,true,'completion cannot bind ownership');
    const context=(await execute('workflow_candidate_context')).details;
    const report=behavioralFixture({...context,verifiedDigest:context.candidateDigest});
    await run({temp,storeRoot,c,ctx,hooks,tools,bus,commands,entries,notices,execute,report});
  }finally{
    for(const [key,value]of saved)if(value===undefined)delete process.env[key];else process.env[key]=value;
    fs.rmSync(temp,{recursive:true,force:true});
  }
}

test('coordinator evidence, explicit completion and final settlement activate only the isolated fixture store',async()=>fixture(async f=>{
  process.env.PI_SUBAGENT_ID='fixture-child';
  assert.equal((await f.execute('workflow_candidate_acceptance',{report:f.report})).isError,true);
  delete process.env.PI_SUBAGENT_ID;
  f.bus.set('workflow:child-admission-probe',r=>{r.supported=true;});
  assert.equal(f.hooks.get('tool_call')({toolName:'subagent',toolCallId:'pending',input:{name:'fixture-review',task:'Read-only fixture'}},f.ctx),undefined);
  assert.equal((await f.execute('workflow_candidate_acceptance',{report:f.report})).isError,true);
  f.hooks.get('tool_result')({toolName:'subagent',toolCallId:'pending',details:{error:'synthetic reservation; never launched'}});
  assert.equal((await f.execute('workflow_candidate_acceptance',{report:f.report})).isError,undefined);
  const receipt=()=>JSON.parse(fs.readFileSync(path.join(f.storeRoot,'receipts',`${f.c.candidateId}.json`),'utf8'));
  f.hooks.get('agent_settled')({aborted:false},f.ctx);
  assert.equal(receipt().status,'building','idle without explicit completion must not evaluate');
  assert.equal((await f.execute('workflow_candidate_complete')).isError,undefined);
  f.hooks.get('agent_settled')({aborted:true},f.ctx);
  assert.equal(receipt().status,'building','aborted settlement must not evaluate');
  f.hooks.get('agent_settled')({aborted:false},f.ctx);
  assert.equal(loadActiveRevision({packageRoot:f.temp,storeRoot:f.storeRoot}).revisionId,f.c.candidateId);
  assert.equal(f.entries.at(-1).data.task.revision,'0.1.0','existing task remains pinned');
  await f.execute('workflow_update',{action:'stage',value:'completed'});
  const selected=await f.execute('workflow_select',{route:'plan',scope:'Plan next fixture',reason:'new task'});
  assert.equal(selected.isError,undefined,selected.content?.[0]?.text);
  assert.equal(f.entries.at(-1).data.task.revision,f.c.candidateId);
  await f.commands.get('workflow').handler('rollback',f.ctx);
  assert.equal(loadActiveRevision({packageRoot:f.temp,storeRoot:f.storeRoot}).revisionId,'0.1.0');
  assert.match((await f.execute('workflow_resource')).content[0].text,/Scoped candidate fixture note/,'running task stays pinned after rollback');
}));

for(const mode of ['missing','stale','tampered','release-disabled'])test(`final settlement keeps ${mode} acceptance inactive`,async()=>fixture(async f=>{
  if(mode!=='missing')assert.equal((await f.execute('workflow_candidate_acceptance',{report:f.report})).isError,undefined);
  if(mode==='stale')fs.appendFileSync(path.join(f.c.candidateRoot,'workflows/plan.md'),'\nChanged after evaluation.\n');
  if(mode==='tampered'){
    const filename=path.join(f.storeRoot,'receipts',`${f.c.candidateId}.pending-acceptance.json`);
    const report=JSON.parse(fs.readFileSync(filename,'utf8'));report.scenarios[0].rationale='Changed after coordinator submission.';fs.writeFileSync(filename,JSON.stringify(report));
  }
  if(mode==='release-disabled')delete process.env.PI_AUTOMATIC_WORKFLOWS_ENABLE_PROMOTION;
  await f.execute('workflow_candidate_complete');
  f.hooks.get('agent_settled')({aborted:false},f.ctx);
  assert.equal(loadActiveRevision({packageRoot:f.temp,storeRoot:f.storeRoot}).revisionId,'0.1.0');
  assert.ok(f.notices.some(message=>message.includes('remains inactive')));
}));

for (const identity of ['child-id', 'child-flag', 'unrelated', 'missing']) test(`reported candidate rejects ${identity} finalization`,async()=>fixture(async f=>{
  const filename=path.join(f.storeRoot,'receipts',`${f.c.candidateId}.json`);
  assert.equal(JSON.parse(fs.readFileSync(filename)).coordinatorSessionId,'candidate-fixture');
  assert.equal((await f.execute('workflow_candidate_acceptance',{report:f.report})).isError,undefined);
  const owner=f.ctx.sessionManager.getSessionId;
  const impersonate=()=>{
    if(identity==='child-id')process.env.PI_SUBAGENT_ID='fixture-child';
    else if(identity==='child-flag')process.env.PI_SUBAGENT_CHILD='1';
    else f.ctx.sessionManager.getSessionId=()=>identity==='missing'?undefined:'unrelated-session';
  };
  const restore=()=>{delete process.env.PI_SUBAGENT_ID;delete process.env.PI_SUBAGENT_CHILD;f.ctx.sessionManager.getSessionId=owner;};
  impersonate();
  const reported=fs.readFileSync(filename,'utf8');
  for(const name of ['workflow_candidate_context','workflow_candidate_acceptance','workflow_candidate_complete'])
    assert.equal((await f.execute(name,{report:f.report})).isError,true,name);
  f.hooks.get('agent_settled')({aborted:false},f.ctx);
  assert.equal(fs.readFileSync(filename,'utf8'),reported);
  restore();
  assert.equal((await f.execute('workflow_candidate_complete')).isError,undefined);
  const completed=fs.readFileSync(filename,'utf8');
  impersonate();
  f.hooks.get('agent_settled')({aborted:false},f.ctx);
  assert.equal(fs.readFileSync(filename,'utf8'),completed,'foreign settlement must not evaluate an already-reported completed candidate');
  assert.equal(loadActiveRevision({packageRoot:f.temp,storeRoot:f.storeRoot}).revisionId,'0.1.0');
  restore();
  f.hooks.get('agent_settled')({aborted:false},f.ctx);
  assert.equal(loadActiveRevision({packageRoot:f.temp,storeRoot:f.storeRoot}).revisionId,f.c.candidateId);
}));
