import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import {
  createTestSession, integrationPrereqs, startOrchestrator, sendPrompt,
  waitForFile, waitForSteer, dumpPanes, writeAgentDef, TEST_MODEL, PI_TIMEOUT,
  type TestSession,
} from "./harness.ts";

/** A Markdown JSON fence is presentation, not part of an advisor's report. */
function parseReport(summary: string): Record<string, unknown> {
  const text = summary.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(text);
  let report: unknown;
  try {
    report = JSON.parse(fenced ? fenced[1] : text);
  } catch (error) {
    throw new Error(`Invalid council JSON summary: ${summary}`, { cause: error });
  }
  assert.ok(report && typeof report === "object" && !Array.isArray(report), "report must be a JSON object");
  return report as Record<string, unknown>;
}

it("council report parsing accepts bare/fenced JSON but rejects malformed reports", () => {
  const report = { recommendation: "Use Set" };
  assert.deepEqual(parseReport(JSON.stringify(report)), report);
  assert.deepEqual(parseReport(`\n\`\`\`json\n${JSON.stringify(report)}\n\`\`\`\n`), report);
  assert.throws(() => parseReport('{"recommendation": ["broken"}'), /Invalid council JSON summary/);
  assert.throws(() => parseReport('[]'), /report must be a JSON object/);
});

const prereqs = integrationPrereqs();
describe("bounded council mechanics", {
  skip: prereqs.ok ? false : prereqs.reason, timeout: PI_TIMEOUT * 4,
}, () => {
  let ts: TestSession;
  before(async () => {
    ts = await createTestSession();
    for (const name of ["council-a", "council-b"]) {
      writeAgentDef(ts, name, `---\nname: ${name}\nmodel: ${TEST_MODEL}\ntools: read, grep, find, ls\nspawning: false\nauto-exit: true\ninheritSkills: false\n---\nRead-only advisor. Return concise advice in subagent_done summary. Do not spawn children.`);
    }
  });
  after(async () => { await ts?.teardown(); });

  it("independent reports, curated resumed cross-exam, parent memo", async () => {
    const reportShape = {
      recommendation: "your advice", evidence: ["reason"], assumptions: ["assumption"],
      risks: ["risk"], confidence: "high/medium/low", challengeClaims: ["claim"],
      ownerDecisions: ["decision"], changeMyMind: ["condition"],
    };
    const steps = ["council-a", "council-b"].map((agent) => ({
      key: agent, agent, context: "fresh",
      task: `Advise whether to use a Set for duplicate membership checks. Call subagent_done with summary containing one valid JSON object using this shape: ${JSON.stringify(reportShape)}. Replace example values with your advice. Keep under 100 words, use simple strings, no peer consultation.`,
    }));
    const orch = await startOrchestrator(ts, {
      prompt: `Call subagent_workflow once with ${JSON.stringify({ action: "start", mode: "parallel", steps })}. Then wait. Do not initiate additional passes without a new user prompt.`,
    });
    const debug = () => dumpPanes(ts);
    const [aggregate] = await waitForSteer(orch.sessionFile, { customType: "hybrid_workflow", timeout: PI_TIMEOUT, debug });
    assert.equal(aggregate.details.status, "completed");
    const children = Object.values(aggregate.details.children) as Array<{ sessionFile: string; summary: string; kind: string }>;
    assert.equal(children.length, 2);
    assert.equal(new Set(children.map((child) => child.sessionFile)).size, 2, "independent advisor sessions");
    for (const child of children) {
      assert.equal(child.kind, "completed");
      const report = parseReport(child.summary);
      for (const key of Object.keys(reportShape)) assert.ok(key in report, key);
    }

    const requests = children.map((child, i) => ({
      sessionPath: child.sessionFile, name: `cross-${i}`,
      message: 'Curated challenge from parent: another advisor notes that Set insertion order is not sorted order. Does this alter your recommendation for membership-only checks? Call subagent_done with summary containing valid JSON with responses, recommendationChanged, outOfScopeFindings. Stay read-only; no spawning.',
    }));
    await sendPrompt(ts, orch.paneId, `Call ONLY subagent_resume once for each exact JSON request: ${JSON.stringify(requests)}. Copy the message field verbatim. Then wait. No further passes.`);
    for (let i = 0; i < 2; i++) {
      const [receipt] = await waitForSteer(orch.sessionFile, {
        customType: "subagent_result", match: (entry) => entry.details.name === `cross-${i}`, timeout: PI_TIMEOUT, debug,
      });
      assert.equal(receipt.details.disposition, "completed");
      assert.equal(receipt.details.sessionFile, children[i].sessionFile, "cross-exam must resume the original advisor session");
      const report = parseReport(receipt.details.summary);
      for (const key of ["responses", "recommendationChanged", "outOfScopeFindings"]) assert.ok(key in report, key);
    }
    const memo = join(ts.tmpDir, "council-memo.md");
    await sendPrompt(ts, orch.paneId, `The two-pass council is finished. Do not spawn or resume. Write your parent-authored final memo to ${memo} using write or bash. Include recommendation, accepted/rejected feedback, owner decisions, evidence/session paths, confidence, and roster/pass count. State two passes, with independent fresh reports and resumed curated cross-exam.`);
    await waitForFile(memo, PI_TIMEOUT, /recommendation/i, debug);
  });
});
