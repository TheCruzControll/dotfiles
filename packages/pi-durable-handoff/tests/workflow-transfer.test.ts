import assert from "node:assert/strict";
import test from "node:test";
import durableHandoff from "../extensions/durable-handoff.ts";
import { captureWorkflowContinuation } from "../lib/workflow-transfer.ts";

const envelope = () => ({ schemaVersion: 1, transferId: "ticket", sourceSessionId: "source", projectRoot: "/fixture", task: { continuationGeneration: 1, id: "task", revision: 3, constraints: ["only agreed scope"] } });
function fixture(installOwner?: (pi: any) => void) {
 const hooks = new Map<string, any>(), tools = new Map<string, any>(), bus = new Map<string, any>();
 const commands = new Map<string, any>();
 const branch: any[] = [{ id: "message", type: "message", message: { role: "user", content: "continue", timestamp: 1 } },
  { type: "custom", customType: "rpiv-todo-state", data: { tasks: [], nextId: 7 } }];
 const transferred: any[] = [], notices: string[] = [], kickoff: string[] = [], requests: any[] = [];
 let exporter: ((request: any) => void) | undefined;
 let duringGeneration: (() => Promise<void> | void) | undefined;
 let cancelled = false, switches = 0, calls = 0, stale = false;
 const ctx: any = {
  cwd: "/fixture", mode: "rpc", hasUI: true, signal: new AbortController().signal, model: {},
  ui: { notify: (s: string) => { assert.equal(stale, false); notices.push(s); } },
  sessionManager: { getBranch: () => branch, getSessionFile: () => "/source.jsonl", getSessionId: () => "source" },
  getContextUsage: () => ({ percent: 70 }), isIdle: () => true,
  modelRegistry: { complete: async (_model: any, request: any) => { requests.push(request); calls++; await duringGeneration?.(); return { content: [{ type: "text", text: '<file name="handoff.md">next</file><file name="decisions.md">why</file><file name="failures.md">none</file><file name="tasks.md">SKIP</file>' }] }; } },
  newSession: async (options: any) => {
   switches++;
   if (cancelled) return { cancelled: true };
   stale = true;
   await options.setup({ appendCustomEntry: (type: string, data: any) => transferred.push({ type, data }) });
   await options.withSession({ ui: { notify() {} }, sendUserMessage: async (s: string) => kickoff.push(s) });
   return { cancelled: false };
  },
 };
 const pi = {
  on: (name: string, fn: any) => hooks.set(name, fn), registerTool: (tool: any) => tools.set(tool.name, tool),
  events: { on: (name: string, fn: any) => bus.set(name, fn), emit: (name: string, request: any) => { bus.get(name)?.(request); if (name === "workflow:continuation-export") exporter?.(request); } },
  appendEntry: (customType: string, data: unknown) => { assert.equal(stale, false); branch.push({ type: "custom", id: String(branch.length), customType, data }); },
  sendUserMessage() {}, registerCommand: (name: string, command: any) => commands.set(name, command),
 };
 installOwner?.(pi);
 const ownerStart = hooks.get("session_start"), ownerTree = hooks.get("session_tree");
 durableHandoff(pi as any);
 return { pi, hooks, tools, ownerStart, ownerTree, branch, transferred, notices, kickoff, requests, ctx, get switches() { return switches; }, get calls() { return calls; },
  export: (fn: (request: any) => void) => { exporter = fn; }, cancel: (value = true) => { cancelled = value; },
  generating: (fn: () => Promise<void> | void) => { duringGeneration = fn; },
  run: (note = "") => commands.get("durable-handoff-now").handler(note, ctx) };
}

