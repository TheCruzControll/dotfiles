import fs from "node:fs";
import { scheduleWait, externalOutcome, eligibleWait, createWaitScheduler } from '../lib/waits.ts';
import { createChildWriteFence } from "../lib/child-write-fence.ts";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import { WORKFLOWS, WORKFLOW_FILES, PRINCIPLE_NAMES } from "../lib/registry.ts";
import { ENTRY_TYPE, ROUTE_EVENT, applyUpdate, canRemind, isEngineeringIntent, isLikelyCodeWriter, makeTask, promptFor, reconstruct, reserveChildRuns, requestedLaunches, recordChildComplete, recordChildToolResult, applyChildLifecycle, MAX_ACTIVE_CHILDREN, totalChildLimit, approveChildAllowance } from "../lib/policy.ts";
import { prepareIsolation, validateIsolation } from "../lib/isolation.ts";
import { REVISION_STORE, activateCandidate, beginCandidate, findBuildingCandidate, completeCandidateBuild, loadActiveRevision, loadPinnedRevision, recoverPromotionLock, rollbackRevision, validateCandidate, candidateEvaluationContext, submitBehavioralReport, acceptPendingBehavioralReport } from "../lib/revisions.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SUBAGENT_COMPLETE = "subagent:async-complete";

function text(content) { return [{ type: "text", text: content }]; }
function branchId(ctx) { return ctx.sessionManager.getBranch().at(-1)?.id ?? null; }
function sessionId(ctx) { return ctx.sessionManager.getSessionId() ?? "unknown"; }
function candidateCoordinator(ctx) {
  if (process.env.PI_SUBAGENT_CHILD === '1' || process.env.PI_SUBAGENT_ID) throw new Error('A child cannot evaluate or finalize a candidate; the top-level coordinator owns evaluation.');
  const id = ctx.sessionManager?.getSessionId?.();
  if (typeof id !== 'string' || !id.trim() || id === 'unknown') throw new Error('Candidate coordinator session identity is missing.');
  return id;
}
function optedOut(cwd) { return fs.existsSync(path.join(cwd, ".pi-workflows-off")); }
function append(pi, action, task) {
  const entry = { schemaVersion: 1, action, task: structuredClone(task) };
  pi.appendEntry(ENTRY_TYPE, entry);
  try {
    pi.events.emit(ROUTE_EVENT, { eventId: crypto.randomUUID(), schemaVersion: 1, projectPath: task.projectRoot, sessionAnchor: task.branchAnchor ?? task.sessionId, taskId: task.taskId, workflowRevision: task.revision, timestamp: new Date().toISOString(), eventType: action === "selected" ? "route_selected" : task.lastEventType ?? "stage", evidenceRefs: [task.taskId] });
  } catch {}
}
function loadRoute(route, resourceRoot = path.join(root, "workflows")) {
  const record = WORKFLOWS[route];
  if (!record) throw new Error(`Unknown route. Choose one of: ${Object.keys(WORKFLOWS).join(", ")}`);
  const resource = WORKFLOW_FILES[route];
  if (resource === null) return `${record.summary}\n\nKeep this interaction brief. Do not create a task process for a simple question or trivial, fully specified edit.`;
  if (!resource) throw new Error(`Workflow resource is not registered: ${route}`);
  const filename = path.resolve(resourceRoot, `${resource}.md`);
  if (!filename.startsWith(`${path.resolve(resourceRoot)}${path.sep}`)) throw new Error("Workflow path is outside the trusted registry.");
  const content = fs.readFileSync(filename, "utf8").replace(/\]\(\.\.\/principles\/([a-z0-9-]+\.md)\)/g, (_match, leaf) => `](${path.resolve(resourceRoot, "..", "principles", leaf)})`);
  return `${record.summary}\n\n${content}`;
}
export default function automaticWorkflows(pi) {
  const writeFence = createChildWriteFence(pi, fileURLToPath(import.meta.url));
  pi.on("user_bash", (event, ctx) => writeFence.userBash(event, ctx));
  const revisionStore = process.env.PI_AUTOMATIC_WORKFLOWS_REVISION_STORE ? path.resolve(process.env.PI_AUTOMATIC_WORKFLOWS_REVISION_STORE) : REVISION_STORE;
  let task;
  let currentCtx;
  let enabled = true;
  let forcedNextRoute;
  let launchReservations = new Map();
  let routingNeeded = false;
  let routingReminderUsed = false;
  let staleWakeup = false;

  const binding = ctx => ({ sessionId: sessionId(ctx), projectRoot: path.resolve(ctx.cwd), branchIds: ctx.sessionManager.getBranch().map(e => e.id) });
  const scheduler = createWaitScheduler({ tick: () => {
    const ctx = currentCtx;
    if (!ctx || !enabled || optedOut(ctx.cwd)) return;
    for (const job of task?.waits ?? []) {
      if (job.status !== 'scheduled') continue;
      if (!eligibleWait(task, job, binding(ctx))) { job.status = 'suspended'; append(pi, 'updated', task); continue; }
      if (Date.now() >= job.deadline || job.attempts >= job.maxAttempts) {
        job.status = 'expired'; append(pi, 'updated', task);
        ctx.ui?.notify?.('Conductor check expired; reconcile manually.', 'warning'); continue;
      }
      if (Date.now() < job.nextDue) continue;
      // Keep busy work in the controller queue, not in Pi's un-retractable message queue.
      if (!ctx.isIdle?.()) {
        scheduler.arm(task.waits.map(j => ({ ...j, nextDue: Math.max(j.nextDue, Date.now() + 1000) })));
        return;
      }
      job.status = 'checking'; job.attempts++; delete job.deliveredAt;
      append(pi, 'updated', task);
      try {
        pi.sendMessage({ customType: 'workflow-wakeup', content: `Conductor authorized check: ${job.check}\nLatest response: ${job.responseRef}\nAuthorization: ${job.authorization}\nCheck only; never replay ambiguous mutations. Record external outcome with workflow_wait. Stop at approval-needed.`, display: true, details: { taskId: task.taskId, jobId: job.id } }, { triggerTurn: true, deliverAs: 'followUp' });
      } catch { job.status = 'suspended'; append(pi, 'updated', task); }
      break;
    }
    scheduler.arm(task?.waits ?? []);
    renderStatus(ctx);
  } });

  function restore(ctx) {
    scheduler.stop();
    currentCtx = ctx;
    const records = ctx.sessionManager.getBranch().filter((entry) => entry.type === "custom" && entry.customType === ENTRY_TYPE).map((entry) => entry.data);
    const settings = records.filter((entry) => entry?.schemaVersion === 1 && entry.action === "setting").at(-1);
    enabled = settings?.enabled ?? true;
    task = reconstruct(ctx.sessionManager.getBranch());
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "custom" && entry.customType === "workflow:child-lifecycle") applyChildLifecycle(task, entry.data);
    }
    launchReservations = new Map();
    for (const job of task?.waits ?? []) {
      if (!['cancelled', 'expired'].includes(job.status) && (job.status === 'checking' || !eligibleWait(task, job, binding(ctx)))) job.status = 'suspended';
    }
    if (task?.waits?.length) append(pi, 'updated', task);
    scheduler.arm(task?.waits ?? []);
    renderStatus(ctx);
  }

  function renderStatus(ctx = currentCtx) {
    if (!ctx?.hasUI) return;
    const status = !enabled ? "Conductor:off" : task ? `Conductor · ${WORKFLOWS[task.route].label} · ${task.externalState ?? task.stage}${task.waits?.some(j => j.status === 'scheduled') ? ' · next ' + new Date(Math.min(...task.waits.filter(j => j.status === 'scheduled').map(j => j.nextDue))).toISOString() : ''}` : "Conductor:auto";
    ctx.ui.setStatus("automatic-workflows", status);
  }

  pi.on("session_start", async (_event, ctx) => {
    restore(ctx);
    await writeFence.initialize(ctx);
  });
  pi.on("session_tree", (_event, ctx) => restore(ctx));
  pi.on("session_shutdown", (_event, ctx) => {
    scheduler.stop();
    currentCtx = undefined;
    if (ctx?.hasUI) ctx.ui.setStatus("automatic-workflows", undefined);
  });

  pi.on("before_agent_start", (event, ctx) => {
    currentCtx = ctx;
    staleWakeup = false;
    if (event.messageType === 'custom' && event.message?.customType === 'workflow-wakeup') {
      const job = task?.waits?.find(j => j.id === event.message.details?.jobId);
      let valid = enabled && !optedOut(ctx.cwd) && job?.status === 'checking' && !job.deliveredAt && eligibleWait(task, job, binding(ctx));
      if (valid) {
        job.deliveredAt = Date.now();
        append(pi, 'updated', task);
        try {
          const pinned = loadPinnedRevision({ revisionId: task.revision, resourceRoot: task.resourceRoot, packageRoot: root, storeRoot: revisionStore });
          event.systemPromptOptions.sections.automatic_workflow = `${promptFor(task.route, task)}\n${loadRoute(task.route, pinned.resourceRoot)}\nScheduled check only. Existing permissions, model guards and budgets remain unchanged. No user approval is implied.`;
        } catch { valid = false; job.status = 'suspended'; append(pi, 'updated', task); }
      }
      staleWakeup = !valid;
      if (!valid) event.systemPromptOptions.sections.automatic_workflow = 'Stale Conductor wakeup: take no action. Report reconciliation required and stop.';
      return;
    }
    if (event.messageType === 'user' && task?.waits?.some(j => j.status === 'scheduled')) {
      for (const job of task.waits) if (job.status === 'scheduled') job.status = 'suspended';
      append(pi, 'updated', task);
      scheduler.stop();
    }
    if (!enabled || optedOut(ctx.cwd) || event.messageType !== "user" || !isEngineeringIntent(event.prompt)) {
      routingNeeded = false;
      routingReminderUsed = false;
      event.systemPromptOptions.sections.automatic_workflow = undefined;
      return;
    }
    routingNeeded = !(task && task.projectRoot === path.resolve(ctx.cwd));
    routingReminderUsed = false;
    const active = task && task.projectRoot === path.resolve(ctx.cwd) ? `Active task ${task.taskId} uses ${task.route} at ${task.stage}. Continue it unless intent or scope changed.` : "No engineering workflow is selected for this request.";
    event.systemPromptOptions.sections.automatic_workflow = [
      "For a substantive engineering task, your next action must be workflow_select before replying or acting when no matching active task exists, or when the request changes intent or scope. Do not draft a plan, explanation, or implementation before the tool result. Continue a matching task without restarting its workflow. Use lightweight only for casual chat or trivial edits. If uncertain, choose investigation or plan rather than skipping selection.",
      "Select the route that matches user intent. Preserve explicit plan-only, read-only, review-only, stop, and scope boundaries.",
      "Selection adds guidance but does not authorize external, destructive, delivery, or out-of-scope actions.",
      "Keep review loops within the user's acceptance conditions and explicit non-goals. Continue-until-finished means finish that scope, not grow it. Before accepting a review finding, identify the violated requirement and concrete failure evidence; defer speculative edge cases, optional hardening, extra compatibility layers and unrelated integration. Keep required safety checks. Recheck the affected behavior after a fix, not the whole project unless its impact requires it. Stop when agreed checks pass; report blocked checks instead of replacing them with more implementation.",
      "Record meaningful stages and actual verification with workflow_update. Never claim unrecorded checks passed.",
      "Use the available delegation capability only within the workflow's explicitly granted limits. No nested child spawning.",
      active,
    ].join("\n");
    return { message: { customType: "workflow-routing", content: "AUTOMATIC WORKFLOW ROUTING: Before answering this substantive engineering request, call workflow_select unless a matching active task is already in progress. If task intent or scope changed, select a new route. Preserve all explicit user constraints. A Plan route must stop before implementation. A Review or Investigation route is read-only.", display: false, details: { projectRoot: path.resolve(ctx.cwd) } } };
  });

  pi.registerTool({
    name: "workflow_select",
    label: "Select workflow",
    description: "Select and load a trusted engineering playbook before substantive work. Routes include architect, bug-fix, feature, refactor, investigation, review, plan, performance, hillclimb, runtime-forensics, trace-forensics, prototype, visual-parity, skill-authoring, eval, session-pickup, pause-safely, multi-phase-plan, worktree-cleanup, babysit, shipping, opening-a-pr, autonomous-run, orchestrate, autopilot-stack, autopilot-full, and lightweight. Select architect before substantive feature implementation or when a change crosses a function boundary.",
    promptSnippet: "Select the applicable engineering workflow before substantive work.",
    parameters: Type.Object({
      route: Type.String({ description: "Exact route ID from the workflow registry." }),
      scope: Type.String({ minLength: 1, maxLength: 1000 }),
      reason: Type.String({ minLength: 1, maxLength: 500 }),
      constraints: Type.Optional(Type.Array(Type.String({ maxLength: 300 }), { maxItems: 12 })),
    }),
    async execute(_id, args, _signal, _update, ctx) {
      try {
        if (!enabled || optedOut(ctx.cwd)) throw new Error("Automatic workflows are disabled for this session or project.");
        const route = forcedNextRoute ?? args.route;
        forcedNextRoute = undefined;
        const activeRevision = task && task.projectRoot === path.resolve(ctx.cwd) && task.stage !== "completed" && task.resourceRoot
          ? loadPinnedRevision({ revisionId: task.revision, resourceRoot: task.resourceRoot, packageRoot: root, storeRoot: revisionStore })
          : loadActiveRevision({ packageRoot: root, storeRoot: revisionStore });
        if (task?.childRuns.some((run) => run.status === "active")) throw new Error("Owned children remain active; reconcile them before changing workflow scope.");
        const continuing = task && task.projectRoot === path.resolve(ctx.cwd) && task.stage !== "completed";
        const newTask = makeTask({ taskId: continuing ? task.taskId : crypto.randomUUID(), projectRoot: path.resolve(ctx.cwd), sessionId: sessionId(ctx), branchAnchor: branchId(ctx), route, scope: args.scope, constraints: args.constraints, reason: args.reason, revision: activeRevision.revisionId });
        if (task?.waits?.some(j => !['cancelled', 'expired'].includes(j.status))) throw new Error('Cancel or reconcile existing checks before changing scope.');
        if (continuing && task.childModelMappings) newTask.childModelMappings = structuredClone(task.childModelMappings);
        if (continuing) {
          newTask.childRuns = task.childRuns;
          newTask.isolations = task.isolations ?? [];
          if (task.launchAllowance) newTask.launchAllowance = structuredClone(task.launchAllowance);
          for (const field of ['externalState', 'latestResponseRef', 'waits']) {
            if (task[field] !== undefined) newTask[field] = structuredClone(task[field]);
          }
        }
        newTask.resourceRoot = activeRevision.resourceRoot;
        task = newTask;
        routingNeeded = false;
        append(pi, "selected", task);
        renderStatus(ctx);
        const guide = loadRoute(route, activeRevision.resourceRoot);
        const content = `${promptFor(route, task)}\n\n${guide}`;
        return { content: text(content), details: { taskId: task.taskId, route, revision: activeRevision.revisionId }, structuredContent: { taskId: task.taskId, route, revision: activeRevision.revisionId } };
      } catch (error) {
        return { content: text(`Workflow selection failed. Continue normal Pi behavior and report the limitation. ${error instanceof Error ? error.message : String(error)}`), details: { error: String(error) }, isError: true };
      }
    },
  });

  pi.registerTool({
    name: 'workflow_wait', label: 'Conductor wait',
    description: 'Schedule/list/cancel authorized external checks, record outcome, or request owner approval to continue. Never retry ambiguous mutations. Approval-needed stops all checks. Times are epoch milliseconds.',
    parameters: Type.Object({ action: Type.String(), id: Type.Optional(Type.String()), check: Type.Optional(Type.String()), authorization: Type.Optional(Type.String()), responseRef: Type.Optional(Type.String()), state: Type.Optional(Type.String()), nextDue: Type.Optional(Type.Integer()), deadline: Type.Optional(Type.Integer()), maxAttempts: Type.Optional(Type.Integer()) }),
    async execute(_id, args, _signal, _update, ctx) {
      if (process.env.PI_SUBAGENT_CHILD === '1' || process.env.PI_SUBAGENT_ID) throw new Error('Only controllers own waits.');
      if (!enabled || optedOut(ctx.cwd) || !task || task.projectRoot !== path.resolve(ctx.cwd) || task.sessionId !== sessionId(ctx)) throw new Error('No matching enabled task.');
      if (args.action === 'list') return { content: text(JSON.stringify(task.waits ?? [])), details: task.waits ?? [] };
      if (args.action === 'schedule') scheduleWait(task, { id: crypto.randomUUID(), check: args.check, authorization: args.authorization, responseRef: args.responseRef, nextDue: args.nextDue, deadline: args.deadline, maxAttempts: args.maxAttempts }, { sessionId: sessionId(ctx), projectRoot: path.resolve(ctx.cwd), branchAnchor: branchId(ctx) }, Date.now());
      else if (args.action === 'cancel') {
        const job = task.waits?.find(j => j.id === args.id);
        if (!job) throw new Error('Unknown job.');
        job.status = 'cancelled';
      } else if (args.action === 'outcome') {
        const previous = task.externalState;
        externalOutcome(task, args, Date.now());
        if (previous !== task.externalState) ctx.ui?.notify?.(`Conductor: ${task.externalState}`, 'info');
      } else if (args.action === 'approve') {
        if (task.externalState !== 'approval-needed' || !ctx.hasUI || !ctx.ui?.confirm) throw new Error('Interactive approval required.');
        const target = task;
        if (!await ctx.ui.confirm('Conductor continuation', `Continue task ${task.taskId}? Existing permissions remain; this does not approve new external mutations or spending.`)) throw new Error('Declined.');
        if (!enabled || optedOut(ctx.cwd) || task !== target || sessionId(ctx) !== task.sessionId || task.externalState !== 'approval-needed') throw new Error('Stale approval.');
        task.externalState = 'working';
        for (const job of task.waits ?? []) if (job.status === 'approval-needed') job.status = 'cancelled';
      } else throw new Error('Use schedule, list, cancel, outcome or approve.');
      append(pi, 'updated', task);
      scheduler.arm(task.waits ?? []);
      renderStatus(ctx);
      return { content: text(JSON.stringify({ state: task.externalState, jobs: task.waits })), details: { state: task.externalState, jobs: task.waits } };
    },
  });

  // Selectors are configuration identity, never inferred from task prose.
  function childSelector(input, previous) {
    if (previous) return previous.modelSelector ?? { field: null, value: null };
    return (input.agent ? { field: 'agent', value: input.agent } : { field: 'name', value: input.name });
  }
  function baseModel(model) {
    return typeof model === 'string' ? model.replace(/:(off|minimal|low|medium|high|xhigh|max)$/, '') : undefined;
  }
  function authorizeModel(input, parentModel, previous, effectiveModel) {
    if (!parentModel) return 'Parent model identity is unavailable.';
    const selector = childSelector(input, previous);
    const allowed = model => baseModel(model) === baseModel(parentModel) || (selector.field === 'agent' && baseModel(model) === baseModel(profileModel(selector.value))) || task?.childModelMappings?.some(entry => entry.field === selector.field && entry.role === selector.value && baseModel(entry.model) === baseModel(model));
    if (input.model !== undefined && !allowed(input.model)) return 'Child model override requires an explicitly approved role/model map.';
    if (effectiveModel !== undefined && !allowed(effectiveModel)) return 'Resolved child model requires an explicitly approved role/model map.';
  }

  pi.registerTool({
    name: 'workflow_approve_child_models',
    label: 'Approve task child role/model mapping',
    description: 'Ask the interactive owner to replace the active task child model mapping (at most 16 exact entries). Role selects agent when present, otherwise name (workflow step key). Never approves by model text alone or starts agents. Other authorization and spending constraints remain.',
    parameters: Type.Object({ mappings: Type.Array(Type.Object({ field: Type.Union([Type.Literal('agent'), Type.Literal('name')]), role: Type.String({ minLength: 1, maxLength: 100 }), model: Type.String({ minLength: 3, maxLength: 200 }) }), { maxItems: 16 }) }),
    async execute(_id, args, _signal, _update, ctx) {
      try {
        if (process.env.PI_SUBAGENT_CHILD === '1' || process.env.PI_SUBAGENT_ID) throw new Error('Children cannot approve models.');
        if (!enabled || optedOut(ctx.cwd) || !task || task.stage === 'completed' || task.projectRoot !== path.resolve(ctx.cwd)) throw new Error('Select a matching active workflow task first.');
        if (Object.keys(args).some(key => key !== 'mappings') || !Array.isArray(args.mappings) || args.mappings.length > 16) throw new Error('Invalid bounded mapping.');
        const mappings = structuredClone(args.mappings);
        const seen = new Set();
        for (const entry of mappings) {
          if (!entry || Object.keys(entry).sort().join(',') !== 'field,model,role' || !['agent','name'].includes(entry.field) || typeof entry.role !== 'string' || !entry.role.trim() || entry.role.length > 100 || /[\x00-\x1f\x7f]/.test(entry.role) || (entry.field === 'agent' && !/^[A-Za-z0-9_.-]+$/.test(entry.role)) || typeof entry.model !== 'string' || entry.model.length > 200 || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_./:-]+$/.test(entry.model)) throw new Error('Use exact agent/name identifiers and provider/model IDs.');
          const key = `${entry.field}:${entry.role}:${entry.model}`;
          if (seen.has(key)) throw new Error('Duplicate mapping.');
          seen.add(key);
        }
        if (!ctx.hasUI || typeof ctx.ui?.confirm !== 'function') throw new Error('Interactive owner confirmation is required.');
        const target = task;
        const approved = await ctx.ui.confirm('Approve child model mapping', `Replace model permissions for task ${task.taskId}?\nScope: ${task.scope}\n${JSON.stringify(mappings, null, 2)}\nParent inheritance remains default. This does not authorize spending, publication, additional launches, or nesting.`);
        if (approved !== true) return { content: text('Owner declined; model permissions unchanged.'), details: { approved: false } };
        if (task !== target || task.stage === 'completed' || task.projectRoot !== path.resolve(ctx.cwd) || !enabled || optedOut(ctx.cwd)) throw new Error('Task changed during confirmation; no permission granted.');
        task.childModelMappings = mappings;
        append(pi, 'updated', task);
        return { content: text('Owner-approved task model mapping recorded. No agents started.'), details: { approved: true, mappings } };
      } catch (error) { return { content: text(String(error)), isError: true }; }
    },
  });

  pi.registerTool({
    name: 'workflow_request_budget',
    label: 'Request owner-approved launch allowance',
    description: 'Ask the interactive owner to authorize exactly the next N child launches for the active task. Never starts agents. Four-active/no-nesting restrictions remain. Do not retry a denied request without a new owner instruction.',
    parameters: Type.Object({ launches: Type.Integer({ minimum: 1 }), reason: Type.String() }),
    async execute(_id, args, _signal, _update, ctx) {
      try {
        if (process.env.PI_SUBAGENT_CHILD === '1' || process.env.PI_SUBAGENT_ID) throw new Error('Children cannot request delegation budget.');
        if (!task || task.projectRoot !== path.resolve(ctx.cwd)) throw new Error('Select the matching workflow task first.');
        if (!Number.isSafeInteger(args.launches) || args.launches < 1 || !Number.isSafeInteger(task.childRuns.length + args.launches) || typeof args.reason !== 'string' || !args.reason.trim() || args.reason.length > 500) throw new Error('Provide a positive safe-integer allowance and a bounded reason.');
        if (!ctx.hasUI || typeof ctx.ui?.confirm !== 'function') throw new Error('Budget changes require interactive owner confirmation; no allowance was granted.');
        const target = task, count = task.childRuns.length;
        const approved = await ctx.ui.confirm('Authorize child launches', `Allow exactly the next ${args.launches} child launches for task ${task.taskId}?\nScope: ${task.scope}\nReason: ${args.reason}\nRecorded launches: ${count}; new recorded total limit: ${count + args.launches}.\nAt most ${MAX_ACTIVE_CHILDREN} active children, no nesting, and existing model/isolation/authorization restrictions still apply. No agents start from this approval.`);
        if (!approved) return { content: text('Owner declined; no launch allowance was granted.'), details: { approved: false } };
        if (task !== target || task.childRuns.length !== count) throw new Error('Task or launch count changed while approval was pending; request a fresh confirmation.');
        const allowance = approveChildAllowance(task, args.launches);
        append(pi, 'updated', task);
  // A model pinned in the agent profile frontmatter is owner-authored config, so it counts as approved.
  function profileModel(agent) {
    if (!agent) return;
    const agentDir = process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), '.pi', 'agent');
    for (const dir of [path.join(process.cwd(), '.pi', 'agents'), path.join(agentDir, 'agents')]) {
      const file = path.join(dir, `${agent}.md`);
      if (!fs.existsSync(file)) continue;
      return fs.readFileSync(file, 'utf8').match(/^---\n([\s\S]*?)\n---/)?.[1].match(/^model:\s*(\S+)/m)?.[1];
    }
  }
        return { content: text(`Owner approved exactly the next ${args.launches} launches. Recorded total limit: ${allowance.totalLimit}; active limit remains ${MAX_ACTIVE_CHILDREN}. No agents were started.`), details: allowance };
      } catch (error) { return { content: text(String(error)), isError: true }; }
    },
  });

  pi.registerTool({
    name: "workflow_prepare_child",
    label: "Prepare isolated child directory",
    description: "Prepare a task-owned isolated working directory for a writing child. Launch Herdr with the returned cwd. Retain it for review; never automatically delete it.",
    parameters: Type.Object({ sourcePath: Type.Optional(Type.String({ description: 'Relative canonical subdirectory inside the selected project; defaults to the whole project.' })) }),
    async execute(_id, args, _signal, _update, ctx) {
      try {
        if (!task || task.projectRoot !== path.resolve(ctx.cwd)) throw new Error("Select a workflow for this project first.");
        if (args.sourcePath && path.isAbsolute(args.sourcePath)) throw new Error('Use a relative source path inside the selected project.');
        const projectRoot = fs.realpathSync(task.projectRoot);
        const sourceRoot = path.resolve(projectRoot, args.sourcePath ?? '.');
        if ((sourceRoot !== projectRoot && !sourceRoot.startsWith(`${projectRoot}${path.sep}`)) || fs.realpathSync(sourceRoot) !== sourceRoot) throw new Error('Source path escapes the project or uses a symbolic-link alias.');
        const record = prepareIsolation({ sourceRoot, storeRoot: path.join(path.dirname(revisionStore), "workflow-isolation"), taskId: task.taskId });
        task.isolations ??= [];
        task.isolations.push(record);
        append(pi, "updated", task);
        return { content: text(`Isolated ${record.kind} ready. Launch exactly one child with cwd: ${record.cwd}`), details: record };
      } catch (error) { return { content: text(String(error)), isError: true }; }
    },
  });

  pi.registerTool({
    name: "workflow_resource",
    label: "Load pinned workflow resource",
    description: "Recover the active task's selected workflow or a principle from its pinned revision after resume or compaction.",
    parameters: Type.Object({ principle: Type.Optional(Type.String()) }),
    async execute(_id, args) {
      try {
        if (!task) throw new Error("No active workflow task.");
        const { resourceRoot } = loadPinnedRevision({ revisionId: task.revision, resourceRoot: task.resourceRoot ?? path.join(root, 'workflows'), packageRoot: root, storeRoot: revisionStore });
        if (!args.principle) return { content: text(loadRoute(task.route, resourceRoot)), details: { revision: task.revision } };
        if (!PRINCIPLE_NAMES.includes(args.principle)) throw new Error("Unknown trusted principle.");
        return { content: text(fs.readFileSync(path.resolve(resourceRoot, "..", "principles", `${args.principle}.md`), "utf8")), details: { revision: task.revision } };
      } catch (error) { return { content: text(String(error)), isError: true }; }
    },
  });

  pi.registerTool({
    name: "workflow_update",
    label: "Record workflow evidence",
    description: "Record a workflow stage, verification outcome, or user correction as compact durable evidence.",
    promptSnippet: "Record actual workflow stage changes and verification outcomes.",
    parameters: Type.Object({
      taskId: Type.Optional(Type.String({ description: "Optional task ID from workflow_select; omitted values use the active task." })),
      action: Type.String({ description: "stage, verification, or correction" }),
      value: Type.Optional(Type.String()),
      check: Type.Optional(Type.String()),
      result: Type.Optional(Type.String()),
      paths: Type.Optional(Type.Array(Type.String(), { maxItems: 30 })),
    }),
    async execute(_id, args, _signal, _update, ctx) {
      try {
        if (!task || (args.taskId && task.taskId !== args.taskId)) throw new Error("No matching active task.");
        if (args.action === "verification" && !["passed", "failed", "skipped", "unavailable", "inconclusive"].includes(args.result)) throw new Error("Verification result must be passed, failed, skipped, unavailable, or inconclusive.");
        applyUpdate(task, args);
        append(pi, "updated", task);
        scheduler.arm(task.waits ?? []);
        renderStatus(ctx);
        return { content: text(`Recorded ${args.action} for ${task.route}.`), details: { taskId: task.taskId, stage: task.stage } };
      } catch (error) {
        return { content: text(error instanceof Error ? error.message : String(error)), details: undefined, isError: true };
      }
    },
  });

  pi.events.on("workflow:candidate-build-request", (request) => {
    if (!request || request.approvedBy !== "observer-ui-build-action") return;
    if (request.targetKind !== "workflow-resource") return;
    request.eligible = true;
    try {
      request.result = beginCandidate({ ...request, packageRoot: root, storeRoot: revisionStore });
    } catch (error) {
      request.error = error instanceof Error ? error.message : String(error);
    }
  });

  pi.registerTool({
    name: 'workflow_candidate_context',
    label: 'Inspect candidate evaluation requirements',
    description: 'Read the approved inactive candidate digest, baseline revision and behavioral scenario checklist. Does not run tests or authorize more agents.',
    parameters: Type.Object({}),
    async execute(_id, _args, _signal, _update, ctx) {
      try {
        const candidateId = findBuildingCandidate(ctx.cwd, { storeRoot: revisionStore, statuses: ['building','failed','verified'] });
        if (!candidateId) throw new Error('This directory is not an approved inactive candidate.');
        const context = candidateEvaluationContext({ candidateId, storeRoot: revisionStore, coordinatorSessionId: candidateCoordinator(ctx), bindCoordinator: true });
        return { content: text(JSON.stringify(context)), details: context };
      } catch (error) { return { content: text(String(error)), isError: true }; }
    },
  });

  pi.registerTool({
    name: 'workflow_candidate_acceptance',
    label: 'Submit candidate behavioral evidence',
    description: 'Top-level coordinator only: submit actual behavioral scenario, independent review and paired pilot evidence. Does not run tests or activate a revision. Never submit synthetic evidence as real acceptance.',
    parameters: Type.Object({ report: Type.Any() }),
    async execute(_id, args, _signal, _update, ctx) {
      try {
        const coordinatorSessionId = candidateCoordinator(ctx);
        if (task?.childRuns.some(run => run.status === 'active')) throw new Error('Wait for all owned evaluator/reviewer children before submitting acceptance.');
        const candidateId = findBuildingCandidate(ctx.cwd, { storeRoot: revisionStore, statuses: ['building','failed','verified'] });
        if (!candidateId) throw new Error('This directory is not an approved inactive candidate.');
        const result = submitBehavioralReport({ candidateId, report: args.report, storeRoot: revisionStore, coordinatorSessionId });
        return { content: text('Evidence submitted; final settlement still checks the exact candidate and does not imply activation.'), details: result };
      } catch (error) { return { content: text(String(error)), isError: true }; }
    },
  });

  pi.registerTool({
    name: "workflow_candidate_complete",
    label: "Mark candidate build complete",
    description: "Explicitly finish an approved candidate build. Evaluation occurs only at final settlement with no active owned children.",
    parameters: Type.Object({}),
    async execute(_id, _args, _signal, _update, ctx) {
      try {
        if (task?.childRuns.some((run) => run.status === "active")) throw new Error("Owned children are still active.");
        const candidateId = completeCandidateBuild(ctx.cwd, { storeRoot: revisionStore, coordinatorSessionId: candidateCoordinator(ctx) });
        return { content: text(`Candidate ${candidateId} marked complete; no activation is claimed.`) };
      } catch (error) { return { content: text(String(error)), isError: true }; }
    },
  });

  pi.on("agent_settled", (event, ctx) => {
    const unresolved = task?.waits?.filter(j => j.status === 'checking') ?? [];
    if (unresolved.length) {
      for (const job of unresolved) job.status = 'suspended';
      append(pi, 'updated', task);
      ctx.ui?.notify?.('Conductor check outcome is ambiguous; reconcile before scheduling again.', 'warning');
      renderStatus(ctx);
    }
    try {
    if (process.env.PI_SUBAGENT_CHILD === '1' || process.env.PI_SUBAGENT_ID) return;
    if (!event.aborted && !task?.childRuns.some((run) => run.status === "active")) {
      const candidateId = findBuildingCandidate(ctx.cwd, { storeRoot: revisionStore, completedOnly: true });
      if (candidateId) {
        const coordinatorSessionId = candidateCoordinator(ctx);
        candidateEvaluationContext({ candidateId, storeRoot: revisionStore, coordinatorSessionId });
        const result = validateCandidate({ candidateId, packageRoot: root, storeRoot: revisionStore, workflowFiles: Object.values(WORKFLOW_FILES), principleNames: PRINCIPLE_NAMES });
        let behavioralError;
        if (result.passed) {
          try { acceptPendingBehavioralReport({ candidateId, storeRoot: revisionStore, coordinatorSessionId }); }
          catch (error) { behavioralError = error instanceof Error ? error.message : String(error); }
        }
        if (result.passed && !behavioralError && process.env.PI_AUTOMATIC_WORKFLOWS_ENABLE_PROMOTION === "1") {
          try {
            const active = activateCandidate({ candidateId, packageRoot: root, storeRoot: revisionStore });
            ctx.ui?.notify?.(`Workflow revision ${active.revisionId} activated for new tasks after all candidate checks passed.`, "info");
          } catch (error) {
            ctx.ui?.notify?.(`Candidate verified but was not activated: ${error instanceof Error ? error.message : String(error)}`, "warning");
          }
        } else {
          ctx.ui?.notify?.(`Workflow candidate ${candidateId.slice(0, 8)} remains inactive: ${result.passed ? behavioralError ?? "promotion release gate is not enabled" : "checks failed"}.`, "warning");
        }
      }
    }
    } catch (error) { ctx.ui?.notify?.(`Candidate evaluation failed; no activation claimed: ${String(error)}`, "warning"); }
  });

  pi.on("agent_before_settle", (event, ctx) => {
    if (event.outcome !== "completed" || event.continue || ctx.hasPendingMessages()) return;
    if (routingNeeded && !routingReminderUsed) {
      routingReminderUsed = true;
      return { continue: true, entries: [{ type: "custom_message", customType: "workflow-routing-reminder", content: "This is a substantive engineering request and no matching workflow was selected. Your next action must be workflow_select. Choose the route that preserves the user's explicit constraints, then continue only within that scope.", display: true }] };
    }
    if (!task) return;
    if (task.projectRoot !== path.resolve(ctx.cwd)) return;
    const passed = task.verification.some((record) => record.result === "passed");
    if (!passed && !routingReminderUsed && canRemind(task)) {
      task.reminderUsed = true;
      task.lastEventType = "stage";
      append(pi, "updated", task);
      renderStatus(ctx);
      return { continue: true, entries: [{ type: "custom_message", customType: "workflow-reminder", content: "Before finishing, check whether the selected workflow's required verification has actually been run. If it was explicitly skipped, unavailable, or out of scope, report that limitation and stop. Do not make unrelated changes.", display: true, details: { taskId: task.taskId } }] };
    }
    task.lastEventType = "settled";
    append(pi, "updated", task);
  });

  pi.on("tool_call", (event, ctx) => {
    if (staleWakeup) return { block: true, reason: 'Stale or duplicate Conductor wakeup; no tool actions authorized. Reconcile from a fresh owner request.' };
    const fenced = writeFence.guard(event, ctx);
    if (fenced) return fenced;
    if (!["subagent", "subagent_resume", "subagent_workflow"].includes(event.toolName)) return;
    if (event.toolName === "subagent_workflow" && ["list", "status", "cancel"].includes(event.input?.action)) return;
    if (event.toolName === "subagent" && event.input?.action) return;
    if (process.env.PI_SUBAGENT_CHILD === "1" || process.env.PI_SUBAGENT_ID) return { block: true, reason: "Nested subagent spawning is disabled for workflow child agents." };
    if (!task) return { block: true, reason: "Select a workflow before child launches so task limits can be recorded." };
    const probe = { version: 1, toolName: event.toolName, supported: false };
    pi.events.emit('workflow:child-admission-probe', probe);
    if (!probe.supported) return { block: true, reason: "This provider has no verified native launch-admission bridge; reload the updated Herdr extension before launching children." };
    if (event.toolName !== "subagent") {
      const parentModel = ctx.model && `${ctx.model.provider}/${ctx.model.id}`;
      if (!parentModel) return { block: true, reason: 'Parent model identity is unavailable.' };
      if (event.toolName === 'subagent_resume') {
        const previous = task.childRuns.findLast(run => run.sessionFile === event.input.sessionPath);
        if (!previous || task.childRuns.some(run => run.sessionFile === event.input.sessionPath && run.status === 'active')) return { block: true, reason: 'Resume requires an owned terminal session with no unresolved or active run.' };
        if (task.childRuns.length >= totalChildLimit(task)) return { block: true, reason: 'Total child limit reached; approval is required.' };
        if (task.childRuns.filter(run => run.status === 'active').length >= MAX_ACTIVE_CHILDREN) return { block: true, reason: 'Active child limit reached.' };
        const modelError = authorizeModel(event.input, parentModel, previous);
        if (modelError) return { block: true, reason: modelError };
        // Saved model/cwd are checked at the native pre-artifact admission boundary.
        event.input._workflowTaskId = task.taskId;
        return;
      }
      const steps = event.input.steps;
      if (!['parallel','chain'].includes(event.input.mode) || !Array.isArray(steps) || !steps.length || steps.length > 16 || new Set(steps.map(step => step?.key)).size !== steps.length) return { block: true, reason: 'Use a bounded parallel/chain workflow with unique step keys.' };
      if (task.childRuns.length + steps.length > totalChildLimit(task)) return { block: true, reason: 'Requested workflow exceeds remaining total child budget.' };
      if (task.childRuns.filter(run => run.status === 'active').length + (event.input.mode === 'parallel' ? steps.length : 1) > MAX_ACTIVE_CHILDREN) return { block: true, reason: 'Requested workflow exceeds active child capacity.' };
      const writerDirectories = new Set();
      for (const step of steps) {
        if (!step || typeof step.task !== 'string' || typeof step.key !== 'string' || !step.key) return { block: true, reason: 'Invalid workflow step.' };
        const checked = inspectChild({ ...step, name: step.key }, parentModel);
        if (checked.error) return { block: true, reason: checked.error };
        if (checked.isWriter && event.input.mode === 'parallel' && writerDirectories.has(checked.isolation.cwd)) return { block: true, reason: 'Parallel writers cannot share an isolated directory.' };
        if (checked.isWriter) writerDirectories.add(checked.isolation.cwd);
        step.model ??= profileModel(step.agent) ?? parentModel;
        step._workflowTaskId = task.taskId;
      }
      // Every actual internal stage reserves a slot through native admission.
      return;
    }
    const count = requestedLaunches(event.input);
    if (count < 0) return { block: true, reason: "Workflow-script fanout cannot be bounded by this controller. Use explicit parallel tasks so spawn limits can be enforced." };
    if (!count) return;
    const parentModel = ctx.model && `${ctx.model.provider}/${ctx.model.id}`;
    if (!parentModel) return { block: true, reason: "Parent model identity is unavailable; cannot verify child model inheritance." };
    const modelError = authorizeModel(event.input, parentModel);
    if (modelError) return { block: true, reason: modelError };
    event.input.model ??= profileModel(event.input.agent) ?? parentModel;
    event.input._workflowTaskId = task.taskId;
    const isWriter = isLikelyCodeWriter(event.input);
    const isolation = task.isolations?.find((record) => record.cwd === event.input.cwd && validateIsolation(record, { taskId: task.taskId }));
    const isolated = !!isolation;
    if (isWriter && (!isolated || count !== 1)) return { block: true, reason: "Prepare an owned isolated directory with workflow_prepare_child, then launch one writer using its exact cwd." };
    if (isWriter && task.childRuns.some((run) => run.isolationId === isolation.id && run.status === "active")) return { block: true, reason: "An active writer already owns this isolated directory." };
    const reservationIds = Array.from({ length: count }, () => `reservation-${crypto.randomUUID()}`);
    const reservation = reserveChildRuns(task, reservationIds.map((childId) => ({ childId, role: isWriter ? "writer" : "unknown", isolated, isolationId: isolation?.id, requestName: event.input.name, requestedCwd: event.input.cwd ?? ctx.cwd })));
    if (!reservation.allowed) return { block: true, reason: reservation.reason };
    launchReservations.set(event.toolCallId, reservationIds);
    append(pi, "updated", task);
  });

  function inspectChild(input, parentModel, previous, ignoreReservation) {
    const error = authorizeModel(input, parentModel, previous);
    if (error) return { error };
    const isWriter = previous?.role === 'writer' || isLikelyCodeWriter(previous ? { task: input.message ?? '' } : input);
    const cwd = previous ? previous.requestedCwd : input.cwd;
    const isolation = task?.isolations?.find(record => record.cwd === cwd && validateIsolation(record, { taskId: task.taskId }));
    if (isWriter && !isolation) return { error: 'Writing children require an owned isolated directory.' };
    if (isWriter && task.childRuns.some(run => run.childId !== ignoreReservation && run.isolationId === isolation.id && run.status === 'active')) return { error: 'An active writer already owns this isolated directory.' };
    return { isWriter, isolation };
  }

  pi.events.on('workflow:child-admission', request => {
    if (!request || request.version !== 1) return;
    request.handled = true;
    const deny = reason => { request.allowed = false; request.reason = reason; };
    if (process.env.PI_SUBAGENT_CHILD === '1' || process.env.PI_SUBAGENT_ID) return deny('Nested child launches are disabled.');
    if (!task || path.resolve(request.parentCwd ?? '') !== task.projectRoot) return deny('No matching parent workflow task.');
    if (!['spawn','resume'].includes(request.kind) || !request.id || !request.sessionFile || !request.input) return deny('Malformed native admission request.');
    if (request.input._workflowTaskId !== task.taskId) return deny('Launch belongs to a stale or unapproved workflow task.');
    if (task.childRuns.some(run => run.runtimeId === request.id)) return deny('Duplicate runtime launch identity.');
    const previous = request.kind === 'resume' ? task.childRuns.findLast(run => run.sessionFile === request.sessionFile) : undefined;
    if (request.kind === 'resume' && (!previous || task.childRuns.some(run => run.sessionFile === request.sessionFile && run.status === 'active'))) return deny('Resume requires an owned terminal session.');
    if (!request.model) return deny('Resolved child model is unavailable.');
    const modelError = authorizeModel(request.input, request.parentModel, previous, request.model);
    if (modelError) return deny(modelError);
    if (previous && previous.requestedCwd !== request.cwd) return deny('Saved resume directory differs from its owned directory.');
    const ids = launchReservations.get(request.toolCallId) ?? [];
    let run = task.childRuns.find(item => ids.includes(item.childId) && item.status === 'active' && !item.runtimeId);
    const checked = inspectChild({ ...request.input, cwd: request.cwd }, request.parentModel, previous, run?.childId);
    if (checked.error) return deny(checked.error);
    if (!run) {
      const childId = `native-${request.id}`;
      const result = reserveChildRuns(task, [{ childId, role: checked.isWriter ? 'writer' : 'unknown', isolated: !!checked.isolation, isolationId: checked.isolation?.id, requestName: request.name, requestedCwd: request.cwd }]);
      if (!result.allowed) return deny(result.reason);
      run = task.childRuns.at(-1);
    }
    run.modelSelector = childSelector(request.input, previous);
    run.runtimeId = request.id;
    run.sessionFile = request.sessionFile;
    run.requestedCwd = request.cwd;
    if (request.kind === 'resume') run.resumedFrom = previous.childId;
    append(pi, 'updated', task);
    request.allowed = true;
  });

  const interruptOwned = () => {
    for (const run of task?.childRuns ?? []) {
      if (run.status !== "active" || !run.runtimeId) continue;
      run.needsAttention = true;
      try { pi.events.emit("workflow:child-interrupt-request", { version: 1, id: run.runtimeId }); }
      catch { run.lifecycleStatus = "unresolved"; }
    }
    if (task) append(pi, "updated", task);
  };
  pi.on("agent_end", (_event, ctx) => { if (ctx.signal?.aborted) interruptOwned(); });

  pi.events.on("workflow:child-lifecycle", (record) => {
    if (applyChildLifecycle(task, record)) append(pi, "updated", task);
  });

  pi.events.on(SUBAGENT_COMPLETE, (payload) => {
    if (!task || !recordChildComplete(task, payload)) return;
    append(pi, "updated", task);
  });

  pi.on("tool_result", (event) => {
    if (event.toolName !== "subagent" || !task) return;
    const reservationIds = launchReservations.get(event.toolCallId) ?? [];
    if (event.details?.status === "started" && event.details?.id) {
      const run = task.childRuns.find((item) => reservationIds.includes(item.childId));
      if (run) {
        run.runtimeId = event.details.id;
        run.sessionFile = event.details.sessionFile ?? run.sessionFile;
      }
    }
    recordChildToolResult(task, reservationIds);
    launchReservations.delete(event.toolCallId);
    append(pi, "updated", task);
  });

  pi.on("message_end", (event) => {
    const message = event.message;
    if (!task || message?.customType !== "subagent_result" || !message.details?.sessionFile || message.details.status === "unresolved") return;
    const details = message.details;
    if (details.disposition && !["completed", "completed-user-exit", "launch-failed", "crashed", "pane-killed"].includes(details.disposition) && !(details.disposition === "gap-exit" && Number.isInteger(details.exitCode))) return;
    const candidates = task.childRuns.filter((item) => item.sessionFile === details.sessionFile && (details.id ? item.runtimeId === details.id : item.status === "active" && !item.resumedFrom));
    const run = candidates.length === 1 ? candidates[0] : undefined;
    if (run) { run.status = "completed"; append(pi, "updated", task); }
  });

  const conductorCommand = {
    description: "Inspect and control Conductor",
    handler: async (args, ctx) => {
      const [action = "status", value] = args.trim().split(/\s+/);
      if (action === 'jobs') {
        ctx.ui.notify(JSON.stringify(task?.waits ?? [], null, 2), 'info');
      } else if (action === 'cancel') {
        const job = task?.waits?.find(j => j.id === value);
        if (job) { job.status = 'cancelled'; append(pi, 'updated', task); scheduler.arm(task.waits); }
        ctx.ui.notify(job ? 'Check cancelled; external work is unchanged.' : 'Unknown job.', 'info');
      } else if (action === "off" || action === "on") {
        enabled = action === "on";
        pi.appendEntry(ENTRY_TYPE, { schemaVersion: 1, action: "setting", enabled });
        if (!enabled) scheduler.stop(); else scheduler.arm(task?.waits ?? []);
        renderStatus(ctx);
        ctx.ui.notify(`Conductor ${enabled ? "enabled" : "disabled"} for this session.`, "info");
      } else if (action === "use" && value && WORKFLOWS[value]) {
        forcedNextRoute = value;
        ctx.ui.notify(`Next workflow selection will use ${WORKFLOWS[value].label}.`, "info");
      } else if (action === "recover-lock") {
        try {
          const result = recoverPromotionLock({ storeRoot: revisionStore });
          ctx.ui.notify(`Dead-owner lock archived at ${result.archived}. No candidate was activated.`, "info");
        } catch (error) { ctx.ui.notify(String(error), "warning"); }
      } else if (action === "rollback") {
        try {
          const result = rollbackRevision({ packageRoot: root, storeRoot: revisionStore });
          ctx.ui.notify(result.rolledBack ? `New tasks will use revision ${result.revisionId}.` : result.reason, result.rolledBack ? "info" : "warning");
        } catch (error) {
          ctx.ui.notify(`Workflow revision rollback failed: ${error instanceof Error ? error.message : String(error)}`, "warning");
        }
      } else if (action === "status") {
        let activeRevision;
        try { activeRevision = loadActiveRevision({ packageRoot: root, storeRoot: revisionStore }).revisionId; }
        catch (error) { activeRevision = `invalid: ${error instanceof Error ? error.message : String(error)}`; }
        ctx.ui.notify(JSON.stringify({ enabled, optedOut: optedOut(ctx.cwd), activeRevision, activeTask: task ? { route: task.route, stage: task.stage, scope: task.scope, revision: task.revision, verification: task.verification, childCount: task.childRuns?.length ?? 0, childTotalLimit: totalChildLimit(task), childActiveLimit: MAX_ACTIVE_CHILDREN } : null, routes: Object.keys(WORKFLOWS).length, principles: PRINCIPLE_NAMES.length }, null, 2), "info");
      } else {
        ctx.ui.notify("Usage: /conductor status | jobs | cancel <id> | on | off | use <route> | rollback | recover-lock", "warning");
      }
    },
  };
  pi.registerCommand('workflow', conductorCommand);
  pi.registerCommand('conductor', conductorCommand);
}
