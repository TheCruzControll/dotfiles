import assert from "node:assert/strict";
import test from "node:test";
import { captureWorkflowContinuation } from "../lib/workflow-transfer.ts";
const capture = (extra: unknown) => captureWorkflowContinuation({ emit: (_name, request: any) => request.respond({ schemaVersion: 1, transferId: "ticket", sourceSessionId: "s", projectRoot: "/p", task: { continuationGeneration: 1 }, extra }) }, "/p", "s");
test("envelope rejects non-JSON payloads without invoking accessors", () => {
 const cycle: any = {}; cycle.self = cycle;
 const accessor = Object.defineProperty({}, "x", { enumerable: true, get() { assert.fail("must not invoke getter"); } });
 const sparse: any[] = new Array(1); (sparse as any).x = "lost";
 for (const value of [undefined, () => {}, Symbol(), 1n, NaN, Infinity, new Date(), cycle, accessor, sparse]) {
  assert.throws(() => capture(value));
 }
 assert.deepEqual(capture({ data: [null, true, 3, "safe"] })?.extra, { data: [null, true, 3, "safe"] });
});
