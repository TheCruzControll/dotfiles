import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { createRequire } from "node:module";
import { captureTodoSnapshot } from "../lib/todo-transfer.ts";

const state = {
 tasks: ["pending", "in_progress", "completed", "deleted"].map((status, i) => ({
  id: i + 7, subject: `Task ${i}`, status, description: "detail", activeForm: "working",
  owner: "owner", blockedBy: [2, 4], metadata: { nested: { values: [1, "x"] } },
 })), nextId: 22,
};
const entry = (data: unknown) => ({ type: "custom", customType: "rpiv-todo-state", data });
const result = (details: unknown) => ({ type: "message", message: { role: "toolResult", toolName: "todo", details } });

test("copies exact authoritative snapshot, ignoring later results and invalid entries", () => {
 const original = structuredClone(state);
 const copy = captureTodoSnapshot([entry(original), result({ tasks: [], nextId: 1 }), entry({ tasks: ["bad"], nextId: 99 })]);
 assert.deepEqual(copy, state);
 assert.notEqual(copy, original);
 (copy!.tasks[0].metadata as any).nested.values.push("changed");
 copy!.tasks[0].blockedBy!.push(8);
 assert.deepEqual(original, state);
});

test("clear, no snapshot, legacy fallback and latest valid state", () => {
 assert.equal(captureTodoSnapshot([]), undefined);
 assert.equal(captureTodoSnapshot([entry({ tasks: [], nextId: 1.5 })]), undefined);
 assert.deepEqual(captureTodoSnapshot([result(state), entry({ tasks: [], nextId: 22 }), result(state)]), { tasks: [], nextId: 22 });
 assert.deepEqual(captureTodoSnapshot([result({ tasks: [], nextId: 1 }), result(state), entry({ tasks: [{ id: 1, subject: "bad", status: "unknown" }], nextId: 2 })]), state);
 assert.deepEqual(captureTodoSnapshot([entry(state), entry({ tasks: [], nextId: 23 })]), { tasks: [], nextId: 23 });
});

test("command captures immediately before switch and seeds only in setup", async () => {
 const source = await readFile(new URL("../extensions/durable-handoff.ts", import.meta.url), "utf8");
 assert.match(source, /const todoSnapshot = captureTodoSnapshot\(ctx.sessionManager.getBranch\(\)\);\s*const result = await ctx.newSession/);
 assert.match(source, /setup: async \(sessionManager\) => \{\s*if \(todoSnapshot\) sessionManager.appendCustomEntry\("rpiv-todo-state", todoSnapshot\);\s*\}/);
 assert.match(source, /Use the existing todo list; do not recreate/);
});

test("real Pi SessionManager and installed todo replay (opt-in host integration)", { skip: !process.env.PI_CODING_AGENT_DIR || !process.env.RPIV_TODO_DIR }, async () => {
 const { SessionManager } = await import(pathToFileURL(`${process.env.PI_CODING_AGENT_DIR}/dist/core/session-manager.js`).href);
 const hostRequire = createRequire(`${process.env.PI_CODING_AGENT_DIR}/package.json`);
 const { createJiti } = hostRequire("jiti");
 const jiti = createJiti(import.meta.url);
 const { replayFromBranch, isTaskDetails } = await jiti.import(`${process.env.RPIV_TODO_DIR}/state/replay.ts`);
 const { loadExtensions } = await import(pathToFileURL(`${process.env.PI_CODING_AGENT_DIR}/dist/core/extensions/loader.js`).href);
 const loaded = await loadExtensions([new URL("../extensions/durable-handoff.ts", import.meta.url).pathname], process.cwd());
 assert.deepEqual(loaded.errors, []);
 assert.equal(loaded.extensions.length, 1);
 const { AgentSessionRuntime } = await import(pathToFileURL(`${process.env.PI_CODING_AGENT_DIR}/dist/core/agent-session-runtime.js`).href);
 // Exercise the installed cancellation gate without creating a live runtime.
 const sourceOnCancel = SessionManager.inMemory();
 sourceOnCancel.appendCustomEntry("rpiv-todo-state", state);
 const beforeCancel = structuredClone(sourceOnCancel.getBranch());
 const cancelled = await AgentSessionRuntime.prototype.newSession.call({
  emitBeforeSwitch: async () => ({ cancelled: true }),
  session: { sessionManager: sourceOnCancel },
 }, { setup: async () => assert.fail("setup must not run on cancellation") });
 assert.deepEqual(cancelled, { cancelled: true });
 assert.deepEqual(sourceOnCancel.getBranch(), beforeCancel);
 for (const branch of [[entry(state), result({ tasks: [], nextId: 1 })], [entry({ tasks: [], nextId: 22 })], [result(state)], []]) {
  const snapshot = captureTodoSnapshot(branch);
  const source = SessionManager.inMemory();
  for (const e of branch) {
   if (e.type === "custom") source.appendCustomEntry(e.customType, e.data);
   else source.appendMessage(e.message);
  }
  const before = structuredClone(source.getBranch());
  const replacement = SessionManager.inMemory();
  if (snapshot) {
   assert.equal(isTaskDetails(snapshot), true);
   replacement.appendCustomEntry("rpiv-todo-state", snapshot);
  }
  assert.deepEqual(replayFromBranch({ sessionManager: replacement }), replayFromBranch({ sessionManager: source }));
  assert.deepEqual(source.getBranch(), before);
  assert.equal(replacement.getBranch().length, snapshot ? 1 : 0);
 }
});
