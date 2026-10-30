import test from 'node:test';
import assert from 'node:assert/strict';
import {requestChildAdmission,CHILD_ADMISSION} from '../src/admission.ts';
const plan={id:'native-id',sessionFile:'/tmp/child.jsonl',paneStart:{cwd:'/tmp/isolated'},piArgv:['pi','--model','test/parent']};
const parent={cwd:'/tmp/project',model:{provider:'test',id:'parent'},sessionManager:{getSessionFile:()=>'/tmp/parent.jsonl'}};
test('native admission remains optional without a controller but fails closed on negative or incomplete decisions',()=>{
  assert.equal(requestChildAdmission({events:{emit(){}}},plan,parent,{},'spawn','child'),undefined);
  for(const approve of [false,undefined]){
    const pi={events:{emit(type:string,r:any){assert.equal(type,CHILD_ADMISSION);r.handled=true;r.allowed=approve;r.reason='denied';}}};
    assert.equal(requestChildAdmission(pi,plan,parent,{},'spawn','child'),'denied');
  }
  assert.match(requestChildAdmission({events:{emit(){throw Error('bus fault');}}},plan,parent,{},'spawn','child')!,/admission failed/);
});
test('native admission exposes effective saved model/cwd, runtime identity and exact tool call for reservation binding',()=>{
  const pi={events:{emit(_type:string,r:any){
    assert.equal(r.id,'native-id');assert.equal(r.model,'test/parent');assert.equal(r.parentModel,'test/parent');
    assert.equal(r.cwd,'/tmp/isolated');assert.equal(r.kind,'resume');assert.equal(r.toolCallId,'resume-call');
    r.handled=true;r.allowed=true;
  }}};
  assert.equal(requestChildAdmission(pi,plan,parent,{sessionPath:'/tmp/child.jsonl'},'resume','child','resume-call'),undefined);
});
