// The session ledger owns jobs; timers only request locally authorized checks.
export const WAIT_STATES = ['working', 'pending-review', 'approval-needed', 'accepted', 'changes-requested'];
export function scheduleWait(task, input, binding, now) {
  if (!task || task.stage === 'completed') throw new Error('Select an active task first.');
  if (!input.authorization?.trim() || !input.check?.trim() || !input.responseRef?.trim() || input.check.length > 1000 || input.authorization.length > 1000 || input.responseRef.length > 1000) throw new Error('Provide bounded authorized check and latest response reference.');
  if (!Number.isSafeInteger(input.nextDue) || !Number.isSafeInteger(input.deadline) || input.nextDue < now + 1000 || input.deadline < input.nextDue || input.deadline > now + 7 * 86400000 || !Number.isInteger(input.maxAttempts) || input.maxAttempts < 1 || input.maxAttempts > 20) throw new Error('Use a future check, deadline within seven days and 1–20 attempts.');
  task.waits ??= [];
  const equivalent = task.waits.findLast(j => j.check.trim().replace(/\s+/g, ' ').toLowerCase() === input.check.trim().replace(/\s+/g, ' ').toLowerCase() && j.authorization === input.authorization);
  if (equivalent) {
    if (equivalent.reconciliationRequired || equivalent.status === 'suspended') throw new Error('Read-only reconciliation required; use reconcile, never replay uncertain mutations.');
    input = { ...input, deadline: Math.min(input.deadline, equivalent.deadline), maxAttempts: Math.min(input.maxAttempts, equivalent.maxAttempts) };
    if (equivalent.attempts >= input.maxAttempts || input.nextDue >= input.deadline) throw new Error('Existing check budget exhausted.');
    if (['scheduled', 'checking'].includes(equivalent.status)) throw new Error('Equivalent check already outstanding.');
  }
  if (task.continuationStopped || task.waits.length >= 20 || task.externalState === 'approval-needed') throw new Error('Job limit or approval gate reached.');
  const job = { ...input, ...binding, taskId: task.taskId, revision: task.revision, attempts: equivalent?.attempts ?? 0, status: 'scheduled' };
  task.waits.push(job);
  task.externalState = 'pending-review';
  return job;
}
export function externalOutcome(task, { state, responseRef, nextDue }, now) {
  if (!WAIT_STATES.includes(state) || !responseRef?.trim() || responseRef.length > 1000) throw new Error('Record an explicit external state and response reference.');
  if (task.externalState === 'approval-needed') throw new Error('Owner must explicitly approve continuation first.');
  const checking = (task.waits ?? []).filter(j => j.status === 'checking');
  if (nextDue !== undefined && (state !== 'pending-review' || !Number.isSafeInteger(nextDue) || nextDue < now + 1000 || checking.some(j => nextDue > j.deadline))) throw new Error('Invalid next check time.');
  task.externalState = state;
  task.latestResponseRef = responseRef;
  for (const job of task.waits ?? []) {
    if (['cancelled', 'expired'].includes(job.status)) continue;
    job.responseRef = responseRef;
    if (['accepted', 'changes-requested', 'working'].includes(state)) job.status = 'cancelled';
    else if (state === 'approval-needed') job.status = 'approval-needed';
    else if (job.status === 'checking') {
      job.status = nextDue && job.attempts < job.maxAttempts ? 'scheduled' : 'suspended';
      if (nextDue) job.nextDue = nextDue;
    }
  }
}
export function eligibleWait(task, job, binding) {
  return task && task.stage !== 'completed' && task.taskId === job.taskId && task.revision === job.revision && !task.continuationStopped && task.externalState !== 'approval-needed' && job.sessionId === binding.sessionId && job.projectRoot === binding.projectRoot && (!job.branchAnchor || binding.branchIds.includes(job.branchAnchor));
}
export function reconcileWait(task, { id, responseRef, nextDue }, now) {
  const job = task.waits?.find(j => j.id === id);
  if (!job || job.status !== 'suspended' || task.externalState === 'approval-needed' || task.continuationStopped || typeof responseRef !== 'string' || !responseRef.trim() || responseRef.length > 1000) throw new Error('A suspended authorized check and read-only reconciliation reference are required.');
  if (!Number.isSafeInteger(nextDue) || nextDue < now + 1000 || nextDue >= job.deadline || job.attempts >= job.maxAttempts) throw new Error('Original deadline/attempt budget exhausted or invalid next check.');
  job.responseRef = responseRef;
  job.nextDue = nextDue;
  job.status = 'scheduled';
  delete job.reconciliationRequired;
}
export function completionGate(task) {
  if (task.externalState && task.externalState !== 'accepted') throw new Error('External submission is not acceptance; record accepted evidence before completion/cleanup.');
  if ((task.waits ?? []).some(j => !['cancelled', 'expired'].includes(j.status))) throw new Error('Cancel outstanding checks before completion/cleanup.');
}
export function createWaitScheduler({ now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, tick }) {
  let timer;
  return {
    arm(jobs) {
      this.stop();
      const due = jobs.filter(j => j.status === 'scheduled').map(j => Math.min(j.nextDue, j.deadline));
      if (!due.length) return;
      timer = setTimer(() => { timer = undefined; tick(); }, Math.min(2147483647, Math.max(0, Math.min(...due) - now())));
      timer?.unref?.();
    },
    stop() { if (timer !== undefined) clearTimer(timer); timer = undefined; },
  };
}
