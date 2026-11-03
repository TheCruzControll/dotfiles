import { completionGate } from './waits.ts';
import { WORKFLOWS } from "./registry.ts";

export const ENTRY_TYPE = "automatic-workflows";
export const ROUTE_EVENT = "workflow:evidence";
export const REVISION = "0.1.0";
export const MAX_ACTIVE_CHILDREN = 4;
export const MAX_TOTAL_CHILDREN = 16;

export function makeTask({ taskId, projectRoot, sessionId, branchAnchor, route, scope, constraints = [], reason, revision = REVISION }) {
  if (!WORKFLOWS[route]) throw new Error(`Unknown workflow route: ${route}`);
  if (!taskId || !projectRoot || !sessionId || !scope || !reason) throw new Error("Task selection is missing required fields.");
  return {
    schemaVersion: 1, taskId, projectRoot, sessionId, branchAnchor: branchAnchor ?? null,
    route, revision, scope: scope.slice(0, 1000), constraints: constraints.slice(0, 12).map((x) => String(x).slice(0, 300)),
    reason: reason.slice(0, 500), stage: "selected", verification: [], childRuns: [], reminderUsed: false,
    selectedAt: new Date().toISOString(),
  };
}

export function isEngineeringIntent(text) {
  const prompt = String(text ?? "").trim();
  if (prompt.length < 24) return false;
  return /\b(build|implement|add|change|fix|debug|refactor|review|investigate|explain|design|plan|test|migrat|optimiz|profile|trace|ship|deploy|pr\b|pull request|skill|playbook|workflow|code|app|bug|feature|crash|slow|visual|ui|interface|repo|repository)\b/i.test(prompt);
}

export function reconstruct(entries) {
  const tasks = new Map();
  for (const entry of entries ?? []) {
    if (entry?.type !== "custom" || entry.customType !== ENTRY_TYPE || !entry.data || entry.data.schemaVersion !== 1) continue;
    const { action, task } = entry.data;
    if (action === "selected" && task?.taskId && WORKFLOWS[task.route]) tasks.set(task.taskId, structuredClone(task));
    if (action === "updated" && task?.taskId && tasks.has(task.taskId)) tasks.set(task.taskId, structuredClone(task));
  }
  return [...tasks.values()].at(-1);
}

export function applyUpdate(task, update) {
  if (!task) throw new Error("Select a workflow before recording workflow evidence.");
  if (update.taskId && update.taskId !== task.taskId) throw new Error("Evidence task ID does not match the active task.");
  if (update.action === "stage") {
    if (!update.value) throw new Error("Stage updates require a value.");
    if (/completed|cleanup/i.test(update.value)) completionGate(task);
    task.stage = update.value.slice(0, 120);
    task.lastEventType = "stage";
  }
  else if (update.action === "verification") {
    if (!update.check || !update.result) throw new Error("Verification updates require check and result.");
    const key = update.check.trim().replace(/\s+/g, ' ').toLowerCase();
    task.continuationFailures ??= {};
    if (['failed', 'inconclusive', 'unavailable'].includes(update.result)) {
      const failureKey = `${key}:${update.result}`;
      task.continuationFailures[failureKey] = (task.continuationFailures[failureKey] ?? 0) + 1;
      if (task.continuationFailures[failureKey] >= 3) {
        task.continuationStopped = true;
        for (const job of task.waits ?? []) if (job.status === 'scheduled') job.status = 'suspended';
      }
    } else if (update.result === 'passed') {
      for (const failureKey of Object.keys(task.continuationFailures)) if (failureKey.startsWith(`${key}:`)) delete task.continuationFailures[failureKey];
      task.continuationStopped = Object.values(task.continuationFailures).some(count => count >= 3);
    }
    task.verification.push({ check: update.check.slice(0, 300), result: update.result, paths: (update.paths ?? []).slice(0, 30), at: new Date().toISOString() });
    task.stage = "verify";
    task.lastEventType = update.result === "skipped" || update.result === "unavailable" ? "verification_invalidated" : "verification";
  } else if (update.action === "correction") {
    if (!update.value) throw new Error("Correction updates require a value.");
    task.corrections = [...(task.corrections ?? []), update.value.slice(0, 300)].slice(-12);
    task.lastEventType = "correction";
  }
  else throw new Error("Unsupported workflow evidence action.");
  return task;
}

export function canRemind(task, prompt = "") {
  return !!task && WORKFLOWS[task.route]?.verify && !task.reminderUsed && !/(don't|do not|skip|without|no)\s+(run\s+)?(tests?|checks?|verification)/i.test(`${task.scope} ${prompt}`) && !task.constraints.some((c) => /skip|don't|do not|no tests|no verification/i.test(c));
}