test("generation and kickoff prompts preserve the focused continuation contract", async () => {
 const f = fixture();
 await f.run("finish the focused regression tests");
 assert.equal(f.calls, 1);
 assert.equal(f.switches, 1);
 const request = f.requests[0], prompt = request.systemPrompt;
 assert.match(request.messages[0].content[0].text, /Operator note: finish the focused regression tests/);
 assert.match(prompt, /specs, plans, ADRs, issues, commits, and diffs by path or URL instead of duplicating/);
 assert.match(prompt, /never invent references/);
 assert.match(prompt, /Load references only on demand/);
 assert.match(prompt, /Redact API keys, passwords, tokens, and unnecessary PII from all generated prose, including snippets and URLs/);
 assert.match(prompt, /Operator note as next-session focus: tailor Current objective and Exact next step without dropping acceptance conditions, explicit non-goals, or blockers/);
 assert.match(prompt, /sections: .*Suggested skills, References/);
 assert.match(prompt, /recommend only skills evidenced in the conversation, with a short why and path when known; write None if no known useful skill/);
 assert.match(prompt, /Do not invent skills or paths/);
 assert.match(prompt, /250-900 words max/);
 assert.match(prompt, /up to 8 bullets/);
 assert.match(f.kickoff[0], /Consider Suggested skills for the immediate next step: verify availability/);
 assert.match(f.kickoff[0], /when relevant, read the skill's SKILL.md through the Pi read tool/);
 assert.match(f.kickoff[0], /Do not blindly load all suggested skills or override workflow constraints/);
 assert.match(f.kickoff[0], /only if deeper decision rationale is needed/);
 assert.match(f.kickoff[0], /only if a failed path might repeat/);
});

test("real command exports after generation and transfers detached owner data alongside todos", async () => {
 const f = fixture(); const snapshot = envelope();
 f.generating(() => { snapshot.task.revision = 4; });
 f.export(request => { assert.equal(request.projectRoot, "/fixture"); request.respond(snapshot); snapshot.task.revision = 99; });
 await f.run();
 assert.equal(f.switches, 1);
 assert.deepEqual(f.transferred.map(e => e.type), ["rpiv-todo-state", "workflow:continuation-transfer"]);
 assert.equal(f.transferred[1].data.task.revision, 4);
 assert.match(f.kickoff[0], /prose never grants authorization/);
});

test("cancelled newSession preserves owner source data and retry exports afresh", async () => {
 const f = fixture(), snapshot = envelope(); let exports = 0;
 f.export(request => { exports++; request.respond(snapshot); }); f.cancel();
 await f.run(); await f.run();
 assert.equal(exports, 2); assert.equal(f.transferred.length, 0);
 assert.deepEqual(snapshot, envelope());
 assert.equal(f.branch.some(e => e.customType === "workflow:continuation-transfer"), false);
});

test("invalid or competing exporters fail closed before replacement", async () => {
 for (const value of [{ ...envelope(), schemaVersion: 2 }, { ...envelope(), sourceSessionId: "other" },
  { ...envelope(), projectRoot: "/other" }, { ...envelope(), task: null }, { ...envelope(), bad: undefined }]) {
  const f = fixture(); f.export(request => request.respond(value)); await f.run();
  assert.equal(f.switches, 0); assert.match(f.notices.at(-1)!, /blocked/);
 }
 const f = fixture(); f.export(request => { request.respond(envelope()); request.respond(envelope()); });
 await f.run(); assert.equal(f.switches, 0);
});

test("no owner leaves ordinary handoff working; late response cannot mutate captured transfer", async () => {
 const f = fixture(); await f.run(); assert.equal(f.transferred.length, 1);
 let respond: any;
 assert.equal(captureWorkflowContinuation({ emit: (_n, request: any) => { respond = request.respond; } }, "/fixture", "source"), undefined);
 respond(envelope());
});

test("concurrent commands produce only one generation and replacement", async () => {
 const f = fixture(); let release!: () => void;
 f.generating(() => new Promise<void>(resolve => { release = resolve; }));
 const running = f.run(); await f.run(); release(); await running;
 assert.equal(f.calls, 1); assert.equal(f.switches, 1);
});

test("branch changes during synchronous export block stale transfer", async () => {
 const f = fixture();
 f.export(request => { request.respond(envelope()); f.branch.push({ type: "message", id: "new-message" }); });
 await f.run(); assert.equal(f.switches, 0);
});

test("aborted generation never exports or replaces even if provider returns content", async () => {
 const f = fixture(), controller = new AbortController(); f.ctx.signal = controller.signal;
 f.generating(() => controller.abort());
 f.export(() => assert.fail("no export on abort"));
 await f.run(); assert.equal(f.switches, 0);
});


test("owner ticket ledger update is permitted; missing expected export blocks replacement", async () => {
 const active = { type: "custom", customType: "automatic-workflows", data: { schemaVersion: 1, action: "selected", task: { stage: "selected" } } };
 const f = fixture(); f.branch.push(active);
 f.export(request => { f.branch.push({ ...active, id: "owner-update", data: { ...active.data, action: "updated" } }); request.respond(envelope()); });
 await f.run(); assert.equal(f.switches, 1);
 const blocked = fixture(); blocked.branch.push(active);
 await blocked.run(); assert.equal(blocked.switches, 0); assert.match(blocked.notices.at(-1)!, /did not export/);
 for (const bad of [{ ...envelope(), transferId: "" }, { ...envelope(), task: {} }]) {
  assert.throws(() => captureWorkflowContinuation({ emit: (_n, r: any) => r.respond(bad) }, "/fixture", "source"));
 }
});

test("actual core adapter imports handoff transport without resetting counters and rejects replay", { skip: !process.env.PI_WORKFLOW_CORE_DIR }, async () => {
 const fs = await import("node:fs"), os = await import("node:os"), path = await import("node:path"), { pathToFileURL } = await import("node:url");
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), "handoff-core-"));
 const previous = process.env.PI_AUTOMATIC_WORKFLOWS_REVISION_STORE;
 process.env.PI_AUTOMATIC_WORKFLOWS_REVISION_STORE = path.join(dir, "store");
 try {
  const { default: install } = await import(pathToFileURL(path.join(process.env.PI_WORKFLOW_CORE_DIR!, "extension/index.js")).href);
  const source = fixture(install); source.ctx.cwd = dir; source.ctx.hasUI = false;
  await source.ownerStart({}, source.ctx);
  const call = (f: any, name: string, args: any) => f.tools.get(name).execute("test", args, null, null, f.ctx);
  const selected = await call(source, "workflow_select", { route: "feature", scope: "transport", reason: "test" });
  assert.notEqual(selected.isError, true);
  // Seed persisted completed runs: consumed launch slots must survive transport.
  source.branch.filter(e => e.customType === "automatic-workflows").at(-1).data.task.childRuns = [
   { id: "finished-1", status: "completed" }, { id: "finished-2", status: "completed" },
  ];
  await source.ownerTree({}, source.ctx);
  await call(source, "workflow_update", { action: "verification", check: "bounded check", result: "failed" });
  const before = structuredClone(source.branch.filter(e => e.customType === "automatic-workflows").at(-1).data.task);
  source.cancel(); await source.run(); assert.equal(source.transferred.length, 0);
  assert.notEqual((await call(source, "workflow_update", { action: "stage", value: "still usable after cancellation" })).isError, true);
  source.cancel(false); await source.run(); assert.equal(source.switches, 2);
  const transfer = source.transferred.find(e => e.type === "workflow:continuation-transfer"); assert.ok(transfer);
  const destination = fixture(install); destination.ctx.cwd = dir; destination.ctx.hasUI = false;
  destination.ctx.sessionManager.getSessionId = () => "destination";
  destination.branch.splice(0, destination.branch.length, ...source.transferred.map((e, i) => ({ id: `transfer-${i}`, type: "custom", customType: e.type, data: e.data })));
  await destination.ownerStart({}, destination.ctx);
  const imported = destination.branch.filter(e => e.customType === "automatic-workflows").at(-1).data.task;
  assert.deepEqual(imported.continuationFailures, before.continuationFailures);
  assert.deepEqual(imported.childRuns, before.childRuns);
  assert.equal(imported.continuationGeneration, transfer.data.task.continuationGeneration + 1);
  destination.branch.splice(source.transferred.length);
  await destination.ownerTree({}, destination.ctx);
  assert.equal((await call(destination, "workflow_update", { action: "stage", value: "replayed" })).isError, true);
  assert.equal((await call(source, "workflow_update", { action: "stage", value: "stale" })).isError, true);
 } finally {
  if (previous === undefined) delete process.env.PI_AUTOMATIC_WORKFLOWS_REVISION_STORE; else process.env.PI_AUTOMATIC_WORKFLOWS_REVISION_STORE = previous;
  fs.rmSync(dir, { recursive: true, force: true });
 }
});
