import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { REQUIRED_BEHAVIORAL_SCENARIOS } from '../../lib/acceptance.js';
import { recordBehavioralAcceptance } from '../../lib/revisions.js';

// Synthetic unit-test evidence only. Never use as release/pilot acceptance.
export function behavioralFixture(receipt) {
  const content='Synthetic behavioral trace for gate unit tests; no model or live pilot was run.';
  const metrics={missedSteps:0,routeErrors:0,boundaryViolations:0,unwantedActivations:0,corrections:0,latencyMs:100,tokens:100};
  return {
    schemaVersion:1,candidateId:receipt.candidateId,candidateDigest:receipt.verifiedDigest,baseRevision:receipt.baseRevision,
    evaluator:{kind:'trusted-behavior-runner',name:'synthetic-unit-runner',model:'test/fixture'},
    artifacts:[{id:'synthetic',content,sha256:crypto.createHash('sha256').update(content).digest('hex')}],
    scenarios:REQUIRED_BEHAVIORAL_SCENARIOS.map(id=>({id,passed:true,rationale:'Synthetic passing fixture, not live acceptance.',evidence:['synthetic']})),
    independentReview:{passed:true,reviewer:'synthetic-reviewer',evidence:['synthetic']},
    overheadTargets:{source:'paired-baseline-study',rationale:'Synthetic test-only limits, not production targets.',latencyRatio:1.5,tokenRatio:1.5,evidence:['synthetic']},
    pilot:['node','python'].map(kind=>({project:`synthetic-${kind}`,kind,model:'test/fixture',off:{...metrics},on:{...metrics},evidence:['synthetic']})),
  };
}
export function acceptFixture(candidateId,storeRoot) {
  const receipt=JSON.parse(fs.readFileSync(path.join(storeRoot,'receipts',`${candidateId}.json`),'utf8'));
  return recordBehavioralAcceptance({candidateId,storeRoot,report:behavioralFixture(receipt)});
}
