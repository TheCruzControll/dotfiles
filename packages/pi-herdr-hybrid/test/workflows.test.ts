import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Workflows, registerWorkflows } from '../src/workflows.ts';
function setup() {
  const launched: any[] = [], events: any[] = [];
  const manager = new Workflows(async step => { launched.push(step); return { details: { id: String(launched.length), sessionFile: `/session/${launched.length}` } }; }, run => events.push(structuredClone(run)));
  return { manager, launched, events };
}
const steps = [{key:'a',task:'first'}, {key:'b',task:'second'}];
test('chain waits for explicit completion and passes results', async () => {
  const {manager,launched,events} = setup();
  const run = await manager.start('chain', steps);
  assert.equal(launched.length,1);
  await manager.outcome('1',{kind:'completed',summary:'proof'});
  assert.equal(launched.length,2); assert.match(launched[1].task,/proof/);
  await manager.outcome('2',{kind:'completed',summary:'done'});
  assert.equal(run.status,'completed'); assert.equal(events.length,1);
  await manager.outcome('2',{kind:'completed',summary:'duplicate'});
  assert.equal(events.length,1);
});
for (const kind of ['completed-user-exit','ping','crashed','pane-killed','gap-exit','launch-failed','cancelled']) test(`${kind} blocks advancement`, async () => {
  const {manager,launched} = setup(); const run = await manager.start('chain',steps);
  await manager.outcome('1',{kind}); assert.equal(run.status,'blocked'); assert.equal(launched.length,1);
});
test('parallel collects ordered keyed results and completes only after all',async()=>{
  const {manager} = setup(); const run=await manager.start('parallel',steps);
  await manager.outcome('2',{kind:'completed',summary:'second'}); assert.equal(run.status,'running');
  await manager.outcome('1',{kind:'completed',summary:'first'}); assert.equal(run.status,'completed'); assert.equal(run.children.b.summary,'second');
});
test('cancel prevents later chain stage but retains result',async()=>{
  const {manager,launched} = setup(); const run=await manager.start('chain',steps); manager.cancel(run.id);
  await manager.outcome('1',{kind:'completed',summary:'done'}); assert.equal(run.status,'cancelled'); assert.equal(launched.length,1);
});
test('launch failure blocks and does not advance',async()=>{
  const manager=new Workflows(async()=>({details:{error:'bad'},content:[{text:'bad config'}]}),()=>{});
  const run=await manager.start('chain',steps); assert.equal(run.status,'blocked'); assert.equal(run.next,1);
});
test('immediate outcome before receipt is retained',async()=>{
  let manager: Workflows;
  manager=new Workflows(async()=>{await manager.outcome('quick',{kind:'completed',summary:'fast'}); return {details:{id:'quick'}};},()=>{});
  const run=await manager.start('parallel',[steps[0]]); assert.equal(run.status,'completed');
});
test('invalid graph fails before launch',async()=>{
  const {manager,launched}=setup(); await assert.rejects(()=>manager.start('chain',[steps[0],steps[0]])); assert.equal(launched.length,0);
});

function deferred<T = any>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('cancellation interrupts a late stage-two receipt and never advances stage three', async () => {
  const pending = deferred(); const launched: string[] = [], interrupted: string[] = [];
  const manager = new Workflows(async step => {
    launched.push(step.key);
    return step.key === 'b' ? pending.promise : { details: { id: step.key } };
  }, () => {}, async ({ id }) => { interrupted.push(id); });
  const run = await manager.start('chain', [...steps, { key: 'c', task: 'third' }]);
  const next = manager.outcome('a', { kind: 'completed' });
  assert.deepEqual(launched, ['a', 'b']);
  await manager.cancel(run.id);
  pending.resolve({ details: { id: 'b' } }); await next;
  assert.deepEqual(interrupted, ['b']);
  await manager.outcome('b', { kind: 'completed' });
  assert.equal(run.status, 'cancelled'); assert.deepEqual(launched, ['a', 'b']);
});

