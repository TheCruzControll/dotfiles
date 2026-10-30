import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateBehavioralReport, behavioralReportTemplate } from '../lib/acceptance.js';
import { beginCandidate, validateCandidate, recordBehavioralAcceptance, activateCandidate, loadActiveRevision } from '../lib/revisions.js';
import { WORKFLOW_FILES, PRINCIPLE_NAMES } from '../lib/registry.js';
import { behavioralFixture } from './helpers/behavioral-fixture.js';
const packageRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const receipt={candidateId:'candidate',verifiedDigest:'digest',baseRevision:'0.1.0'};

test('evaluation template is complete but never counts as passing evidence',()=>{
  const template=behavioralReportTemplate({candidateId:receipt.candidateId,candidateDigest:receipt.verifiedDigest,baseRevision:receipt.baseRevision});
  assert.equal(template.scenarios.length,18);
  assert.equal(template.pilot.length,2);
  assert.ok(template.scenarios.every(scenario=>scenario.passed===null));
  assert.throws(()=>validateBehavioralReport(template,receipt),/Behavioral acceptance refused/);
});

test('behavioral gate validates complete digest-bound report, not workflow keywords',()=>{
  assert.equal(validateBehavioralReport(behavioralFixture(receipt),receipt).passed,true);
  const mutations=[
    r=>{r.candidateDigest='stale';},r=>{r.baseRevision='stale';},r=>{r.scenarios.pop();},
    r=>{r.scenarios[0].passed=false;},r=>{r.scenarios[0].evidence=['missing'];},
    r=>{r.scenarios[0].id=r.scenarios[1].id;},r=>{r.artifacts[0].content+='tampered';},
    r=>{r.evaluator.kind='candidate-self-assertion';},r=>{r.independentReview.reviewer=r.evaluator.name;},
    r=>{r.pilot.pop();},r=>{r.pilot[1].project=r.pilot[0].project;},r=>{r.pilot[1].kind=r.pilot[0].kind;},
    r=>{r.pilot[0].model='different/model';},r=>{r.pilot[0].on.boundaryViolations=1;},
    r=>{r.pilot[0].on.missedSteps=1;},r=>{r.pilot[0].on.tokens=151;},
    r=>{r.pilot[0].on.latencyMs=151;},r=>{r.pilot[0].off.tokens=0;},
    r=>{r.overheadTargets.source='invented-default';},r=>{delete r.overheadTargets;},
  ];
  for(const mutate of mutations){const report=behavioralFixture(receipt);mutate(report);assert.throws(()=>validateBehavioralReport(report,receipt),/Behavioral acceptance refused/);}
});

test('structural checks alone never activate; evidence tampering fails closed after activation',()=>{
  const storeRoot=fs.mkdtempSync(path.join(os.tmpdir(),'workflow-behavior-gate-'));
  try {
    const c=beginCandidate({sourceProjectPath:packageRoot,packageRoot,storeRoot});
    fs.appendFileSync(path.join(c.candidateRoot,'workflows/plan.md'),'\nScoped fixture note.\n');
    const opts={candidateId:c.candidateId,packageRoot,storeRoot};
    const result=validateCandidate({...opts,workflowFiles:Object.values(WORKFLOW_FILES),principleNames:PRINCIPLE_NAMES});
    assert.equal(result.passed,true);
    assert.throws(()=>activateCandidate(opts),/Behavioral evaluation and multi-project pilot evidence required/);
    assert.equal(loadActiveRevision(opts).revisionId,'0.1.0');
    recordBehavioralAcceptance({...opts,report:behavioralFixture(result.receipt)});
    activateCandidate(opts);
    const filename=path.join(storeRoot,'receipts',`${c.candidateId}.acceptance.json`);
    const report=JSON.parse(fs.readFileSync(filename,'utf8'));
    report.scenarios[0].rationale='Changed after acceptance but still superficially valid.';
    fs.writeFileSync(filename,JSON.stringify(report));
    assert.throws(()=>loadActiveRevision(opts),/evidence changed/);
  } finally {fs.rmSync(storeRoot,{recursive:true,force:true});}
});

test('rechecking candidate content invalidates earlier behavioral acceptance',()=>{
  const storeRoot=fs.mkdtempSync(path.join(os.tmpdir(),'workflow-behavior-recheck-'));
  try {
    const c=beginCandidate({sourceProjectPath:packageRoot,packageRoot,storeRoot});
    const opts={candidateId:c.candidateId,packageRoot,storeRoot};
    const verify=()=>validateCandidate({...opts,workflowFiles:Object.values(WORKFLOW_FILES),principleNames:PRINCIPLE_NAMES});
    fs.appendFileSync(path.join(c.candidateRoot,'workflows/plan.md'),'\nScoped fixture note.\n');
    const result=verify();
    recordBehavioralAcceptance({...opts,report:behavioralFixture(result.receipt)});
    const filename=path.join(storeRoot,'receipts',`${c.candidateId}.json`);
    const r=JSON.parse(fs.readFileSync(filename,'utf8'));r.status='building';fs.writeFileSync(filename,JSON.stringify(r));
    assert.equal(verify().passed,true);
    assert.throws(()=>activateCandidate(opts),/Behavioral evaluation and multi-project pilot evidence required/);
  } finally {fs.rmSync(storeRoot,{recursive:true,force:true});}
});