export function isLikelyCodeWriter(input) {
  const tasks = [input?.task, ...(Array.isArray(input?.tasks) ? input.tasks.map((task) => task?.task) : []), ...(Array.isArray(input?.args?.tasks) ? input.args.tasks.map((task) => task?.task) : [])];
  return tasks.filter((task) => typeof task === "string").some((task) => {
    const affirmative = task.replace(/\b(?:do not|don't|never|without)\s+(?:implement|write|writing|edit|editing|modify|modifying|change|changing|create|creating|delete|deleting|remove|removing|run|launch)\b/gi, "");
    return /\b(?:implement|write|edit|fix|build|refactor|change|modify|create|add|remove|delete)\b/i.test(affirmative);
  });
}

export function shouldRecordTool(toolName) {
  return ["subagent", "herdr_subagent"].includes(toolName);
}

export function totalChildLimit(task) {
  const allowance = task?.launchAllowance;
  if (!allowance) return MAX_TOTAL_CHILDREN;
  const valid = allowance.schemaVersion === 1 && allowance.taskId === task.taskId && allowance.approvedBy === 'owner-ui-confirmation'
    && Number.isSafeInteger(allowance.launchCount) && allowance.launchCount >= 0 && allowance.launchCount <= task.childRuns.length
    && Number.isSafeInteger(allowance.nextLaunches) && allowance.nextLaunches > 0
    && Number.isSafeInteger(allowance.totalLimit) && allowance.totalLimit === allowance.launchCount + allowance.nextLaunches
    && Number.isFinite(Date.parse(allowance.approvedAt));
  return valid ? Math.max(MAX_TOTAL_CHILDREN, allowance.totalLimit) : 0;
}

/** Caller must obtain an interactive owner confirmation before granting this. */
export function approveChildAllowance(task, nextLaunches) {
  if (!task || !Number.isSafeInteger(nextLaunches) || nextLaunches < 1 || !Number.isSafeInteger(task.childRuns.length + nextLaunches)) throw new Error('A positive safe-integer launch allowance and active task are required.');
  task.launchAllowance = { schemaVersion: 1, taskId: task.taskId, approvedBy: 'owner-ui-confirmation', approvedAt: new Date().toISOString(), launchCount: task.childRuns.length, nextLaunches, totalLimit: task.childRuns.length + nextLaunches };
  return task.launchAllowance;
}

export function reserveChildRuns(task, reservations) {
  if (!task || !Array.isArray(reservations) || reservations.length === 0) return { allowed: false, reason: "No active task or child reservations." };
  const active = task.childRuns.filter((run) => run.status === "active").length;
  const totalLimit = totalChildLimit(task);
  if (task.childRuns.length + reservations.length > totalLimit) return { allowed: false, reason: `Total child limit (${totalLimit}) reached; owner approval is required to continue.` };
  if (active + reservations.length > MAX_ACTIVE_CHILDREN) return { allowed: false, reason: `Active child limit (${MAX_ACTIVE_CHILDREN}) reached.` };
  if (reservations.some((run) => run.role === "writer" && !run.isolated) && task.childRuns.some((run) => run.role === "writer" && run.status === "active")) return { allowed: false, reason: "Serialize writing agents when isolation is unavailable." };
  task.childRuns.push(...reservations.map((run) => ({ ...run, childId: String(run.childId).slice(0, 160), status: "active", isolated: Boolean(run.isolated), startedAt: run.startedAt ?? new Date().toISOString() })));
  return { allowed: true };
}

export function recordChildLaunch(task, childId, isolated) {
  return reserveChildRuns(task, [{ childId, isolated }]);
}

export function requestedLaunches(input) {
  if (!input || typeof input !== "object" || input.action) return 0;
  if (input.agent || (typeof input.name === "string" && typeof input.task === "string")) return 1;
  if (input.workflow === "parallel" && Array.isArray(input.args?.tasks)) return input.args.tasks.length;
  if (Array.isArray(input.tasks)) return input.tasks.length;
  if (input.workflow === true || typeof input.workflow === "string") return -1;
  return 0;
}

export function recordChildStart(task, payload) {
  if (!task || !payload?.id) return false;
  const run = task.childRuns.find((item) => item.status === "active" && !item.runtimeId);
  if (!run) return false;
  run.runtimeId = payload.id;
  return true;
}

export function recordChildComplete(task, payload) {
  const runtimeId = payload?.id ?? payload?.runId;
  if (!task || !runtimeId) return false;
  const run = task.childRuns.find((item) => item.runtimeId === runtimeId);
  if (!run) return false;
  run.runtimeId ??= runtimeId;
  if (run.backend === 'background') run.sessionFile = payload.sessionPath ?? payload.results?.find(result => result.sessionPath)?.sessionPath ?? run.sessionFile;
  run.status = "completed";
  return true;
}

export function applyChildLifecycle(task, record) {
  if (!task || record?.version !== 1 || typeof record.id !== "string" || typeof record.name !== "string" || !record.name || typeof record.sessionFile !== "string" || !["started", "interrupt-requested", "completed", "failed", "unresolved"].includes(record.status)) return false;
  const run = task.childRuns.find((item) => item.runtimeId === record.id)
    ?? task.childRuns.find((item) => item.status === "active" && !item.runtimeId && item.sessionFile === record.sessionFile);
  if (!run || (run.sessionFile && run.sessionFile !== record.sessionFile) || (run.status === "completed" && !["completed", "failed"].includes(record.status))) return false;
  run.runtimeId = record.id;
  run.sessionFile = record.sessionFile;
  run.lifecycleStatus = record.status;
  run.paneId = record.paneId ?? run.paneId;
  if (record.status === "completed" || record.status === "failed") run.status = "completed";
  else if (run.status !== "completed") run.status = "active";
  run.needsAttention = record.status === "unresolved";
  return true;
}

export function recordChildToolResult(task, reservationIds) {
  if (!task) return;
  for (const reservationId of reservationIds) {
    const run = task.childRuns.find((item) => item.childId === reservationId);
    if (run && !run.runtimeId) run.status = "completed";
  }
}

export function promptFor(route, task) {
  const workflow = WORKFLOWS[route];
  return [
    `Selected workflow: ${workflow.label}.`,
    `Purpose: ${workflow.summary}`,
    `Scope: ${task.scope}`,
    task.constraints.length ? `User constraints: ${task.constraints.join("; ")}` : "",
    "Honor user stop boundaries. Workflow selection does not authorize external, destructive, or delivery actions.",
    "Record meaningful stage changes and verification outcomes with workflow_update. Do not claim unrecorded checks passed.",
    "If this is a plan, investigation, or review, do not implement unless the user separately asks.",
  ].filter(Boolean).join("\n");
}
