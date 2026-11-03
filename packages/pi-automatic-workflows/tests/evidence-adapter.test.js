import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeWorkflowEvidence, registerWorkflowEvidenceListener, summarizeFriction } from '../../pi-workflow-observer/extension/workflow-observer/lib/workflow-evidence.ts';

test('completion boundary preserves local completion and rejects pending/rejected work after restore', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-adapter-'));
  const root = path.resolve(import.meta.dirname, '..');
  const copy = path.join(temp, 'pi-automatic-workflows');
  for (const dir of ['extension', 'lib', 'workflows', 'principles']) fs.cpSync(path.join(root, dir), path.join(copy, dir), { recursive: true });
  fs.writeFileSync(path.join(copy, 'package.json'), '{"type":"module"}');
  const stub = path.join(copy, 'node_modules/typebox'); fs.mkdirSync(stub, { recursive: true });
  fs.writeFileSync(path.join(stub, 'package.json'), '{"type":"module","exports":"./index.js"}');
  fs.writeFileSync(path.join(stub, 'index.js'), 'export const Type=new Proxy({}, {get:()=> (...args)=>args[0]});');
  const old = process.env.PI_AUTOMATIC_WORKFLOWS_REVISION_STORE;
  process.env.PI_AUTOMATIC_WORKFLOWS_REVISION_STORE = path.join(temp, 'store');
  try {
    const { default: install } = await import(pathToFileURL(path.join(copy, 'extension/index.js')));
    const hooks = new Map(), tools = new Map(), entries = [], events = [], listeners = new Map(), collected = [];
    const pi = { on: (n,h) => hooks.set(n,h), registerTool: t => tools.set(t.name,t), registerCommand() {}, appendEntry: (customType,data) => entries.push({ id: `e${entries.length}`, type:'custom', customType, data: structuredClone(data) }), events: { on: (n,h) => listeners.set(n,h), emit: (n,data) => { events.push({n,data}); listeners.get(n)?.(data); } } };
    const ctx = { cwd: temp, hasUI: false, isIdle: () => true, sessionManager: { getBranch: () => entries, getSessionId: () => 'fixture' } };
    install(pi);
    registerWorkflowEvidenceListener(pi, { recordWorkflowEvidence: r => collected.push(normalizeWorkflowEvidence(r)) });
    await hooks.get('session_start')({},ctx);
    const call = (name,args) => tools.get(name).execute('test',args,null,null,ctx);
    const select = () => call('workflow_select',{route:'feature',scope:'scoped work',reason:'test'});
    await select();
    assert.ok(!(await call('workflow_update',{action:'stage',value:'completed'})).isError);
    await select();
    const unsupported = await call('workflow_update',{action:'evidence',artifact:'artifact',artifactRevision:'digest-1',requirements:['local'],proofs:[{kind:'local',ref:'claim-1'}]});
    assert.equal(unsupported.isError,true);
    assert.match(unsupported.content[0].text,/Unsupported/);
    assert.equal(entries.at(-1).data.task.completionEvidence,undefined);
    for (const state of ['working','pending-review','changes-requested','approval-needed']) {
      await call('workflow_wait',{action:'outcome',state,responseRef:`review:${state}`});
      await call('workflow_update',{action:'verification',check:'local tests',result:'passed'});
      await select(); await hooks.get('session_tree')({},ctx);
      const stage = entries.at(-1).data.task.stage;
      for (const value of ['completed','cleanup']) {
        const result = await call('workflow_update',{action:'stage',value});
        assert.equal(result.isError,true); assert.match(result.content[0].text,/not acceptance/);
        assert.equal(entries.at(-1).data.task.stage,stage);
      }
    }
    const missing = events.filter(e => e.data.eventType === 'missing_evidence');
    assert.equal(summarizeFriction(collected).counts.missing_evidence,4);
    assert.equal(missing.at(-1).data.eventId,missing.at(-2).data.eventId);
    assert.ok(missing.every(e => /^[a-f0-9]{64}$/.test(e.data.evidenceRefs[0])));
    assert.ok(!JSON.stringify(missing).includes('review:'));
    // Approval remains owner-gated; accepted transitions are covered after UI approval in wait-adapter.
    hooks.get('session_shutdown')({},ctx);
  } finally { if (old === undefined) delete process.env.PI_AUTOMATIC_WORKFLOWS_REVISION_STORE; else process.env.PI_AUTOMATIC_WORKFLOWS_REVISION_STORE = old; }
});
