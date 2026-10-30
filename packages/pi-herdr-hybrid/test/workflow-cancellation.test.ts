import test from 'node:test';
import assert from 'node:assert/strict';
import { Workflows, registerWorkflows } from '../src/workflows.ts';
const steps=[{key:'a',task:'first'},{key:'b',task:'second'}];
function deferred<T=any>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(yes=>{resolve=yes;});return{promise,resolve};}

test('pre-aborted composite never creates a run or invokes a child launch',async()=>{
  const source=new AbortController();source.abort();let launches=0;
  const manager=new Workflows(async()=>{launches++;return{};},()=>{});
  await assert.rejects(()=>manager.start('parallel',steps,{signal:source.signal}),/aborted/);
  assert.equal(launches,0);assert.equal(manager.runs.size,0);
});

test('caller abort reaches pending parallel launches and late receipts are interrupted',async()=>{
  const source=new AbortController(),pending=steps.map(()=>deferred());
  const signals:AbortSignal[]=[],interrupts:string[]=[];
  const manager=new Workflows(async(step,_context,signal)=>{signals.push(signal!);return pending[step.key==='a'?0:1].promise;},()=>{},async({id})=>{interrupts.push(id);});
  const start=manager.start('parallel',steps,{signal:source.signal});
  const run=[...manager.runs.values()][0];
  assert.equal(signals.length,2);source.abort();
  assert.ok(signals.every(signal=>signal.aborted));assert.equal(run.status,'cancelled');
  pending[0].resolve({details:{id:'a'}});pending[1].resolve({details:{id:'b'}});
  await start;
  assert.deepEqual(interrupts.sort(),['a','b']);
  assert.ok(Object.values(run.children).every(child=>child.ownership==='active'),'Escape is not terminal evidence');
});

test('later chain stages retain original context/signal despite unrelated tool calls',async()=>{
  let tool:any;const calls:any[]=[],interrupts:string[]=[];
  const outcome=registerWorkflows({on(){},registerTool(value:any){tool=value;},appendEntry(){},sendMessage(){}},
    async(step,context,signal)=>{calls.push({context,signal});return{details:{id:step.key}};},async({id})=>{interrupts.push(id);});
  const source=new AbortController(),owner={session:'owner'};
  const started=await tool.execute('',{action:'start',mode:'chain',steps},source.signal,null,owner);
  await tool.execute('',{action:'list'},null,null,{session:'unrelated'});
  await outcome('a',{kind:'completed',exitCode:0,summary:'first'});
  assert.equal(calls.length,2);assert.ok(calls.every(call=>call.context===owner));
  assert.equal(calls[0].signal,calls[1].signal);
  source.abort();await Promise.resolve();
  assert.equal(calls[1].signal.aborted,true);
  assert.equal(started.details.status,'cancelled');assert.deepEqual(interrupts,['b']);
});

test('notification faults cannot suppress caller-abort interruption receipts',async()=>{
  const source=new AbortController(),interrupts:string[]=[];
  const manager=new Workflows(async()=>({details:{id:'owned'}}),()=>{throw Error('notification unavailable');},async({id})=>{interrupts.push(id);});
  const run=await manager.start('chain',[steps[0]],{signal:source.signal});
  source.abort();await Promise.resolve();await Promise.resolve();
  assert.equal(run.status,'cancelled');assert.deepEqual(interrupts,['owned']);
  assert.equal(run.interrupts.length,1);assert.match(run.notificationError!,/notification unavailable/);
});

test('completed runs detach cancellation listeners; unresolved outcomes remain interruptible',async()=>{
  const source=new AbortController(),interrupts:string[]=[];
  let launches=0;
  const manager=new Workflows(async()=>({details:{id:++launches===1?'done':'blocked'}}),()=>{},async({id})=>{interrupts.push(id);});
  const run=await manager.start('chain',[steps[0]],{signal:source.signal});
  await manager.outcome('done',{kind:'completed',exitCode:0,summary:'done'});
  source.abort();assert.equal(run.status,'completed');assert.deepEqual(interrupts,[]);
  const blocked=await manager.start('chain',[steps[0]]);
  await manager.outcome('blocked',{kind:'ping',message:'needs input'});
  assert.equal(blocked.status,'blocked');
  await manager.cancel(blocked.id);
  assert.deepEqual(interrupts,['blocked']);
  assert.equal(blocked.children.a.ownership,'active');
});
