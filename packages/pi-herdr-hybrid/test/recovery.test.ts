import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureRecovery, recoverOwnedChildren, socketIdentity } from '../src/recovery.ts';

const running = { id: 'child-1', name: 'worker', agent: undefined, task: 'inspect', paneId: 'w1:p7', startTime: 123, sessionFile: '/tmp/child.jsonl', launchScriptFile: '/tmp/child.sh', interactive: false, autoExit: true, resumeEntryCount: 4 };
const context = { ownerSessionFile: '/tmp/parent.jsonl', socketPath: '/tmp/herdr.sock', socketIdentity: 'same-server' };
const descriptor = { version: 1, ...context, running };
const record = (status = 'started', extra: any = {}) => ({ type: 'custom', customType: 'workflow:child-lifecycle', data: { version: 1, id: running.id, name: running.name, paneId: running.paneId, sessionFile: running.sessionFile, status, ...extra } });
const start = () => record('started', { recovery: descriptor });

test('replays unresolved ownership and preserves resume transcript cursor without reviving terminal runs', () => {
  assert.deepEqual(recoverOwnedChildren([start(),record('unresolved')], context), { children: [running], unresolved: [], placementPaneIds: [running.paneId] });
  for (const terminal of ['completed','failed']) {
    assert.deepEqual(recoverOwnedChildren([start(),record(terminal),start()], context), {children:[],unresolved:[],placementPaneIds:[running.paneId]});
    assert.deepEqual(recoverOwnedChildren([start(),record(terminal)], {...context, socketIdentity:'restarted'}).placementPaneIds, []);
  }
});
test('fails closed on another parent, daemon replacement, missing descriptor, malformed runtime and conflicting child identity', () => {
  for (const patch of [{ownerSessionFile:'/tmp/other.jsonl'},{socketPath:'/tmp/other.sock'},{socketIdentity:'restarted'},{socketIdentity:undefined}]) {
    assert.deepEqual(recoverOwnedChildren([start()], {...context,...patch}).unresolved,[running.id]);
  }
  assert.deepEqual(recoverOwnedChildren([record()],context).unresolved,[running.id]);
  for (const patch of [{paneId:'wrong'},{sessionFile:'/tmp/other.jsonl'},{launchScriptFile:'relative'},{task:{}},{autoExit:undefined},{resumeEntryCount:-1},{startTime:NaN}]) {
    const malformed=record('started',{recovery:{...descriptor,running:{...running,...patch}}});
    assert.deepEqual(recoverOwnedChildren([malformed],context).unresolved,[running.id]);
  }
  assert.deepEqual(recoverOwnedChildren([start(),record('completed',{sessionFile:'/tmp/other.jsonl'})],context).children,[running]);
});
test('unknown versions and unrelated entries do not adopt children; extra saved object state is discarded', () => {
  assert.deepEqual(recoverOwnedChildren([{...start(),data:{...start().data,version:2}}],context),{children:[],unresolved:[],placementPaneIds:[]});
  const polluted=record('started',{recovery:{...descriptor,running:{...running,abortController:{},unexpected:'discard'}}});
  assert.deepEqual(recoverOwnedChildren([polluted],context).children,[running]);
});
test('captures real socket identity without launching agents; ordinary files cannot act as daemon identity', async () => {
  const dir=mkdtempSync(join(tmpdir(),'herdr-recovery-'));
  const socketPath=join(dir,'server.sock'), ownerSessionFile=join(dir,'parent.jsonl');
  const server=createServer();
  try {
    await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,resolve);});
    const d=captureRecovery(running,ownerSessionFile,socketPath)!;
    assert.equal(typeof d.socketIdentity,'string');
    assert.deepEqual(d.running,running);
    assert.deepEqual(recoverOwnedChildren([record('started',{recovery:d})],{ownerSessionFile,socketPath,socketIdentity:socketIdentity(socketPath)}).children,[running]);
    writeFileSync(ownerSessionFile,'');
    assert.equal(socketIdentity(ownerSessionFile),undefined);
    assert.equal(captureRecovery(running,undefined,socketPath),undefined);
    assert.equal(socketIdentity(join(dir,'missing')),undefined);
  } finally {
    if(server.listening) await new Promise<void>(resolve=>server.close(()=>resolve()));
    rmSync(dir,{recursive:true,force:true});
  }
});