test('reserved object keys are enumerable workflow children', async () => {
  for (const mode of ['chain', 'parallel'] as const) {
    const { manager } = setup();
    const run = await manager.start(mode, [{ key: '__proto__', task: 'review' }, { key: 'constructor', task: 'check' }]);
    await manager.outcome('1', { kind: 'completed' }); await manager.outcome('2', { kind: 'completed' });
    assert.equal(run.status, 'completed');
    assert.deepEqual(Object.keys(run.children), ['__proto__', 'constructor']);
    assert.equal(JSON.parse(JSON.stringify(run)).children.__proto__.kind, 'completed');
  }
});

for (const lifecycle of ['session_start', 'session_shutdown']) {
  for (const settlement of ['success', 'rejection']) {
    test(`${lifecycle} suppresses stale ${settlement} and interrupts late receipts`, async () => {
      const pending = deferred(); const handlers: Record<string, Function> = {};
      const entries: any[] = [], messages: any[] = [], interrupted: string[] = [], launches: any[] = [];
      let tool: any;
      const outcome = registerWorkflows({
        on: (event: string, handler: Function) => { handlers[event] = handler; },
        registerTool: (value: any) => { tool = value; },
        appendEntry: (...args: any[]) => entries.push(args), sendMessage: (...args: any[]) => messages.push(args),
      }, async (step, ctx) => { launches.push({ step, ctx }); return pending.promise; }, async ({ id }) => { interrupted.push(id); });
      const start = tool.execute('', { action: 'start', mode: 'chain', steps }, null, null, { session: 'old' });
      const rejected = assert.rejects(start, /Session changed during launch/);
      await handlers[lifecycle]();
      if (settlement === 'success') pending.resolve({ details: { id: 'late-child' } });
      else pending.reject(Error('late failure'));
      await rejected;
      await outcome('late-child', { kind: 'completed' });
      assert.equal(entries.length, 0); assert.equal(messages.length, 0); assert.equal(launches.length, 1);
      assert.deepEqual(interrupted, settlement === 'success' ? ['late-child'] : []);
      if (lifecycle === 'session_start') {
        const list = await tool.execute('', { action: 'list' }, null, null, { session: 'new' });
        assert.deepEqual(list.details, []);
      } else {
        await assert.rejects(() => tool.execute('', { action: 'start', mode: 'chain', steps }, null, null, {}), /closed/);
      }
    });
  }
}

test('dispose interrupts existing children once and ignores late outcomes', async () => {
  const interrupts: string[] = [], events: any[] = [];
  const manager = new Workflows(async () => ({ details: { id: 'child' } }), r => events.push(r), async ({ id }) => { interrupts.push(id); });
  const run = await manager.start('chain', steps);
  await manager.dispose(); await manager.dispose(); await manager.outcome('child', { kind: 'completed' });
  assert.deepEqual(interrupts, ['child']); assert.equal(events.length, 0); assert.equal(run.status, 'cancelled');
});

function registeredFixture(interrupt: (params: any) => Promise<any>) {
  const lateLaunch = deferred();
  const entries: any[] = [], messages: any[] = [];
  const handlers: Record<string, Function> = {};
  let tool: any;
  let launches = 0;
  const outcome = registerWorkflows({
    on: (event: string, handler: Function) => { handlers[event] = handler; },
    registerTool: (value: any) => { tool = value; },
    appendEntry: (_type: string, run: any) => entries.push(structuredClone(run)),
    sendMessage: (message: any) => messages.push(structuredClone(message)),
  }, async () => ++launches === 1 ? { details: { id: 'a' } } : lateLaunch.promise, interrupt);
  const execute = (args: any) => tool.execute('', args, null, null, {});
  return { outcome, execute, handlers, entries, messages, lateLaunch };
}

