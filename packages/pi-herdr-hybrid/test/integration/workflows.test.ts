import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { createTestSession, integrationPrereqs, startOrchestrator, waitForFile, waitForSteer, dumpPanes, PI_TIMEOUT, type TestSession } from './harness.ts';
const prereqs=integrationPrereqs();
describe('hybrid workflows through real Herdr panes',{skip:prereqs.ok?false:prereqs.reason,timeout:PI_TIMEOUT*4},()=>{
  let ts: TestSession;
  before(async()=>{ts=await createTestSession();}); after(async()=>{await ts?.teardown();});
  for(const mode of ['parallel','chain']) it(`${mode} produces explicit aggregate completion`,async()=>{
    const first=join(ts.tmpDir,`${mode}-first.txt`), second=join(ts.tmpDir,`${mode}-second.txt`);
    const steps=[{key:`${mode}-one`,agent:'test-echo',task:`Use bash to write FIRST to ${first}. Then call subagent_done with summary FIRST_OK.`},{key:`${mode}-two`,agent:'test-echo',task:`${mode==='chain'?`Read ${first} and verify FIRST, then `:''}Use bash to write SECOND to ${second}. Then call subagent_done with summary SECOND_OK.`}];
    const orch=await startOrchestrator(ts,{prompt:`Call subagent_workflow exactly once with ${JSON.stringify({action:'start',mode,steps})}. Do nothing else; end your turn and await results. Do not spawn other children or workflows.`});
    const debug=()=>dumpPanes(ts);
    await waitForFile(second,PI_TIMEOUT,/SECOND/,debug);
    const [receipt]=await waitForSteer(orch.sessionFile,{customType:'hybrid_workflow',timeout:PI_TIMEOUT,debug});
    assert.equal(receipt.details.status,'completed',JSON.stringify(receipt));
    assert.equal(Object.keys(receipt.details.children).length,2);
    assert.match(readFileSync(first,'utf8'),/FIRST/);
  });
});
