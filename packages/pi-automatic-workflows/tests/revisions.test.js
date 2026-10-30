import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRINCIPLE_NAMES, WORKFLOWS, WORKFLOW_FILES } from "../lib/registry.js";
import { activateCandidate, beginCandidate, loadActiveRevision, rollbackRevision, validateCandidate } from "../lib/revisions.js";
import { acceptFixture } from './helpers/behavioral-fixture.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function candidate(storeRoot) {
  return beginCandidate({
    sourceProjectPath: packageRoot,
    fingerprint: "test-fingerprint",
    title: "Test workflow candidate",
    summary: "candidate summary",
    recommendation: "candidate recommendation",
    packageRoot,
    storeRoot,
  });
}

function changeCandidate(candidateInfo) {
  fs.appendFileSync(path.join(candidateInfo.candidateRoot, "workflows", "plan.md"), "\nAdditional candidate planning note.\n");
}

function validate(candidateInfo, storeRoot) {
  return validateCandidate({
    candidateId: candidateInfo.candidateId,
    storeRoot,
    workflowFiles: Object.values(WORKFLOW_FILES),
    principleNames: PRINCIPLE_NAMES,
  });
}

test("candidate check failures never activate and cannot bypass the verification gate", () => {
  const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-revision-fail-"));
  try {
    const item = candidate(storeRoot);
    fs.writeFileSync(path.join(item.candidateRoot, "workflows", "plan.md"), "Plan text without a termination instruction.");
    const result = validate(item, storeRoot);
    assert.equal(result.passed, false);
    assert.throws(() => activateCandidate({ candidateId: item.candidateId, packageRoot, storeRoot }), /checks have not all passed/);
    assert.equal(loadActiveRevision({ packageRoot, storeRoot }).revisionId, "0.1.0");
  } finally {
    fs.rmSync(storeRoot, { recursive: true, force: true });
  }
});

test("verified candidates activate atomically for new tasks and rollback to retained revisions", () => {
  const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-revision-pass-"));
  try {
    const first = candidate(storeRoot);
    changeCandidate(first);
    assert.equal(validate(first, storeRoot).passed, true);
    acceptFixture(first.candidateId, storeRoot); // Synthetic gate fixture, not release acceptance.
    activateCandidate({ candidateId: first.candidateId, packageRoot, storeRoot });
    assert.equal(loadActiveRevision({ packageRoot, storeRoot }).revisionId, first.candidateId);

    const second = candidate(storeRoot);
    changeCandidate(second);
    assert.equal(validate(second, storeRoot).passed, true);
    acceptFixture(second.candidateId, storeRoot);
    activateCandidate({ candidateId: second.candidateId, packageRoot, storeRoot });
    assert.equal(loadActiveRevision({ packageRoot, storeRoot }).revisionId, second.candidateId);
    assert.equal(rollbackRevision({ packageRoot, storeRoot }).revisionId, first.candidateId);
    assert.equal(loadActiveRevision({ packageRoot, storeRoot }).revisionId, first.candidateId);
    assert.equal(rollbackRevision({ packageRoot, storeRoot }).revisionId, "0.1.0");
    assert.equal(loadActiveRevision({ packageRoot, storeRoot }).revisionId, "0.1.0");
    assert.equal(rollbackRevision({ packageRoot, storeRoot }).rolledBack, false);
  } finally {
    fs.rmSync(storeRoot, { recursive: true, force: true });
  }
});

test("candidate traversal and symbolic links are rejected", () => {
  const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-revision-link-"));
  try {
    const item = candidate(storeRoot);
    const planPath = path.join(item.candidateRoot, "workflows", "plan.md");
    fs.unlinkSync(planPath);
    fs.symlinkSync(path.join(packageRoot, "workflows", "plan.md"), planPath);
    assert.equal(validate(item, storeRoot).passed, false);
    assert.throws(() => beginCandidate({ sourceProjectPath: "relative", packageRoot, storeRoot }), /absolute recorded source project/);
  } finally {
    fs.rmSync(storeRoot, { recursive: true, force: true });
  }
});
