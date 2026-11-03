import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function omitUndefinedProperties(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Object.keys(value)) {
    if (value[key] === undefined && !Array.isArray(value)) delete value[key];
    else omitUndefinedProperties(value[key], seen);
  }
  return value;
}

// Task-wide authority is outside the rewindable session ledger.
export function continuationStore(root) {
  const dir = path.join(root, 'continuations');
  const file = id => {
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid continuation ticket.');
    return path.join(dir, `${id}.json`);
  };
  const authority = task => path.join(dir, `task-${crypto.createHash('sha256').update(JSON.stringify([task.projectRoot, task.taskId])).digest('hex')}.json`);
  const read = filename => JSON.parse(fs.readFileSync(filename, 'utf8'));
  const write = (filename, value) => {
    fs.writeFileSync(`${filename}.next`, JSON.stringify(value), { mode: 0o600 });
    fs.renameSync(`${filename}.next`, filename);
  };
  function locked(task, update) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const filename = authority(task), lock = `${filename}.lock`;
    fs.mkdirSync(lock); // Contention or an orphan lock requires reconciliation, never automatic cleanup.
    try { return update(filename, fs.existsSync(filename) ? read(filename) : null); }
    finally { fs.rmdirSync(lock); }
  }
  const matches = (task, state) => state ? state.owner === task.sessionId && state.generation === (task.continuationGeneration ?? 0) : !task.incomingTicket && !task.continuationGeneration;
  return {
    owns(task, sessionId) {
      if (!task || task.sessionId !== sessionId) return false;
      try {
        const filename = authority(task);
        return !fs.existsSync(`${filename}.lock`) && matches(task, fs.existsSync(filename) ? read(filename) : null);
      } catch { return false; }
    },
    invalidate(task) {
      if (!task) return;
      locked(task, (filename, state) => {
        if (!matches(task, state)) throw new Error('Continuation ownership transferred or stale branch.');
        const generation = (state?.generation ?? 0) + 1;
        write(filename, { owner: task.sessionId, generation, pending: null });
        task.continuationGeneration = generation;
        delete task.outgoingTicket;
      });
    },
    export(task) {
      return locked(task, (filename, state) => {
        if (!matches(task, state)) throw new Error('Continuation ownership transferred or stale branch.');
        const transferId = crypto.randomUUID();
        const snapshot = { schemaVersion: 1, transferId, sourceSessionId: task.sessionId, projectRoot: task.projectRoot, task: omitUndefinedProperties(structuredClone(task)) };
        fs.writeFileSync(file(transferId), JSON.stringify({ status: 'pending', snapshot }), { flag: 'wx', mode: 0o600 });
        write(filename, { owner: task.sessionId, generation: task.continuationGeneration ?? 0, pending: transferId });
        return snapshot;
      });
    },
    import(snapshot, binding) {
      if (snapshot?.schemaVersion !== 1 || snapshot.projectRoot !== binding.projectRoot || !snapshot.sourceSessionId || snapshot.sourceSessionId === binding.sessionId || snapshot.task?.sessionId !== snapshot.sourceSessionId || snapshot.task?.projectRoot !== snapshot.projectRoot) throw new Error('Invalid continuation binding.');
      return locked(snapshot.task, (filename, state) => {
        const record = read(file(snapshot.transferId));
        if (!matches(snapshot.task, state) || state?.pending !== snapshot.transferId || JSON.stringify(record.snapshot) !== JSON.stringify(snapshot) || record.status !== 'pending') throw new Error('Stale or duplicate continuation; reconcile with owner.');
        const task = structuredClone(snapshot.task);
        task.sessionId = binding.sessionId;
        task.branchAnchor = binding.branchAnchor;
        task.continuationGeneration = state.generation + 1;
        delete task.outgoingTicket;
        task.incomingTicket = snapshot.transferId;
        for (const job of task.waits ?? []) {
          job.sessionId = binding.sessionId;
          job.branchAnchor = binding.branchAnchor;
          if (job.status === 'checking') { job.status = 'suspended'; job.reconciliationRequired = true; }
        }
        // Retire source first; interruption can reject a replay, never restore an old budget.
        write(filename, { owner: binding.sessionId, generation: task.continuationGeneration, pending: null });
        write(file(snapshot.transferId), { ...record, status: 'claimed', destination: binding.sessionId });
        return task;
      });
    },
  };
}

export function equivalentSelection(task, args, binding) {
  const normalize = value => String(value ?? '').trim().replace(/\s+/g, ' ');
  return task && task.stage !== 'completed' && task.projectRoot === binding.projectRoot && task.sessionId === binding.sessionId && task.route === args.route && normalize(task.scope) === normalize(args.scope) && JSON.stringify([...new Set(task.constraints.map(normalize))].sort()) === JSON.stringify([...new Set((args.constraints ?? []).map(normalize))].sort());
}
