import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beginCandidate, validateCandidate, activateCandidate, loadActiveRevision, recoverPromotionLock, findBuildingCandidate, completeCandidateBuild, loadPinnedRevision, candidateEvaluationContext } from '../lib/revisions.js';
import { WORKFLOW_FILES, PRINCIPLE_NAMES } from '../lib/registry.js';
import { acceptFixture } from './helpers/behavioral-fixture.js';
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function fixture(fn) {
 const storeRoot=fs.mkdtempSync(path.join(os.tmpdir(),'revision-integrity-'));
 const create=()=>beginCandidate({sourceProjectPath:packageRoot,packageRoot,storeRoot});
 // Successful integrity fixtures attach synthetic behavioral evidence, never release evidence.
 const verify=(c)=>{ const result=validateCandidate({candidateId:c.candidateId,packageRoot,storeRoot,workflowFiles:Object.values(WORKFLOW_FILES),principleNames:PRINCIPLE_NAMES}); if(result.passed) acceptFixture(c.candidateId,storeRoot); return result; };
 const change=(c)=>fs.appendFileSync(path.join(c.candidateRoot,'workflows','plan.md'),'\nAdditional scoped planning note.\n');
 const activate=(c)=>activateCandidate({candidateId:c.candidateId,packageRoot,storeRoot});
 try {fn({storeRoot,create,verify,change,activate});} finally {fs.rmSync(storeRoot,{recursive:true,force:true});}
}
test('explicit build completion gates evaluation eligibility and permits failed-candidate retry',()=>fixture(({storeRoot,create,verify})=>{const c=create();assert.equal(findBuildingCandidate(c.candidateRoot,{storeRoot,completedOnly:true}),undefined);assert.throws(()=>completeCandidateBuild(c.candidateRoot,{storeRoot}),/identity/);candidateEvaluationContext({candidateId:c.candidateId,storeRoot,coordinatorSessionId:'fixture-owner',bindCoordinator:true});completeCandidateBuild(c.candidateRoot,{storeRoot,coordinatorSessionId:'fixture-owner'});assert.equal(findBuildingCandidate(c.candidateRoot,{storeRoot,completedOnly:true}),c.candidateId);assert.equal(verify(c).passed,false);completeCandidateBuild(c.candidateRoot,{storeRoot,coordinatorSessionId:'fixture-owner'});assert.equal(findBuildingCandidate(c.candidateRoot,{storeRoot,completedOnly:true}),c.candidateId);}));
test('live promotion locks cannot be recovered',()=>fixture(({storeRoot})=>{fs.mkdirSync(path.join(storeRoot,'promotion.lock'));fs.writeFileSync(path.join(storeRoot,'promotion.lock','owner.json'),JSON.stringify({pid:process.pid,hostname:os.hostname()}));assert.throws(()=>recoverPromotionLock({storeRoot}),/still running/);}));
test('dead-owner promotion locks are archived, not deleted',()=>fixture(({storeRoot})=>{fs.mkdirSync(path.join(storeRoot,'promotion.lock'));fs.writeFileSync(path.join(storeRoot,'promotion.lock','owner.json'),JSON.stringify({pid:2147483647,hostname:os.hostname()}));const result=recoverPromotionLock({storeRoot});assert.ok(fs.existsSync(result.archived));assert.ok(!fs.existsSync(path.join(storeRoot,'promotion.lock')));}));
test('activation is idempotent after successful pointer publication',()=>fixture(({create,verify,change,activate})=>{const c=create();change(c);verify(c);const first=activate(c);assert.deepEqual(activate(c),first);}));
test('no-op candidates do not activate',()=>fixture(({create,verify,activate})=>{const c=create();assert.equal(verify(c).passed,false);assert.throws(()=>activate(c));}));
test('candidate edits after passing checks are rejected',()=>fixture(({create,verify,change,activate})=>{const c=create();change(c);assert.equal(verify(c).passed,true);change(c);assert.throws(()=>activate(c),/changed after verification/);}));
test('concurrent stale candidates cannot overwrite a newer revision',()=>fixture(({create,verify,change,activate})=>{const a=create(),b=create();change(a);change(b);verify(a);verify(b);activate(a);assert.throws(()=>activate(b),/changed since candidate approval/);}));
test('pinned tasks validate retained content even after another revision activates',()=>fixture(({storeRoot,create,verify,change,activate})=>{const a=create();change(a);verify(a);activate(a);const b=create();change(b);verify(b);activate(b);const pinned={revisionId:a.candidateId,resourceRoot:path.join(a.candidateRoot,'workflows'),packageRoot,storeRoot};assert.equal(loadPinnedRevision(pinned).revisionId,a.candidateId);change(a);assert.throws(()=>loadPinnedRevision(pinned),/changed after verification/);assert.equal(loadActiveRevision({packageRoot,storeRoot}).revisionId,b.candidateId);}));
test('replacing an activated candidate directory with a symlink fails closed',()=>fixture(({storeRoot,create,verify,change,activate})=>{const c=create();change(c);verify(c);activate(c);const retained=`${c.candidateRoot}.retained`;fs.renameSync(c.candidateRoot,retained);fs.symlinkSync(retained,c.candidateRoot,'dir');assert.throws(()=>loadActiveRevision({packageRoot,storeRoot}),/resource path is invalid/);}));
test('active resource tampering fails closed',()=>fixture(({storeRoot,create,verify,change,activate})=>{const c=create();change(c);verify(c);activate(c);change(c);assert.throws(()=>loadActiveRevision({packageRoot,storeRoot}),/changed after verification/);}));