for (const result of ['receipt', 'exception', 'acknowledgement']) {
  test(`late-cancel ${result} is retained in workflow status and notified without claiming the child stopped`, async () => {
    const request = deferred(), entered = deferred<void>(); let requests = 0;
    const fx = registeredFixture(async () => { requests++; entered.resolve(); return request.promise; });
    const { details: run } = await fx.execute({ action: 'start', mode: 'chain', steps });
    const next = fx.outcome('a', { kind: 'completed' });
    const cancel = await fx.execute({ action: 'cancel', id: run.id });
    assert.deepEqual(cancel.details.interrupts, []);
    fx.lateLaunch.resolve({ details: { id: 'b' } }); await entered.promise;
    assert.equal(run.status, 'cancelled'); assert.equal(run.children.b.kind, 'running');
    const receipt = result === 'acknowledgement'
      ? { details: { id: 'b', status: 'interrupt_requested' } }
      : { details: { id: 'b', error: 'transport failed' }, content: [{ type: 'text', text: 'interrupt failed' }] };
    if (result === 'exception') request.reject(Error('transport exception'));
    else request.resolve(receipt);
    await next;
    const status = await fx.execute({ action: 'status', id: run.id });
    assert.equal(status.details.interrupts.length, 1);
    const record = status.details.interrupts[0];
    assert.equal(record.id, 'b'); assert.equal(record.late, true);
    if (result === 'exception') assert.match(record.receipt.error, /transport exception/);
    else assert.deepEqual(record.receipt, receipt);
    assert.deepEqual(fx.entries.at(-1).interrupts, status.details.interrupts);
    assert.deepEqual(fx.messages.at(-1).details.interrupts, status.details.interrupts);
    assert.equal(status.details.status, 'cancelled'); assert.equal(status.details.children.b.kind, 'running');
    const repeated = await fx.execute({ action: 'cancel', id: run.id });
    assert.deepEqual(repeated.details.interrupts, status.details.interrupts); assert.equal(requests, 1);
  });
}

for (const lifecycle of ['session_start', 'session_shutdown']) {
  for (const result of ['receipt', 'exception']) {
    test(`${lifecycle} suppresses stale late-interrupt ${result} notifications while retaining the receipt`, async () => {
      const request = deferred(), entered = deferred<void>();
      const fx = registeredFixture(async () => { entered.resolve(); return request.promise; });
      const { details: run } = await fx.execute({ action: 'start', mode: 'chain', steps });
      const next = fx.outcome('a', { kind: 'completed' });
      await fx.execute({ action: 'cancel', id: run.id });
      fx.lateLaunch.resolve({ details: { id: 'b' } }); await entered.promise;
      await fx.handlers[lifecycle]();
      const counts = [fx.entries.length, fx.messages.length];
      if (result === 'exception') request.reject(Error('stale interrupt exception'));
      else request.resolve({ details: { error: 'stale interrupt failure' } });
      await next;
      assert.equal(run.interrupts.length, 1);
      assert.match(JSON.stringify(run.interrupts), /stale interrupt/);
      assert.deepEqual([fx.entries.length, fx.messages.length], counts);
      if (lifecycle === 'session_start') assert.deepEqual((await fx.execute({ action: 'list' })).details, []);
    });
  }
}

test('cancellation retains immediate and late interrupt receipts together', async () => {
  const pending = deferred(); const events: any[] = [];
  const manager = new Workflows(async step => step.key === 'a' ? { details: { id: 'a' } } : pending.promise,
    run => events.push(structuredClone(run)), async ({ id }) => ({ details: { id, error: `cannot interrupt ${id}` } }));
  const start = manager.start('parallel', steps);
  const run = [...manager.runs.values()][0];
  // Let the first launch receipt be inserted while the second remains pending.
  await Promise.resolve();
  await manager.cancel(run.id);
  assert.equal(run.interrupts.length, 1); assert.equal(run.interrupts[0].late, false);
  pending.resolve({ details: { id: 'b' } }); await start;
  assert.deepEqual(run.interrupts.map(record => [record.id, record.late]), [['a', false], ['b', true]]);
  assert.deepEqual(events.at(-1).interrupts, run.interrupts);
});
