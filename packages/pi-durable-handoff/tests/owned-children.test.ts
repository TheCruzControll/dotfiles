import assert from "node:assert/strict";
import test from "node:test";
import durableHandoff from "../extensions/durable-handoff.ts";
import { hasOwnedChildren } from "../lib/owned-children.ts";

let nextId = 0;
const child = (status: string, extra = {}) => ({ type: "custom", id: `entry-${++nextId}`, customType: "workflow:child-lifecycle", data: { version: 1, id: "runtime-1", name: "child", sessionFile: "/child.jsonl", paneId: "pane-1", status, ...extra } });
const message = () => ({ type: "message", id: `entry-${++nextId}`, message: { role: "user", content: "Continue", timestamp: 1 } });
function fixture(initial: any[] = []) {
 const hooks = new Map<string, Function>();
 const commands = new Map<string, any>();
 const events = new Map<string, Function>();
 let branch = [message(), ...initial];
 let session = "/parent.jsonl";
 const notices: string[] = [], sent: string[] = [];
 let calls = 0, switches = 0;
 let duringGeneration: (() => void) | undefined;
 const ctx: any = {
  mode: "rpc", hasUI: true, signal: new AbortController().signal, cwd: "/fixture", model: {},
  ui: { notify: (s: string) => notices.push(s) },
  sessionManager: { getBranch: () => branch, getSessionFile: () => session, getSessionId: () => "fixture" },
  getContextUsage: () => ({ percent: 45 }), isIdle: () => true,
  modelRegistry: { complete: async () => { calls++; duringGeneration?.(); return { content: [{ type: "text", text: '<file name="handoff.md">objective</file><file name="decisions.md">decisions</file><file name="failures.md">failures</file><file name="tasks.md">SKIP</file>' }] }; } },
  newSession: async (opts: any) => { switches++; await opts.setup({ appendCustomEntry() {} }); return { cancelled: false }; },
 };
 const pi: any = {
  on: (name: string, fn: Function) => hooks.set(name, fn),
  events: { on: (name: string, fn: Function) => events.set(name, fn) },
  appendEntry: (customType: string, data: unknown) => branch.push({ type: "custom", id: `entry-${++nextId}`, customType, data }),
  sendUserMessage: (s: string) => sent.push(s), registerCommand: (name: string, def: any) => commands.set(name, def),
 };
 durableHandoff(pi);
 return {
  ctx, notices, sent, get calls() { return calls; }, get switches() { return switches; },
  get created() { return branch.filter(e => e.customType === "durable-handoff-state" && e.data.status === "created").length; },
  start: () => hooks.get("session_start")!({}, ctx), turn: () => hooks.get("turn_end")!({}, ctx),
  run: (args = "--auto") => commands.get("durable-handoff-now").handler(args, ctx),
  lifecycle: (e: any) => { branch.push(e); events.get("workflow:child-lifecycle")!(e.data); },
  generation: (fn: () => void) => { duringGeneration = fn; },
  changeBranch: () => { branch = [message()]; }, changeSession: () => { session = "/other.jsonl"; branch = [message()]; },
 };
}

test("replay blocks nonterminal and unknown states; only positive exact-identity exits release", () => {
 for (const status of ["started", "launching", "ready", "interrupt-requested", "unresolved", "unknown"]) {
  const start = child(status);
  assert.equal(hasOwnedChildren([start]), true, status);
  for (const terminal of ["completed", "failed"]) {
   assert.equal(hasOwnedChildren([start, child(terminal)]), false);
   assert.equal(hasOwnedChildren([start, child(terminal), start]), false, "replayed start cannot reopen exit");
   assert.equal(hasOwnedChildren([start, child(terminal, { sessionFile: "/stale.jsonl" })]), true);
   assert.equal(hasOwnedChildren([start, child(terminal, { paneId: "stale-pane" })]), true);
  }
 }
 assert.equal(hasOwnedChildren([null, child("started", { version: 2 }), child("started", { id: null }), child("failed", { sessionFile: null })]), false);
});

test("automatic deferral is quiet, manual blocked, completion/failure queues without model turn", async () => {
 for (const terminal of ["completed", "failed"]) {
  const f = fixture([child("unresolved")]);
  await f.start(); await f.turn();
  assert.equal(f.notices.length, 1, "automatic retries do not spam");
  await f.run("");
  assert.equal(f.calls, 0); assert.equal(f.switches, 0); assert.equal(f.sent.length, 0);
  assert.equal(f.notices.length, 2, "manual command explains its block");
  f.lifecycle(child(terminal));
  assert.equal(f.sent.length, 1);
  await f.run();
  assert.equal(f.calls, 1); assert.equal(f.switches, 1);
 }
});

test("generation race discards preparation and defers replacement; terminal event allows fresh generation", async () => {
 const f = fixture();
 await f.start();
 f.generation(() => f.lifecycle(child("started")));
 await f.run();
 assert.equal(f.calls, 1); assert.equal(f.switches, 0); assert.equal(f.created, 0);
 f.lifecycle(child("completed"));
 f.generation(() => {});
 assert.equal(f.sent.length, 2);
 await f.run();
 assert.equal(f.calls, 2); assert.equal(f.switches, 1);
});

test("no-child flow unchanged and threshold queue deduplicated", async () => {
 const f = fixture(); await f.start(); await f.turn();
 assert.equal(f.sent.length, 1);
 await f.run(); assert.equal(f.switches, 1); assert.equal(f.calls, 1);
});

test("session or branch changes during generation never replace new context", async () => {
 for (const kind of ["branch", "session"]) {
  const f = fixture(); await f.start();
  f.generation(() => kind === "branch" ? f.changeBranch() : f.changeSession());
  await f.run(); assert.equal(f.switches, 0);
 }
 const f = fixture([child("started")]); await f.start();
 f.changeSession(); f.lifecycle(child("completed"));
 assert.equal(f.sent.length, 0, "old event cannot queue on unobserved new session");
 await f.start(); assert.equal(f.sent.length, 1, "other session does not inherit ownership");
});
