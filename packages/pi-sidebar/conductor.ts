export interface ConductorField { label: string; lines: string[] }

/** Display only the latest selected task on the current branch, never abandoned tasks. */
export function conductorFields(entries: readonly any[], cwd: string): ConductorField[] {
  let task: any;
  let enabled = true;
  for (const entry of entries) {
    if (entry?.type !== "custom" || entry.customType !== "automatic-workflows" || entry.data?.schemaVersion !== 1) continue;
    const record = entry.data;
    if (record.action === "setting" && typeof record.enabled === "boolean") enabled = record.enabled;
    if (record.action === "selected" && typeof record.task?.taskId === "string") task = record.task;
    if (record.action === "updated" && task && record.task?.taskId === task.taskId) task = record.task;
  }
  if (!enabled || !task || task.projectRoot !== cwd) return [];
  const fields: ConductorField[] = [];
  const add = (label: string, values: unknown[]) => {
    const lines = values.filter((value): value is string => typeof value === "string" && !!value.trim());
    if (lines.length) fields.push({ label, lines });
  };
  add("Playbook", [typeof task.route === "string" ? task.route.replace(/-/g, " ").replace(/^./, (letter: string) => letter.toUpperCase()) : undefined]);
  add("Goal", [task.scope]);
  add("Constraints", Array.isArray(task.constraints) ? task.constraints : []);
  const waits = Array.isArray(task.waits) ? task.waits : [];
  add("Waiting on", [
    ...(["pending-review", "approval-needed"].includes(task.externalState) ? [task.externalState] : []),
    ...waits.filter((job: any) => job && ["scheduled", "checking", "suspended", "approval-needed"].includes(job.status))
      .map((job: any) => typeof job.check === "string" ? `${job.status} · ${job.check}` : undefined),
  ]);
  return fields;
}
