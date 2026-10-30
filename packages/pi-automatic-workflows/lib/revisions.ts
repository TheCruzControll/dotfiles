import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateBehavioralReport, acceptanceDigest, REQUIRED_BEHAVIORAL_SCENARIOS, behavioralReportTemplate } from './acceptance.ts';

const DEFAULT_PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const REVISION_STORE = path.join(os.homedir(), ".pi", "agent", "workflow-revisions");
export const DEFAULT_REVISION_ID = "0.1.0";

function within(root, target) {
  const rel = path.relative(root, target);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

function atomicJson(filename, value) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  fs.renameSync(temporary, filename);
}

function readJson(filename) {
  try { return JSON.parse(fs.readFileSync(filename, "utf8")); }
  catch { return undefined; }
}

function treeDigest(files, root) {
  const hash = crypto.createHash("sha256");
  for (const filename of files.map((item) => path.relative(root, item)).sort()) {
    const content = fs.readFileSync(path.join(root, filename));
    hash.update(JSON.stringify([filename, content.length]));
    hash.update(content);
  }
  return hash.digest("hex");
}

function walkNoSymlinks(root) {
  const files = [];
  const visit = (dir) => {
    if (fs.lstatSync(dir).isSymbolicLink()) throw new Error(`Symbolic link directory refused: ${dir}`);
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Candidate contains a symbolic link: ${full}`);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) files.push(full);
      else throw new Error(`Candidate contains a non-regular entry: ${full}`);
    }
  };
  visit(root);
  return files;
}

export function beginCandidate({ sourceProjectPath, fingerprint, title, summary, recommendation, packageRoot, storeRoot = REVISION_STORE }) {
  if (!path.isAbsolute(sourceProjectPath)) throw new Error("Candidate approval requires an absolute recorded source project.");
  sourceProjectPath = fs.realpathSync(sourceProjectPath);
  if (!fs.statSync(sourceProjectPath).isDirectory()) throw new Error("Candidate source project is not a directory.");
  fs.mkdirSync(storeRoot, { recursive: true });
  storeRoot = fs.realpathSync(storeRoot);
  const id = crypto.randomUUID();
  const candidateRoot = path.join(storeRoot, "candidates", id, "content");
  fs.mkdirSync(candidateRoot, { recursive: true });
  const activeRevision = loadActiveRevision({ packageRoot, storeRoot });
  const activeContent = path.dirname(activeRevision.resourceRoot);
  fs.cpSync(path.join(activeContent, "workflows"), path.join(candidateRoot, "workflows"), { recursive: true, errorOnExist: true, force: false });
  fs.cpSync(path.join(activeContent, "principles"), path.join(candidateRoot, "principles"), { recursive: true, errorOnExist: true, force: false });
  const baselineFiles = [...walkNoSymlinks(path.join(candidateRoot, "workflows")), ...walkNoSymlinks(path.join(candidateRoot, "principles"))];
  const baselineDigest = treeDigest(baselineFiles, candidateRoot);
  const receipt = {
    baseRevision: activeRevision.revisionId,
    schemaVersion: 1,
    candidateId: id,
    status: "building",
    approvedAt: new Date().toISOString(),
    approvalSource: "observer-ui-build-action",
    sourceProjectPath: path.resolve(sourceProjectPath),
    fingerprint: String(fingerprint ?? "").slice(0, 160),
    title: String(title ?? "").slice(0, 300),
    summary: String(summary ?? "").slice(0, 2000),
    recommendation: String(recommendation ?? "").slice(0, 4000),
    candidateRoot,
    baselineDigest,
    baseline: Object.fromEntries(baselineFiles.map((filename) => [path.relative(candidateRoot, filename), fs.readFileSync(filename, "utf8")])),
  };
  atomicJson(path.join(storeRoot, "receipts", `${id}.json`), receipt);
  return { candidateId: id, candidateRoot };
}

export function completeCandidateBuild(candidateRoot, { storeRoot = REVISION_STORE, coordinatorSessionId } = {}) {
  return withPromotionLock(storeRoot, () => {
    const candidateId = findBuildingCandidate(candidateRoot, { storeRoot, statuses: ["building", "failed", "verified"] });
    if (!candidateId) throw new Error("No approved building candidate in this directory.");
    const filename = path.join(storeRoot, "receipts", `${candidateId}.json`);
    const receipt = readJson(filename);
    assertCandidateCoordinator(receipt, coordinatorSessionId);
    receipt.status = "building";
    receipt.buildCompletedAt = new Date().toISOString();
    atomicJson(filename, receipt);
    return candidateId;
  });
}

function assertCandidateCoordinator(receipt, coordinatorSessionId) {
  if (typeof coordinatorSessionId !== 'string' || !coordinatorSessionId.trim() || coordinatorSessionId === 'unknown' || receipt?.coordinatorSessionId !== coordinatorSessionId) throw new Error('Candidate coordinator session identity is missing or mismatched.');
}

export function findBuildingCandidate(candidateRoot, { storeRoot = REVISION_STORE, completedOnly = false, statuses = ["building"] } = {}) {
  const target = path.resolve(candidateRoot);
  const receiptsRoot = path.join(storeRoot, "receipts");
  if (!fs.existsSync(receiptsRoot)) return undefined;
  for (const filename of fs.readdirSync(receiptsRoot).filter((name) => name.endsWith(".json"))) {
    const receipt = readJson(path.join(receiptsRoot, filename));
    if (statuses.includes(receipt?.status) && (!completedOnly || receipt.buildCompletedAt) && path.resolve(receipt.candidateRoot ?? "") === target) return receipt.candidateId;
  }
  return undefined;
}

export function validateCandidate({ candidateId, packageRoot = DEFAULT_PACKAGE_ROOT, storeRoot = REVISION_STORE, workflowFiles, principleNames }) {
  if (!/^[0-9a-f-]{36}$/i.test(candidateId)) throw new Error("Invalid candidate ID.");
  const receiptPath = path.join(storeRoot, "receipts", `${candidateId}.json`);
  const receipt = readJson(receiptPath);
  if (!receipt || receipt.schemaVersion !== 1 || receipt.candidateId !== candidateId || receipt.approvalSource !== "observer-ui-build-action") throw new Error("No matching user-approved candidate receipt.");
  if (receipt.status !== "building") throw new Error(`Candidate is not awaiting evaluation: ${receipt.status}`);
  const candidatesRoot = fs.realpathSync(path.join(storeRoot, "candidates"));
  const candidateRoot = path.resolve(receipt.candidateRoot);
  const candidateStat = fs.lstatSync(candidateRoot);
  if (candidateRoot !== path.resolve(candidatesRoot, candidateId, "content") || fs.realpathSync(candidateRoot) !== candidateRoot || !within(candidatesRoot, candidateRoot) || !candidateStat.isDirectory() || candidateStat.isSymbolicLink()) throw new Error("Candidate content path is outside the managed candidate store.");
  const workflowRoot = path.join(candidateRoot, "workflows");
  const principleRoot = path.join(candidateRoot, "principles");
  const workflowSet = new Set(workflowFiles.filter(Boolean));
  const principleSet = new Set(principleNames);
  const checks = [];
  delete receipt.acceptanceDigest;
  try {
    const workflowFilesFound = walkNoSymlinks(workflowRoot);
    const principleFilesFound = walkNoSymlinks(principleRoot);
    const currentDigest = treeDigest([...workflowFilesFound, ...principleFilesFound], candidateRoot);
    const missingWorkflows = [...workflowSet].filter((name) => !fs.statSync(path.join(workflowRoot, `${name}.md`), { throwIfNoEntry: false })?.isFile());
    const missingPrinciples = [...principleSet].filter((name) => !fs.statSync(path.join(principleRoot, `${name}.md`), { throwIfNoEntry: false })?.isFile());
    checks.push({ name: "registered-workflow-resources", passed: missingWorkflows.length === 0, detail: missingWorkflows.length ? `missing: ${missingWorkflows.join(", ")}` : `${workflowSet.size} registered resources present` });
    checks.push({ name: "principle-resources", passed: missingPrinciples.length === 0, detail: missingPrinciples.length ? `missing: ${missingPrinciples.join(", ")}` : `${principleSet.size} principle resources present` });
    const plan = fs.readFileSync(path.join(workflowRoot, "plan.md"), "utf8").toLowerCase();
    const investigation = fs.readFileSync(path.join(workflowRoot, "investigation.md"), "utf8").toLowerCase();
    const review = fs.readFileSync(path.join(workflowRoot, "review.md"), "utf8").toLowerCase();
    const boundaryPassed = /stop/.test(plan) && /read-only/.test(investigation) && /do not fix|without fixing|read-only/.test(review);
    checks.push({ name: "authorization-boundaries", passed: boundaryPassed, detail: boundaryPassed ? "plan, investigation, and review stop/read-only language present" : "required stop/read-only guidance missing" });
    checks.push({ name: "no-symbolic-links", passed: true, detail: `${workflowFilesFound.length + principleFilesFound.length} regular files inspected` });
    receipt.verifiedDigest = currentDigest;
    const current = Object.fromEntries([...workflowFilesFound, ...principleFilesFound].map((filename) => [path.relative(candidateRoot, filename), fs.readFileSync(filename, "utf8")]));
    receipt.changedPaths = [...new Set([...Object.keys(receipt.baseline), ...Object.keys(current)])].filter((name) => receipt.baseline[name] !== current[name]);
    const diff = receipt.changedPaths.map((name) => `--- ${name}\n${receipt.baseline[name] ?? ""}\n+++ ${name}\n${current[name] ?? ""}`).join("\n");
    fs.writeFileSync(path.join(storeRoot, "receipts", `${candidateId}.diff`), diff, { mode: 0o600 });
    checks.push({ name: "candidate-changes", passed: currentDigest !== receipt.baselineDigest, detail: currentDigest !== receipt.baselineDigest ? "candidate differs from its approved baseline" : "candidate contains no changes" });
    const resourceTest = spawnSync(process.execPath, ["--test", path.join(packageRoot, "tests", "resources.test.js")], {
      cwd: packageRoot,
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 1_000_000,
      env: { ...process.env, PI_AUTOMATIC_WORKFLOWS_TEST_ROOT: candidateRoot },
    });
    const testOutput = `${resourceTest.stdout ?? ""}\n${resourceTest.stderr ?? ""}`.trim().slice(-1200);
    checks.push({ name: "trusted-resource-regression-tests", passed: resourceTest.status === 0, detail: resourceTest.status === 0 ? "trusted resource regression tests passed" : `resource test runner failed (status=${resourceTest.status}, signal=${resourceTest.signal ?? "none"}): ${testOutput}` });
  } catch (error) {
    checks.push({ name: "candidate-content-integrity", passed: false, detail: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500) });
  }
  const passed = checks.length === 6 && checks.every((check) => check.passed);
  receipt.checks = checks;
  receipt.checkedAt = new Date().toISOString();
  receipt.status = passed ? "verified" : "failed";
  atomicJson(receiptPath, receipt);
  return { candidateId, candidateRoot, passed, checks, receipt };
}

export function candidateEvaluationContext(options) {
  return withPromotionLock(options.storeRoot ?? REVISION_STORE, () => candidateContextUnlocked(options, options.bindCoordinator === true));
}

function candidateContextUnlocked({ candidateId, storeRoot = REVISION_STORE, coordinatorSessionId }, bind = false) {
  if (!/^[0-9a-f-]{36}$/i.test(candidateId)) throw new Error('Invalid candidate ID.');
  const receipt = readJson(path.join(storeRoot, 'receipts', `${candidateId}.json`));
  if (!receipt || receipt.schemaVersion !== 1 || receipt.candidateId !== candidateId || receipt.approvalSource !== 'observer-ui-build-action' || !['building','failed','verified'].includes(receipt.status)) throw new Error('No approved inactive candidate available for evaluation.');
  const candidateRoot = path.join(fs.realpathSync(path.join(storeRoot, 'candidates')), candidateId, 'content');
  if (receipt.candidateRoot !== candidateRoot || fs.realpathSync(candidateRoot) !== candidateRoot || !fs.lstatSync(candidateRoot).isDirectory()) throw new Error('Candidate evaluation path is invalid.');
  const files = [...walkNoSymlinks(path.join(candidateRoot, 'workflows')), ...walkNoSymlinks(path.join(candidateRoot, 'principles'))];
  const context = { schemaVersion: 1, candidateId, candidateDigest: treeDigest(files, candidateRoot), baseRevision: receipt.baseRevision, requiredScenarios: [...REQUIRED_BEHAVIORAL_SCENARIOS] };
  if (bind && !receipt.coordinatorSessionId) {
    assertCandidateCoordinator({ coordinatorSessionId }, coordinatorSessionId);
    receipt.coordinatorSessionId = coordinatorSessionId;
    atomicJson(path.join(storeRoot, 'receipts', `${candidateId}.json`), receipt);
  }
  assertCandidateCoordinator(receipt, coordinatorSessionId);
  return { ...context, reportTemplate: behavioralReportTemplate(context) };
}

export function submitBehavioralReport({ candidateId, report, storeRoot = REVISION_STORE, coordinatorSessionId }) {
  return withPromotionLock(storeRoot, () => {
    const context = candidateContextUnlocked({ candidateId, storeRoot, coordinatorSessionId });
    const result = validateBehavioralReport(report, { ...context, verifiedDigest: context.candidateDigest });
    const filename = path.join(storeRoot, 'receipts', `${candidateId}.json`);
    const receipt = readJson(filename);
    atomicJson(path.join(storeRoot, 'receipts', `${candidateId}.pending-acceptance.json`), report);
    receipt.pendingAcceptanceDigest = result.digest;
    atomicJson(filename, receipt);
    return result;
  });
}

export function acceptPendingBehavioralReport({ candidateId, storeRoot = REVISION_STORE, coordinatorSessionId }) {
  return withPromotionLock(storeRoot, () => {
    if (!/^[0-9a-f-]{36}$/i.test(candidateId)) throw new Error('Invalid candidate ID.');
    const receipt = readJson(path.join(storeRoot, 'receipts', `${candidateId}.json`));
    assertCandidateCoordinator(receipt, coordinatorSessionId);
    if (!receipt?.pendingAcceptanceDigest) throw new Error('Trusted coordinator behavioral report is missing; candidate remains inactive.');
    const filename = path.join(storeRoot, 'receipts', `${candidateId}.pending-acceptance.json`);
    if (!fs.lstatSync(filename, { throwIfNoEntry: false })?.isFile() || fs.lstatSync(filename).isSymbolicLink()) throw new Error('Pending behavioral report is missing or is a symbolic link.');
    const report = readJson(filename);
    if (!report || acceptanceDigest(report) !== receipt.pendingAcceptanceDigest) throw new Error('Pending behavioral report changed after submission.');
    return recordBehavioralUnlocked({ candidateId, report, storeRoot });
  });
}

export function recordBehavioralAcceptance(options) {
  return withPromotionLock(options.storeRoot ?? REVISION_STORE, () => recordBehavioralUnlocked(options));
}

function recordBehavioralUnlocked({ candidateId, report, storeRoot = REVISION_STORE }) {
  if (!/^[0-9a-f-]{36}$/i.test(candidateId)) throw new Error('Invalid candidate ID.');
  const receiptPath = path.join(storeRoot, 'receipts', `${candidateId}.json`);
  const receipt = readJson(receiptPath);
  if (!receipt || receipt.status !== 'verified' || !receipt.verifiedDigest || receipt.checks?.some(check => check.passed !== true)) throw new Error('Candidate must pass structural verification before behavioral acceptance.');
  const result = validateBehavioralReport(report, receipt);
  atomicJson(path.join(storeRoot, 'receipts', `${candidateId}.acceptance.json`), report);
  receipt.acceptanceDigest = result.digest;
  atomicJson(receiptPath, receipt);
  return result;
}

function assertBehavioralAcceptance(receipt, storeRoot) {
  const filename = path.join(storeRoot, 'receipts', `${receipt.candidateId}.acceptance.json`);
  if (!receipt.acceptanceDigest || !fs.lstatSync(filename, { throwIfNoEntry: false })?.isFile() || fs.lstatSync(filename).isSymbolicLink()) throw new Error('Behavioral evaluation and multi-project pilot evidence required; activation refused.');
  const report = readJson(filename);
  const result = validateBehavioralReport(report, receipt);
  if (result.digest !== receipt.acceptanceDigest) throw new Error('Behavioral acceptance evidence changed; activation refused.');
}

function withPromotionLock(storeRoot, fn) {
  fs.mkdirSync(storeRoot, { recursive: true });
  const lock = path.join(storeRoot, "promotion.lock");
  try { fs.mkdirSync(lock); }
  catch { throw new Error("Another revision operation holds the promotion lock; retry after inspecting its outcome."); }
  try {
    fs.writeFileSync(path.join(lock, "owner.json"), JSON.stringify({ pid: process.pid, hostname: os.hostname(), startedAt: new Date().toISOString() }), { flag: "wx", mode: 0o600 });
    return fn();
  } finally {
    fs.unlinkSync(path.join(lock, "owner.json"));
    fs.rmdirSync(lock);
  }
}

export function recoverPromotionLock({ storeRoot = REVISION_STORE } = {}) {
  const lock = path.join(storeRoot, "promotion.lock");
  const owner = readJson(path.join(lock, "owner.json"));
  if (!owner || owner.hostname !== os.hostname() || !Number.isInteger(owner.pid) || owner.pid <= 0) throw new Error("Lock owner cannot be verified; manual inspection required.");
  try { process.kill(owner.pid, 0); throw new Error("Lock owner is still running; recovery refused."); }
  catch (error) { if (error.code !== "ESRCH") throw error; }
  const archived = `${lock}.recovered-${crypto.randomUUID()}`;
  fs.renameSync(lock, archived);
  return { recovered: true, archived };
}

export function activateCandidate(options) {
  return withPromotionLock(options.storeRoot ?? REVISION_STORE, () => activateUnlocked(options));
}

function activateUnlocked({ candidateId, packageRoot, storeRoot = REVISION_STORE }) {
  const receiptPath = path.join(storeRoot, "receipts", `${candidateId}.json`);
  const receipt = readJson(receiptPath);
  if (!receipt || receipt.schemaVersion !== 1 || receipt.candidateId !== candidateId || !["verified", "active"].includes(receipt.status) || !Array.isArray(receipt.checks) || receipt.checks.length === 0 || receipt.checks.some((check) => check.passed !== true)) throw new Error("Candidate checks have not all passed; activation refused.");
  const candidatesRoot = fs.realpathSync(path.join(storeRoot, "candidates"));
  const candidateRoot = path.resolve(receipt.candidateRoot);
  const candidateStat = fs.lstatSync(candidateRoot);
  if (candidateRoot !== path.resolve(candidatesRoot, candidateId, "content") || fs.realpathSync(candidateRoot) !== candidateRoot || !within(candidatesRoot, candidateRoot) || !candidateStat.isDirectory() || candidateStat.isSymbolicLink()) throw new Error("Candidate content path is outside the managed candidate store.");
  const files = [...walkNoSymlinks(path.join(candidateRoot, "workflows")), ...walkNoSymlinks(path.join(candidateRoot, "principles"))];
  if (!receipt.verifiedDigest || treeDigest(files, candidateRoot) !== receipt.verifiedDigest) throw new Error("Candidate changed after verification; activation refused.");
  assertBehavioralAcceptance(receipt, storeRoot);
  const current = loadActiveRevision({ packageRoot, storeRoot });
  if (current.revisionId === candidateId) return readJson(path.join(storeRoot, "active.json"));
  if (current.revisionId !== receipt.baseRevision) throw new Error("Active revision changed since candidate approval; rebuild required.");
  const previous = readJson(path.join(storeRoot, "active.json")) ?? { schemaVersion: 1, revisionId: DEFAULT_REVISION_ID, resourceRoot: path.join(packageRoot, "workflows") };
  const active = { schemaVersion: 1, revisionId: candidateId, resourceRoot: candidateRoot, previous, activatedAt: new Date().toISOString(), candidateId };
  receipt.status = "active";
  receipt.activatedAt = active.activatedAt;
  atomicJson(receiptPath, receipt);
  atomicJson(path.join(storeRoot, "active.json"), active);
  return active;
}

export function loadPinnedRevision({ revisionId, resourceRoot, packageRoot = DEFAULT_PACKAGE_ROOT, storeRoot = REVISION_STORE }) {
  const baselineRoot = path.join(packageRoot, 'workflows');
  if (revisionId === DEFAULT_REVISION_ID) {
    if (resourceRoot !== baselineRoot) throw new Error('Pinned baseline resource path is invalid.');
    return { revisionId, resourceRoot: baselineRoot };
  }
  if (!/^[0-9a-f-]{36}$/i.test(revisionId)) throw new Error('Pinned revision ID is invalid.');
  const candidateRoot = path.join(fs.realpathSync(path.join(storeRoot, 'candidates')), revisionId, 'content');
  if (resourceRoot !== path.join(candidateRoot, 'workflows') || fs.realpathSync(candidateRoot) !== candidateRoot || !fs.lstatSync(candidateRoot).isDirectory()) throw new Error('Pinned revision resource path is invalid.');
  const receipt = readJson(path.join(storeRoot, 'receipts', `${revisionId}.json`));
  if (!receipt || receipt.schemaVersion !== 1 || receipt.candidateId !== revisionId || receipt.approvalSource !== 'observer-ui-build-action' || !['active','rolled-back'].includes(receipt.status) || !Number.isFinite(Date.parse(receipt.activatedAt)) || receipt.candidateRoot !== candidateRoot || !Array.isArray(receipt.checks) || !receipt.checks.length || receipt.checks.some(check => check.passed !== true)) throw new Error('Pinned workflow revision has no verified activation receipt.');
  const files = [...walkNoSymlinks(path.join(candidateRoot, 'workflows')), ...walkNoSymlinks(path.join(candidateRoot, 'principles'))];
  if (!receipt.verifiedDigest || treeDigest(files, candidateRoot) !== receipt.verifiedDigest) throw new Error('Pinned revision content changed after verification.');
  assertBehavioralAcceptance(receipt, storeRoot);
  return { revisionId, resourceRoot };
}

export function loadActiveRevision({ packageRoot = DEFAULT_PACKAGE_ROOT, storeRoot = REVISION_STORE } = {}) {
  const activePath = path.join(storeRoot, "active.json");
  const active = readJson(activePath);
  if (!fs.existsSync(activePath)) return { revisionId: DEFAULT_REVISION_ID, resourceRoot: path.join(packageRoot, "workflows") };
  if (!active || active.schemaVersion !== 1 || !active.revisionId || !active.resourceRoot) throw new Error("Active workflow revision manifest is malformed.");
  if (active.revisionId === DEFAULT_REVISION_ID) return { revisionId: DEFAULT_REVISION_ID, resourceRoot: path.join(packageRoot, "workflows") };
  const receipt = readJson(path.join(storeRoot, 'receipts', `${active.revisionId}.json`));
  if (receipt?.status !== 'active') throw new Error('Active workflow revision has no active receipt.');
  return loadPinnedRevision({ revisionId: active.revisionId, resourceRoot: path.join(path.resolve(active.resourceRoot), 'workflows'), packageRoot, storeRoot });
}

export function rollbackRevision(options = {}) {
  return withPromotionLock(options.storeRoot ?? REVISION_STORE, () => rollbackUnlocked(options));
}

function rollbackUnlocked({ packageRoot, storeRoot = REVISION_STORE } = {}) {
  const activePath = path.join(storeRoot, "active.json");
  const active = readJson(activePath);
  if (!active || !active.previous) return { rolledBack: false, reason: "No prior revision is available." };
  const previous = active.previous;
  if (previous.revisionId !== DEFAULT_REVISION_ID) {
    const candidateRoot = path.resolve(previous.resourceRoot);
    if (!within(fs.realpathSync(path.join(storeRoot, "candidates")), candidateRoot)) throw new Error("Prior revision path is outside the managed candidate store.");
    const receipt = readJson(path.join(storeRoot, "receipts", `${previous.revisionId}.json`));
    if (!receipt || receipt.status !== "active" || !receipt.verifiedDigest || !Array.isArray(receipt.checks) || receipt.checks.length === 0 || receipt.checks.some((check) => check.passed !== true)) throw new Error("Prior revision is not verified; rollback refused.");
    const files = [...walkNoSymlinks(path.join(candidateRoot, "workflows")), ...walkNoSymlinks(path.join(candidateRoot, "principles"))];
    if (treeDigest(files, candidateRoot) !== receipt.verifiedDigest) throw new Error("Prior revision changed; rollback refused.");
    assertBehavioralAcceptance(receipt, storeRoot);
  }
  const next = { ...previous, schemaVersion: 1, rolledBackAt: new Date().toISOString() };
  if (previous.revisionId === DEFAULT_REVISION_ID) delete next.previous;
  else next.previous = previous.previous ?? { revisionId: DEFAULT_REVISION_ID, resourceRoot: path.join(packageRoot, "workflows") };
  atomicJson(activePath, next);
  const receiptPath = path.join(storeRoot, "receipts", `${active.revisionId}.json`);
  const receipt = readJson(receiptPath);
  if (receipt) { receipt.status = "rolled-back"; atomicJson(receiptPath, receipt); }
  return { rolledBack: true, revisionId: previous.revisionId };
}
