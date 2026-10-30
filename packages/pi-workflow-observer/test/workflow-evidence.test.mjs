import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { openObserverStore } from "../extension/workflow-observer/lib/global-store.js";
import { resolveBuildProjectPath } from "../extension/workflow-observer/lib/herdr.js";
import {
  normalizeWorkflowEvidence,
  registerWorkflowEvidenceListener,
  WORKFLOW_EVIDENCE_SCHEMA_VERSION,
} from "../extension/workflow-observer/lib/workflow-evidence.js";

function makeRecord(projectPath, extra = {}) {
  return {
    eventId: "evt-1",
    schemaVersion: WORKFLOW_EVIDENCE_SCHEMA_VERSION,
    projectPath,
    sessionAnchor: "session-abc",
    taskId: "task-123",
    workflowRevision: "rev-1",
    timestamp: "2026-02-03T04:05:06.000Z",
    eventType: "verification",
    evidenceRefs: ["tool-result-1", "message-2"],
    ...extra,
  };
}

test("workflow evidence is versioned, bounded, and stores only opaque evidence references", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "observer-evidence-"));
  const projectPath = path.join(root, "project");
  fs.mkdirSync(projectPath);
  try {
    assert.deepEqual(normalizeWorkflowEvidence(makeRecord(projectPath)), {
      eventId: "evt-1",
      schemaVersion: 1,
      projectPath: fs.realpathSync(projectPath),
      sessionAnchor: "session-abc",
      taskId: "task-123",
      workflowRevision: "rev-1",
      timestamp: "2026-02-03T04:05:06.000Z",
      eventType: "verification",
      evidenceRefs: ["tool-result-1", "message-2"],
    });
    assert.throws(() => normalizeWorkflowEvidence(makeRecord(projectPath, { schemaVersion: 2 })), /schema version/);
    assert.throws(() => normalizeWorkflowEvidence(makeRecord(projectPath, { eventType: "unknown" })), /event type/);
    assert.throws(() => normalizeWorkflowEvidence(makeRecord(projectPath, { timestamp: "2026-02-31T04:05:06.000Z" })), /timestamp/);
    assert.throws(() => normalizeWorkflowEvidence(makeRecord(projectPath, { evidenceRefs: Array(17).fill("ref") })), /at most 16/);
    assert.throws(() => normalizeWorkflowEvidence(makeRecord(projectPath, { evidenceRefs: ["secret text with spaces"] })), /evidence reference/);
    assert.throws(() => normalizeWorkflowEvidence(makeRecord(projectPath, { transcript: "must not be stored" })), /Unsupported workflow evidence field/);
    assert.throws(() => normalizeWorkflowEvidence(makeRecord(path.join(root, "missing"))), /does not exist/);
    assert.throws(() => normalizeWorkflowEvidence(makeRecord("relative-project")), /absolute project path/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("global store durably records deduplicated evidence without changing legacy suggestion state", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "observer-evidence-store-"));
  const projectPath = path.join(root, "project");
  fs.mkdirSync(projectPath);
  const storePath = path.join(root, "observer.sqlite");
  let store = openObserverStore({ storePath });
  try {
    const record = makeRecord(projectPath);
    assert.equal(store.recordWorkflowEvidence(record), true);
    assert.equal(store.recordWorkflowEvidence({ ...record, evidenceRefs: ["different-ref"] }), false);
    assert.deepEqual(store.listWorkflowEvidence(), [normalizeWorkflowEvidence(record)]);
    store.close();
    store = openObserverStore({ storePath });
    assert.deepEqual(store.listWorkflowEvidence(), [normalizeWorkflowEvidence(record)]);
    assert.deepEqual(store.loadState().suggestions, []);
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("opening a legacy store adds evidence storage without losing existing suggestions", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "observer-legacy-evidence-"));
  const projectPath = path.join(root, "project");
  fs.mkdirSync(projectPath);
  const storePath = path.join(root, "observer.sqlite");
  let store = openObserverStore({ storePath });
  try {
    store.upsertSuggestions({
      suggestions: [{
        fingerprint: "legacy-suggestion",
        ruleId: "scope-boundary",
        title: "Keep scope local",
        summary: "A legacy observer item.",
        recommendation: "Keep work in this project.",
        featureRefs: [],
        evidence: [],
      }],
      projectPath,
    });
    store.close();
    const legacyDb = new DatabaseSync(storePath);
    legacyDb.exec("DROP TABLE workflow_evidence");
    legacyDb.close();

    store = openObserverStore({ storePath });
    assert.equal(store.loadState().suggestions[0]?.fingerprint, "legacy-suggestion");
    assert.equal(store.recordWorkflowEvidence(makeRecord(projectPath)), true);
    assert.equal(store.listWorkflowEvidence().length, 1);
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("workflow evidence event listener uses the event bus and isolates storage faults", () => {
  const listeners = new Map();
  const pi = { events: { on: (eventName, handler) => listeners.set(eventName, handler) } };
  const received = [];
  registerWorkflowEvidenceListener(pi, { recordWorkflowEvidence: (record) => received.push(record) });
  assert.deepEqual([...listeners.keys()], ["workflow:evidence"]);
  assert.doesNotThrow(() => listeners.get("workflow:evidence")({ secret: "ignored by the broken record" }));
  assert.deepEqual(received, [{ secret: "ignored by the broken record" }]);

  registerWorkflowEvidenceListener(pi, { recordWorkflowEvidence: () => { throw new Error("database unavailable"); } });
  assert.doesNotThrow(() => listeners.get("workflow:evidence")(makeRecord("/tmp/project")));
});

test("build cwd comes from the recorded source project, and invalid identity is rejected", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "observer-build-target-"));
  const sourceProject = path.join(root, "source project");
  const panelProject = path.join(root, "panel project");
  fs.mkdirSync(sourceProject);
  fs.mkdirSync(panelProject);
  try {
    const sourceAlias = path.join(root, "source-alias");
    fs.symlinkSync(sourceProject, sourceAlias, "dir");
    const recordedProject = resolveBuildProjectPath(sourceAlias);
    assert.equal(recordedProject, fs.realpathSync(sourceProject));
    fs.unlinkSync(sourceAlias);
    fs.symlinkSync(panelProject, sourceAlias, "dir");
    assert.equal(resolveBuildProjectPath(recordedProject), fs.realpathSync(sourceProject));
    assert.notEqual(resolveBuildProjectPath(sourceAlias), recordedProject);
    assert.throws(() => resolveBuildProjectPath(undefined), /absolute project path/);
    assert.throws(() => resolveBuildProjectPath(path.join(root, "missing")), /does not exist/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
