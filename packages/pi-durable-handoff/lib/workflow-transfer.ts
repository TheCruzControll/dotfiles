import path from "node:path";

export interface WorkflowContinuation {
 schemaVersion: 1;
 transferId: string;
 sourceSessionId: string;
 projectRoot: string;
 task: Record<string, unknown>;
 [key: string]: unknown;
}

// Reject lossy JSON conversions (undefined, functions, dates, cycles, NaN).
function assertJson(value: unknown, ancestors = new Set<object>()): void {
 if (value === null || typeof value === "string" || typeof value === "boolean") return;
 if (typeof value === "number" && Number.isFinite(value)) return;
 if (typeof value !== "object" || ancestors.has(value)) throw new Error("Continuation must be JSON data");
 const proto = Object.getPrototypeOf(value);
 if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) throw new Error("Continuation must contain plain objects");
 ancestors.add(value);
 for (const key of Reflect.ownKeys(value)) {
  if (Array.isArray(value) && key === "length") continue;
  const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
  if (typeof key !== "string" || !descriptor.enumerable || !("value" in descriptor)) throw new Error("Invalid continuation property");
  assertJson(descriptor.value, ancestors);
 }
 if (Array.isArray(value) && (Object.keys(value).length !== value.length ||
  Object.keys(value).some((key, index) => key !== String(index)))) throw new Error("Invalid continuation array");
 ancestors.delete(value);
}

/** Ledger presence is a loss-prevention gate, never an authority source for transfer. */
export function expectsWorkflowContinuation(branch: Iterable<any>): boolean {
 let task: any;
 let transfer = false;
 for (const entry of branch) {
  if (entry?.type !== "custom") continue;
  if (entry.customType === "workflow:continuation-transfer") transfer = true;
  if (entry.customType === "automatic-workflows" && entry.data?.schemaVersion === 1 &&
   ["selected", "updated"].includes(entry.data.action) && entry.data.task) task = entry.data.task;
 }
 return task ? task.stage !== "completed" : transfer;
}

/** Transport validation only: the workflow owner validates task semantics and claims ownership. */
export function captureWorkflowContinuation(
 events: { emit(name: string, data: unknown): void }, projectRoot: string, sourceSessionId: string,
 expected = false,
): WorkflowContinuation | undefined {
 let open = true, responses = 0;
 let snapshot: WorkflowContinuation | undefined;
 let failure: unknown;
 try {
  events.emit("workflow:continuation-export", {
   projectRoot: path.resolve(projectRoot),
   respond(value: unknown) {
    if (!open) return; // Async replies cannot enter a completed export.
    responses++;
    try {
     if (responses !== 1) throw new Error("Multiple workflow continuation exporters");
     assertJson(value);
     const v = value as WorkflowContinuation;
     if (!v || Array.isArray(v) || v.schemaVersion !== 1 ||
      typeof v.transferId !== "string" || !v.transferId ||
      v.sourceSessionId !== sourceSessionId || !sourceSessionId ||
      v.projectRoot !== path.resolve(projectRoot) ||
      !v.task || typeof v.task !== "object" || Array.isArray(v.task) ||
      !Number.isSafeInteger(v.task.continuationGeneration) || (v.task.continuationGeneration as number) < 0) {
      throw new Error("Invalid workflow continuation envelope");
     }
     snapshot = JSON.parse(JSON.stringify(v));
    } catch (error) { failure = error; }
   },
  });
 } finally { open = false; }
 if (failure) throw failure;
 if (expected && !snapshot) throw new Error("Active workflow did not export a continuation; reconcile with owner");
 return snapshot;
}
