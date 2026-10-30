// Persisted shape/precedence mirrors rpiv-todo state/replay.ts without a private dependency import.
interface TodoTask {
 id: number;
 subject: string;
 status: "pending" | "in_progress" | "completed" | "deleted";
 description?: string;
 activeForm?: string;
 owner?: string;
 blockedBy?: number[];
 metadata?: object;
}
interface TodoSnapshot { tasks: TodoTask[]; nextId: number }

function isSnapshot(value: unknown): value is TodoSnapshot {
 if (!value || typeof value !== "object") return false;
 const v = value as Record<string, unknown>;
 return Number.isSafeInteger(v.nextId) && Array.isArray(v.tasks) && v.tasks.every((task: unknown) => {
  if (!task || typeof task !== "object") return false;
  const t = task as Record<string, unknown>;
  return Number.isSafeInteger(t.id) && typeof t.subject === "string" &&
   ["pending", "in_progress", "completed", "deleted"].includes(t.status as string) &&
   [t.description, t.activeForm, t.owner].every((s) => s === undefined || typeof s === "string") &&
   (t.blockedBy === undefined || (Array.isArray(t.blockedBy) && t.blockedBy.every(Number.isSafeInteger))) &&
   (t.metadata === undefined || (typeof t.metadata === "object" && t.metadata !== null));
 });
}

/** Undefined means no persisted state, not an explicitly cleared list. */
export function captureTodoSnapshot(branch: Iterable<unknown>): TodoSnapshot | undefined {
 let authoritative: TodoSnapshot | undefined;
 let legacy: TodoSnapshot | undefined;
 for (const entry of branch) {
  const e = entry as { type?: string; customType?: string; data?: unknown; message?: { role?: string; toolName?: string; details?: unknown } };
  if (e.type === "custom" && e.customType === "rpiv-todo-state" && isSnapshot(e.data)) authoritative = e.data;
  if (e.type === "message" && e.message?.role === "toolResult" && e.message.toolName === "todo" && isSnapshot(e.message.details)) legacy = e.message.details;
 }
 const snapshot = authoritative ?? legacy;
 return snapshot === undefined ? undefined : structuredClone(snapshot);
}
