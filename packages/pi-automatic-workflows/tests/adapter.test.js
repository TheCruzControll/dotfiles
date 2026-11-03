import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
test('Herdr acknowledgement remains active until an owned completion message',async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'workflow-adapter-'));
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'workflow-adapter-store-'));
 const old=process.env.PI_AUTOMATIC_WORKFLOWS_REVISION_STORE;
 try {
  for(const dir of ['extension','lib','workflows','principles']) fs.cpSync(path.join(root,dir),path.join(temp,dir),{recursive:true});
  fs.writeFileSync(path.join(temp,'package.json'),JSON.stringify({type:'module'}));
  const stub=path.join(temp,'node_modules','typebox');fs.mkdirSync(stub,{recursive:true});
  fs.writeFileSync(path.join(stub,'package.json'),JSON.stringify({type:'module',exports:'./index.js'}));
  // Only schema construction is stubbed. Hook and tool execute implementations are real.
  fs.writeFileSync(path.join(stub,'index.js'),'export const Type=new Proxy({}, {get:()=> (...args)=>args[0]});');
  process.env.PI_AUTOMATIC_WORKFLOWS_REVISION_STORE=path.join(data,'revisions');
  const {default:install}=await import(pathToFileURL(path.join(temp,'extension/index.js')).href);
  const hooks=new Map(),tools=new Map(),bus=new Map(),entries=[];
  const pi={on:(n,h)=>hooks.set(n,h),registerTool:t=>tools.set(t.name,t),registerCommand:()=>{},appendEntry:(customType,data)=>entries.push({type:'custom',customType,data:structuredClone(data)}),events:{on:(n,h)=>bus.set(n,h),emit:(n,p)=>bus.get(n)?.(p)}};
  const ctx={cwd:temp,model:{provider:'test',id:'parent'},hasUI:false,hasPendingMessages:()=>false,sessionManager:{getBranch:()=>entries,getSessionId:()=> 'fixture'}};
  install(pi);hooks.get('session_start')({},ctx);
  const promptEvent={messageType:'user',prompt:'Fix the reported workflow routing bug',systemPromptOptions:{sections:{}}};
  hooks.get('before_agent_start')(promptEvent,ctx);
  assert.match(promptEvent.systemPromptOptions.sections.automatic_workflow,/Keep review loops within the user's acceptance conditions/);
  assert.match(promptEvent.systemPromptOptions.sections.automatic_workflow,/Stop when agreed checks pass/);
  assert.ok(! (await tools.get('workflow_select').execute('select',{route:'investigation',scope:'Read source',reason:'fixture'},null,null,ctx)).isError);
  const call={toolName:'subagent',toolCallId:'one',input:{name:'scout',task:'Read-only source analysis'}};
  assert.ok(hooks.get('tool_call')(call,ctx).block,'unsupported providers must fail closed even for direct launches');
  bus.set('workflow:child-admission-probe',r=>{r.supported=true;});
  assert.equal(hooks.get('tool_call')(call,ctx),undefined);
  assert.equal(call.input.model,'test/parent');
  assert.ok(hooks.get('tool_call')({...call,input:{...call.input,model:'other/model'}},ctx).block);
  assert.equal((await tools.get('workflow_select').execute('reselect',{route:'review',scope:'New route',reason:'fixture'},null,null,ctx)).isError,true);
  hooks.get('tool_result')({toolName:'subagent',toolCallId:'one',details:{id:'herdr-one',status:'started',sessionFile:'/fixture/child.jsonl'}});
  assert.equal(entries.at(-1).data.task.childRuns[0].status,'active');
  let interruptId;
  bus.set('workflow:child-interrupt-request', record => { interruptId=record.id; });
  ctx.signal={aborted:true};
  hooks.get('agent_end')({},ctx);
  assert.equal(interruptId,'herdr-one');
  assert.equal(entries.at(-1).data.task.childRuns[0].status,'active');
  assert.equal(entries.at(-1).data.task.childRuns[0].needsAttention,true);
  ctx.signal={aborted:false};
  hooks.get('session_tree')({},ctx);
  hooks.get('message_end')({message:{customType:'subagent_result',details:{sessionFile:'/fixture/unrelated.jsonl'}}});
  assert.equal(entries.at(-1).data.task.childRuns[0].status,'active');
  for(const details of [
    {id:'unrelated',sessionFile:'/fixture/child.jsonl',disposition:'completed'},
    {id:'herdr-one',sessionFile:'/fixture/child.jsonl',disposition:'gap-exit',exitCode:null},
    {id:'herdr-one',sessionFile:'/fixture/child.jsonl',status:'unresolved'},
  ]) {
    hooks.get('message_end')({message:{customType:'subagent_result',details}});
    assert.equal(entries.at(-1).data.task.childRuns[0].status,'active');
  }
  for (const value of ['completed','cleanup']) {
    const result = await tools.get('workflow_update').execute('blocked',{action:'stage',value},null,null,ctx);
    assert.equal(result.isError,true);
    assert.match(result.content[0].text,/Owned children remain unresolved/);
    assert.notEqual(entries.at(-1).data.task.stage,value);
  }
  hooks.get('message_end')({message:{customType:'subagent_result',details:{sessionFile:'/fixture/child.jsonl'}}});
  assert.equal(entries.at(-1).data.task.childRuns[0].status,'completed');
  const admission=input=>{const r={version:1,parentCwd:temp,parentModel:'test/parent',model:'test/parent',handled:false,allowed:false,...input};bus.get('workflow:child-admission')(r);return r;};
  const resume={toolName:'subagent_resume',toolCallId:'resume',input:{sessionPath:'/fixture/child.jsonl',message:'Read-only followup'}};
  bus.delete('workflow:child-admission-probe');
  assert.ok(hooks.get('tool_call')(resume,ctx).block,'legacy providers cannot resume through an unverified bridge');
  bus.set('workflow:child-admission-probe',r=>{r.supported=true;});
  assert.equal(hooks.get('tool_call')(resume,ctx),undefined);
  const r=admission({kind:'resume',id:'resumed-one',name:'Resume',sessionFile:'/fixture/child.jsonl',cwd:temp,input:resume.input,toolCallId:'resume'});
  assert.equal(r.allowed,true,r.reason);
  assert.ok(hooks.get('tool_call')(resume,ctx).block,'active resumed sessions cannot launch twice');
  hooks.get('message_end')({message:{customType:'subagent_result',details:{id:'herdr-one',sessionFile:'/fixture/child.jsonl',disposition:'completed'}}});
  hooks.get('message_end')({message:{customType:'subagent_result',details:{sessionFile:'/fixture/child.jsonl'}}});
  assert.equal(entries.at(-1).data.task.childRuns[1].status,'active');
  bus.get('workflow:child-lifecycle')({version:1,id:'resumed-one',name:'Resume',sessionFile:'/fixture/child.jsonl',status:'completed'});
  const composite={toolName:'subagent_workflow',input:{action:'start',mode:'chain',steps:[{key:'a',task:'Read-only first step'},{key:'b',task:'Read-only next step'}]}};
  assert.equal(hooks.get('tool_call')(composite,ctx),undefined);
  assert.equal(entries.at(-1).data.task.childRuns.length,2,'preflight does not count unlaunched future stages');
  for(const step of composite.input.steps){
    assert.equal(step.model,'test/parent');
    const req={kind:'spawn',id:`stage-${step.key}`,name:step.key,sessionFile:`/fixture/${step.key}.jsonl`,cwd:temp,input:step};
    assert.equal(admission({...req,model:'other/model'}).allowed,false);
    assert.equal(admission(req).allowed,true);
    assert.equal(admission(req).allowed,false,'runtime identities cannot launch twice');
    bus.get('workflow:child-lifecycle')({version:1,id:req.id,name:req.name,sessionFile:req.sessionFile,status:'completed'});
  }
  const beforeRejected=entries.at(-1).data.task.childRuns.length;
  assert.equal(admission({kind:'spawn',id:'stale-task',name:'stale',sessionFile:'/fixture/stale.jsonl',cwd:temp,input:{task:'Read-only',_workflowTaskId:'other-task'}}).allowed,false);
  for(const input of [
    {action:'start',mode:'parallel',steps:Array.from({length:5},(_,i)=>({key:`x${i}`,task:'Read-only'}))},
    {action:'start',mode:'chain',steps:[null]},
    {action:'start',mode:'parallel',steps:[{key:'wrong-model',task:'Read-only',model:'other/model'}]},
  ]) assert.ok(hooks.get('tool_call')({toolName:'subagent_workflow',input},ctx).block);
  assert.equal(entries.at(-1).data.task.childRuns.length,beforeRejected);
  const owner=entries.at(-1).data.task.taskId;
  await tools.get('workflow_select').execute('phase',{route:'architect',scope:'Implement fixture',reason:'phase'},null,null,ctx);
  assert.equal(entries.at(-1).data.task.taskId,owner);
  assert.equal(entries.at(-1).data.task.childRuns.length,4);
  const resource=await tools.get('workflow_resource').execute('leaf',{principle:'prove-it-works'},null,null,ctx);
  assert.ok(!resource.isError);
  const prepared=await tools.get('workflow_prepare_child').execute('prepare',{},null,null,ctx);
  assert.ok(!prepared.isError,prepared.content?.[0]?.text);
  const writer={toolName:'subagent',toolCallId:'writer',input:{name:'writer',task:'Implement feature; do not modify tests',cwd:prepared.details.cwd}};
  assert.equal(hooks.get('tool_call')(writer,ctx),undefined);
  const nativeWriter=admission({kind:'spawn',id:'native-writer',name:'writer',sessionFile:'/fixture/writer.jsonl',cwd:prepared.details.cwd,input:writer.input,toolCallId:'writer'});
  assert.equal(nativeWriter.allowed,true,nativeWriter.reason);
  assert.equal(entries.at(-1).data.task.childRuns.length,5,'native binding must not double-count the direct reservation');
  assert.ok(hooks.get('tool_call')({...writer,toolCallId:'duplicate'},ctx).block);
  assert.ok(hooks.get('tool_call')({...writer,toolCallId:'shared',input:{...writer.input,cwd:temp,worktree:true}},ctx).block);
  assert.ok(hooks.get('tool_call')({toolName:'subagent_workflow',input:{action:'start'}},ctx).block);
  for(let i=0;i<3;i++) assert.equal(hooks.get('tool_call')({...call,toolCallId:`n${i}`},ctx),undefined);
  assert.ok(hooks.get('tool_call')({...call,toolCallId:'excess'},ctx).block);
 } finally {
  if(old===undefined) delete process.env.PI_AUTOMATIC_WORKFLOWS_REVISION_STORE;else process.env.PI_AUTOMATIC_WORKFLOWS_REVISION_STORE=old;
  fs.rmSync(temp,{recursive:true,force:true});
  fs.rmSync(data,{recursive:true,force:true});
 }
});
