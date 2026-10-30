import { statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import type { RunningSubagent } from './watcher.ts';

export interface RecoveryDescriptor {
  version: 1;
  ownerSessionFile: string;
  socketPath: string;
  socketIdentity: string;
  running: Omit<RunningSubagent, 'abortController'>;
}

/** A restarted server must not make a reused pane ID look like the old child. */
export function socketIdentity(socketPath: string): string | undefined {
  try {
    const stat = statSync(socketPath);
    if (!stat.isSocket()) return undefined;
    return `${stat.dev}:${stat.ino}:${stat.birthtimeMs}:${stat.ctimeMs}`;
  } catch { return undefined; }
}

export function captureRecovery(running: RunningSubagent, ownerSessionFile: string | undefined, socketPath: string): RecoveryDescriptor | undefined {
  const identity = socketIdentity(socketPath);
  if (!identity || !ownerSessionFile || !isAbsolute(ownerSessionFile) || !isAbsolute(socketPath)) return undefined;
  const { id, name, task, agent, paneId, startTime, sessionFile, launchScriptFile, interactive, autoExit, resumeEntryCount } = running;
  return { version: 1, ownerSessionFile, socketPath, socketIdentity: identity,
    running: { id, name, task, agent, paneId, startTime, sessionFile, launchScriptFile, interactive, autoExit, resumeEntryCount } };
}

function boundedString(value: unknown, max = 4096): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !value.includes('\0');
}

/** Pure replay: never contact a pane or execute saved launch scripts. */
export function recoverOwnedChildren(entries: readonly any[], context: { ownerSessionFile: string; socketPath: string; socketIdentity: string | undefined }): { children: RunningSubagent[]; unresolved: string[]; placementPaneIds: string[] } {
  const owned = new Map<string, { record: any; descriptor?: RecoveryDescriptor; terminal: boolean }>();
  for (const entry of entries) {
    if (entry?.type !== 'custom' || entry.customType !== 'workflow:child-lifecycle') continue;
    const record = entry.data;
    if (record?.version !== 1 || !boundedString(record.id, 128) || !boundedString(record.sessionFile) || !isAbsolute(record.sessionFile)) continue;
    if (!['started', 'interrupt-requested', 'unresolved', 'completed', 'failed'].includes(record.status)) continue;
    const previous = owned.get(record.id);
    if (previous && previous.record.sessionFile !== record.sessionFile) continue;
    if (previous?.terminal) continue;
    owned.set(record.id, { record, descriptor: record.recovery ?? previous?.descriptor, terminal: ['completed', 'failed'].includes(record.status) });
  }
  const children: RunningSubagent[] = [], unresolved: string[] = [], placementPaneIds: string[] = [];
  for (const { record, descriptor: d, terminal } of owned.values()) {
    const r = d?.running;
    if (!context.socketIdentity || d?.version !== 1 || d.ownerSessionFile !== context.ownerSessionFile || d.socketPath !== context.socketPath || d.socketIdentity !== context.socketIdentity ||
        !r || r.id !== record.id || r.sessionFile !== record.sessionFile || r.name !== record.name || r.paneId !== record.paneId ||
        !boundedString(r.name, 300) || !boundedString(r.paneId, 128) || typeof r.task !== 'string' || r.task.length > 100_000 ||
        !boundedString(r.launchScriptFile) || !isAbsolute(r.launchScriptFile) || !Number.isFinite(r.startTime) || r.startTime < 0 ||
        typeof r.interactive !== 'boolean' || typeof r.autoExit !== 'boolean' || (r.agent !== undefined && !boundedString(r.agent, 300)) ||
        (r.resumeEntryCount !== undefined && (!Number.isSafeInteger(r.resumeEntryCount) || r.resumeEntryCount < 0))) {
      if (!terminal) unresolved.push(record.id);
      continue;
    }
    // Terminal children can leave crash panes open; layout lookup prunes those already closed.
    placementPaneIds.push(r.paneId);
    if (terminal) continue;
    // Whitelist fields: never restore a persisted AbortController or extra object state.
    const { id, name, task, agent, paneId, startTime, sessionFile, launchScriptFile, interactive, autoExit, resumeEntryCount } = r;
    children.push({ id, name, task, agent, paneId, startTime, sessionFile, launchScriptFile, interactive, autoExit, resumeEntryCount });
  }
  return { children, unresolved, placementPaneIds: [...new Set(placementPaneIds)] };
}
