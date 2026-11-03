import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { writeFileSync } from 'node:fs';
const release = process.env.PI_SIDEBAR_TEST_RELEASE ?? '1.4.0';
const modules = `/Users/franciscruz/.pi/agent/install/releases/${release}/node_modules/`;
const { createJiti } = await import(modules + 'jiti/lib/jiti.mjs');
const jiti = createJiti(import.meta.url, { alias: { '@earendil-works/pi-tui': modules + '@earendil-works/pi-tui/dist/index.js' } });
const { registerSubagentStatus, SUBAGENT_STATUS } = await jiti.import('../subagents.ts');
const { nativeFooter } = await jiti.import('../footer.ts');
const { visibleWidth } = await import(modules + '@earendil-works/pi-tui/dist/index.js');

test('upstream snapshots update footer status without polling and discard stale/session-ended replies', async () => {
  const events = new EventEmitter(), hooks = new Map(), statuses = new Map(), requests = [];
  const pi = { events: { on(name, fn) { events.on(name, fn); return () => events.off(name, fn); }, emit: (...args) => events.emit(...args) }, on: (name, fn) => hooks.set(name, fn) };
  events.on('subagents:rpc:v1:request', request => requests.push(request));
  const reply = (request, count) => events.emit(`subagents:rpc:v1:reply:${request.requestId}`, { version: 1, success: true, data: { fleet: { version: 1, totalActive: count } } });
  const ctx = { mode: 'tui', ui: { setStatus(key, value) { if (value === undefined) statuses.delete(key); else statuses.set(key, value); } } };
  registerSubagentStatus(pi);
  hooks.get('session_start')({}, ctx); await Promise.resolve();
  assert.equal(requests.length, 1); assert.equal(requests[0].method, 'status');
  reply(requests[0], 2); assert.equal(statuses.get(SUBAGENT_STATUS), 'subagents 2 active');
  events.emit('subagent:jobs-changed'); events.emit('subagent:jobs-changed');
  reply(requests[1], 99); assert.equal(statuses.get(SUBAGENT_STATUS), 'subagents 2 active');
  reply(requests[2], 0); assert.equal(statuses.get(SUBAGENT_STATUS), 'subagents 0 active');
  events.emit('subagents:rpc:v1:ready'); reply(requests.at(-1), -1); assert.equal(statuses.has(SUBAGENT_STATUS), false);
  events.emit('subagent:jobs-changed'); hooks.get('session_shutdown')(); reply(requests.at(-1), 5);
  assert.equal(statuses.has(SUBAGENT_STATUS), false);
  assert.equal(events.eventNames().filter(name => name.startsWith('subagents:rpc:v1:reply:')).length, 0);
  const count = requests.length;
  hooks.get('session_start')({}, { mode: 'json', ui: ctx.ui }); await Promise.resolve();
  events.emit('subagent:jobs-changed'); assert.equal(requests.length, count);
});

test('actual compact footer stays one bounded line with live subagents and long models', () => {
  const statuses = new Map();
  const component = { session: { state: { model: { id: 'gpt-6.1-sol' }, thinkingLevel: 'medium' } }, footerData: { getExtensionStatuses: () => statuses } };
  const footer = nativeFooter({ children: [component] }, () => ({ tokens: 132700, percent: 48.8 }));
  assert.doesNotMatch(footer.render(100)[0], /subagents/);
  const frames = [];
  for (const active of [2, 1, 0]) {
    statuses.set(SUBAGENT_STATUS, `subagents ${active} active`);
    for (const width of [40, 52, 80, 120]) {
      const lines = footer.render(width);
      assert.equal(lines.length, 1); assert.ok(visibleWidth(lines[0]) <= width);
      assert.match(lines[0], new RegExp(`132.7k · 48.8% · subagents ${active} active`));
      frames.push(`${width} cols: ${lines[0]}`);
    }
  }
  component.session.state.model.id = 'very-long-model-'.repeat(12);
  assert.match(footer.render(52)[0], /subagents 0 active/);
  writeFileSync(`/tmp/pi-sidebar-subagents-${release}.ansi`, frames.join('\n') + '\n');
});
