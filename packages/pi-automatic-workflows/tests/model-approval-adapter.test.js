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

test('model approval requires exact owner UI consent, validates fields, and replays only within task',async()=>fixture(async f=>{
 const mappings=[{field:'agent',role:'scout',model:'test/cheap:high'}];
 assert.equal((await f.execute('workflow_approve_child_models',{mappings})).details.approved,false);
 f.ctx.hasUI=false;
 assert.equal((await f.execute('workflow_approve_child_models',{mappings})).isError,true);
 f.ctx.hasUI=true;f.ctx.ui.confirm=async()=>true;
 process.env.PI_SUBAGENT_ID='child';
 assert.equal((await f.execute('workflow_approve_child_models',{mappings})).isError,true);
 delete process.env.PI_SUBAGENT_ID;
 for(const bad of [[{field:'task',role:'scout',model:'test/cheap'}],[{field:'name',role:'a\nb',model:'test/cheap'}],[{field:'name',role:'scout',model:'cheap'}]]) assert.equal((await f.execute('workflow_approve_child_models',{mappings:bad})).isError,true);
 assert.equal((await f.execute('workflow_approve_child_models',{mappings:[{field:'name',role:'S01E04 page — issue 3',model:'test/cheap:max'}]})).details.approved,true);
 assert.equal((await f.execute('workflow_approve_child_models',{mappings})).details.approved,true);
 await f.execute('workflow_select',{route:'review',scope:'phase',reason:'phase'});
 f.hooks.get('session_tree')({},f.ctx);
 await f.execute('workflow_update',{action:'stage',value:'verify'});
 assert.deepEqual(f.state().childModelMappings,mappings);
 await f.execute('workflow_update',{action:'stage',value:'completed'});
 await f.execute('workflow_select',{route:'architect',scope:'next',reason:'next'});
 assert.equal(f.state().childModelMappings,undefined);
}));

test('pending confirmation cannot authorize a changed task',async()=>fixture(async f=>{
 let resolve; f.ctx.ui.confirm=()=>new Promise(r=>{resolve=r;});
 const pending=f.execute('workflow_approve_child_models',{mappings:[{field:'name',role:'scout',model:'test/cheap'}]});
 await f.execute('workflow_select',{route:'review',scope:'phase',reason:'phase'});
 resolve(true);assert.equal((await pending).isError,true);
 assert.equal(f.state().childModelMappings,undefined);
}));

test('shared admission checks requested and resolved models, selectors, defaults, stages and resume identity',async()=>fixture(async f=>{
 f.ctx.ui.confirm=async()=>true;
 await f.execute('workflow_approve_child_models',{mappings:[{field:'agent',role:'scout',model:'test/cheap:high'},{field:'name',role:'scan',model:'test/cheap'}]});
 f.bus.set('workflow:child-admission-probe',r=>{r.supported=true;});
 const call=(input,id='call')=>f.hooks.get('tool_call')({toolName:'subagent',toolCallId:id,input},f.ctx);
 assert.equal(call({name:'scout',task:'Read-only',model:'test/cheap'}).block,true,'name cannot impersonate agent selector');
 const input={agent:'scout',name:'scan',task:'Read-only',model:'test/cheap:high'};
 assert.equal(call(input),undefined);
 const admit=(patch={})=>{const r={version:1,kind:'spawn',id:'native',sessionFile:'/child',parentCwd:f.temp,parentModel:'test/parent',model:'test/cheap:high',cwd:f.temp,input,toolCallId:'call',...patch}; f.bus.get('workflow:child-admission')(r);return r;};
 assert.equal(admit({model:'test/expensive'}).allowed,false);
 assert.equal(admit({input:{...input,_workflowTaskId:'stale'}}).allowed,false);
 process.env.PI_SUBAGENT_ID='child';
 assert.equal(admit().allowed,false);
 delete process.env.PI_SUBAGENT_ID;
 assert.equal(admit({input:{...input,model:'test/expensive'}}).allowed,false);
 assert.equal(admit().allowed,true);
 f.hooks.get('message_end')({message:{customType:'subagent_result',details:{id:'native',sessionFile:'/child',disposition:'completed'}}});
 const resume={sessionPath:'/child',name:'renamed'};
 assert.equal(f.hooks.get('tool_call')({toolName:'subagent_resume',input:resume},f.ctx),undefined);
 assert.equal(admit({kind:'resume',id:'resumed',input:resume,toolCallId:'resume'}).allowed,true,'resume uses saved selector, not display name');
 for(const mode of ['parallel','chain']) {
 const steps=[{key:'scan',task:'Read-only',model:'test/cheap'}];
 assert.equal(f.hooks.get('tool_call')({toolName:'subagent_workflow',input:{mode,steps}},f.ctx),undefined);
 assert.equal(steps[0].model,'test/cheap');
 assert.equal(f.hooks.get('tool_call')({toolName:'subagent_workflow',input:{mode,steps:[{key:'other',task:'Read-only',model:'test/cheap'}]}},f.ctx).block,true);
 }
 const defaultInput={name:'other',task:'Read-only'};assert.equal(call(defaultInput,'default'),undefined);
 assert.equal(defaultInput.model,'test/parent');
 assert.equal(admit({id:'default',toolCallId:'default',input:defaultInput,model:'test/cheap'}).allowed,false,'resolved unapproved defaults fail closed');
}));
