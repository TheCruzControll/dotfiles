import type { SubagentOutcome } from './watcher.ts';
import type { RecoveryDescriptor } from './recovery.ts';

export const CHILD_LIFECYCLE = 'workflow:child-lifecycle';
export type ChildLifecycleStatus = 'started' | 'interrupt-requested' | 'completed' | 'failed' | 'unresolved';
export interface ChildIdentity { id: string; name: string; sessionFile: string; paneId?: string; recovery?: RecoveryDescriptor }
export interface ChildLifecycleRecord extends ChildIdentity {
  version: 1;
  status: ChildLifecycleStatus;
  timestamp: string;
  reason?: string;
}

/** Observation loss is not proof that the owned process stopped. */
export function outcomeStatus(outcome: SubagentOutcome): ChildLifecycleStatus {
  switch (outcome.kind) {
    case 'completed': case 'completed-user-exit': return 'completed';
    case 'launch-failed': case 'crashed': case 'pane-killed': return 'failed';
    case 'gap-exit': return outcome.exitCode === null ? 'unresolved' : outcome.exitCode === 0 ? 'completed' : 'failed';
    default: return 'unresolved';
  }
}

export function recordChildLifecycle(
  pi: { appendEntry(type: string, data: unknown): void; events: { emit(type: string, data: unknown): void } },
  child: ChildIdentity, status: ChildLifecycleStatus, reason?: string,
): ChildLifecycleRecord {
  const record: ChildLifecycleRecord = {
    version: 1, id: child.id, name: child.name, sessionFile: child.sessionFile,
    ...(child.paneId ? { paneId: child.paneId } : {}), ...(child.recovery ? { recovery: child.recovery } : {}), status, timestamp: new Date().toISOString(),
    ...(reason ? { reason } : {}),
  };
  // Persistence and subscribers are independent: a broken consumer must not
  // break the existing launch/watcher/UI paths or suppress the durable entry.
  try { pi.appendEntry(CHILD_LIFECYCLE, record); } catch { /* best effort during teardown */ }
  try { pi.events.emit(CHILD_LIFECYCLE, record); } catch { /* subscriber isolation */ }
  return record;
}
