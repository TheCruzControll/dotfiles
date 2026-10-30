import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { analyzeConversation, suggestionIdentity } from "../extension/workflow-observer/lib/analyzer.js";
import { openObserverStore } from "../extension/workflow-observer/lib/global-store.js";

const suggestion = { fingerprint: "old-a", ruleId: "handoff-timing", title: "Create handoffs earlier", summary: "Interruptions", recommendation: "Offer a handoff earlier.", evidence: [], featureRefs: [] };

test("changing evidence does not change recommendation identity", () => {
  const analyze = (text, state = {}) => analyzeConversation([
    { id: "a", role: "user", text: `handoff ${text}` },
    { id: "b", role: "assistant", text: `new session ${text}` },
  ], state, { maxMessages: 24 }, { projectPath: "/project" });
  const first = analyze("first");
  const second = analyze("second");
  assert.equal(first.length, 1);
  assert.equal(first[0].fingerprint, second[0].fingerprint);
  assert.notDeepEqual(first[0].evidence, second[0].evidence);
  assert.equal(analyze("third", { seenFingerprints: new Set([first[0].fingerprint]) }).length, 0);
});

test("store deduplicates new observations while preserving project and recommendation boundaries", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "observer-dedup-"));
  const store = openObserverStore({ storePath: path.join(dir, "db") });
  try {
    const put = (item, projectPath = "/a") => store.upsertSuggestions({ suggestions: [item], projectPath });
    put(suggestion);
    const result = put({ ...suggestion, fingerprint: "new-b", evidence: [{ quote: "new evidence" }] });
    assert.deepEqual(result.updated, ["old-a"]);
    assert.equal(store.loadState().suggestions.length, 1);
    assert.equal(store.loadState().suggestions[0].evidence[0].quote, "new evidence");
    put({ ...suggestion, fingerprint: "project-b" }, "/b");
    put({ ...suggestion, fingerprint: "different", recommendation: "A different action." });
    assert.equal(store.loadState().suggestions.length, 3);
  } finally { store.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

for (const resolution of ["markDismissed", "markWorked"]) {
  test(`legacy duplicate rows collapse and ${resolution} resolves the group`, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "observer-legacy-"));
    const storePath = path.join(dir, "db");
    const store = openObserverStore({ storePath });
    try {
      store.upsertSuggestions({ suggestions: [suggestion], projectPath: "/a" });
      // Reproduce rows created by the previous evidence-dependent fingerprint.
      const db = new DatabaseSync(storePath);
      db.exec(`INSERT INTO suggestions SELECT 'old-b', project_path, rule_id, title, summary, recommendation, payoff, tradeoff, feature_refs_json, evidence_json, status, first_seen_at, last_seen_at, last_source_session_path, occurrences, resolved_at, resolution_note FROM suggestions WHERE fingerprint = 'old-a'`);
      db.close();
      store.saveBuild({ fingerprint: "old-b", status: "launched", tabId: "t1" });
      const state = store.loadState();
      assert.equal(state.suggestions.length, 1);
      assert.equal(state.suggestions[0].fingerprint, "old-b");
      const identity = suggestionIdentity(suggestion, "/a");
      assert.ok(state.seenFingerprints.has(identity));
      store[resolution]("old-b");
      assert.equal(store.loadState().suggestions.length, 0);
      assert.ok(store.loadState().suppressedFingerprints.has(identity));
      store.upsertSuggestions({ suggestions: [{ ...suggestion, fingerprint: identity }], projectPath: "/a" });
      assert.equal(store.loadState().suggestions.length, 0);
    } finally { store.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  });
}
