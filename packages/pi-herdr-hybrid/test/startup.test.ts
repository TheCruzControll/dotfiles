import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import childExtension from '../subagent-done.ts';
import { watchSubagent, type RunningSubagent } from '../src/watcher.ts';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function fixture(initialPhase?: string) {
  const dir = mkdtempSync(join(tmpdir(), 'startup-'));
  const running: RunningSubagent = { id: 'new-runtime', name: 'worker', task: '', paneId: 'p', startTime: Date.now(), sessionFile: join(dir, 'session.jsonl'), launchScriptFile: '', interactive: false, autoExit: true };
  if (initialPhase) writeFileSync(`${running.sessionFile}.startup`, JSON.stringify({ id: running.id, sessionFile: running.sessionFile, phase: initialPhase }));
  const controller = new AbortController();
  const states: string[] = [];
  let subscriptions = 0;
  const promise = watchSubagent(running, {
    client: { paneGet: async () => ({} as any), paneList: async () => [], paneRead: async () => null },
    stream: { watch: () => { subscriptions++; return () => { subscriptions--; }; }, onReconcile: () => () => {} },
    signal: controller.signal, startupTimeoutMs: 25, pollIntervalMs: 5,
    onStartup: state => states.push(state),
  });
  return { running, states, promise, signal: (id = running.id, phase = 'ready', sessionFile = running.sessionFile) => writeFileSync(`${running.sessionFile}.startup`, JSON.stringify({ id, phase, sessionFile })),
    close: async () => { controller.abort(); await promise; assert.equal(subscriptions, 0); rmSync(dir, { recursive: true, force: true }); } };
}

it('child lifecycle emits runtime identity and execution evidence', async () => {
  const f = fixture();
  const previous = { id: process.env.PI_SUBAGENT_ID, session: process.env.PI_SUBAGENT_SESSION };
  try {
    process.env.PI_SUBAGENT_ID = f.running.id;
    process.env.PI_SUBAGENT_SESSION = f.running.sessionFile;
    const handlers = new Map<string, Function>();
    childExtension({ on: (name: string, fn: Function) => handlers.set(name, fn), registerTool() {}, registerShortcut() {}, getAllTools: () => [] } as any);
    handlers.get('session_start')!({}, { ui: { setWidget() {} } });
    assert.equal(JSON.parse(readFileSync(`${f.running.sessionFile}.startup`, 'utf8')).phase, 'ready');
    handlers.get('agent_start')!();
    await delay(15);
    assert.deepEqual(f.states, ['executing']);
  } finally {
    if (previous.id === undefined) delete process.env.PI_SUBAGENT_ID; else process.env.PI_SUBAGENT_ID = previous.id;
    if (previous.session === undefined) delete process.env.PI_SUBAGENT_SESSION; else process.env.PI_SUBAGENT_SESSION = previous.session;
    await f.close();
  }
});

it('timeout is nonterminal, rejects stale resume id/session, then accepts late readiness once', async () => {
  const f = fixture();
  try {
    f.signal('previous-runtime');
    await delay(45);
    assert.deepEqual(f.states, ['unconfirmed']);
    f.signal(f.running.id, 'ready', '/wrong/session');
    await delay(15);
    assert.deepEqual(f.states, ['unconfirmed']);
    f.signal();
    await delay(15);
    f.signal();
    await delay(15);
    assert.deepEqual(f.states, ['unconfirmed', 'ready']);
    writeFileSync(`${f.running.sessionFile}.exit`, JSON.stringify({ type: 'done', summary: 'late completion' }));
    assert.equal((await f.promise).kind, 'completed');
  } finally { await f.close(); }
});

it('signal before watcher microtask is accepted, cancellation clears watchdog', async () => {
  const f = fixture('ready'); // signal predates watcher installation (also recovery)
  await delay(10);
  assert.deepEqual(f.states, ['ready']);
  await f.close();
  await delay(35);
  assert.deepEqual(f.states, ['ready']);
  const cancelled = fixture();
  await cancelled.close();
  await delay(35);
  assert.deepEqual(cancelled.states, []);
});

it('terminal evidence before ready suppresses readiness and timeout', async () => {
  const f = fixture();
  try {
    f.signal();
    writeFileSync(`${f.running.sessionFile}.exit`, JSON.stringify({ type: 'done', summary: 'done' }));
    assert.equal((await f.promise).kind, 'completed');
    await delay(35);
    assert.deepEqual(f.states, []);
  } finally { await f.close(); }
});
