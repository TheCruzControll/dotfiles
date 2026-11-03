import test from "node:test";
import assert from "node:assert/strict";
import { WORKFLOWS, PRINCIPLE_NAMES } from "../lib/registry.js";
import { applyUpdate, canRemind, isEngineeringIntent, isLikelyCodeWriter, makeTask, recordChildLaunch, reserveChildRuns, requestedLaunches, recordChildStart, recordChildComplete, recordChildToolResult, applyChildLifecycle, reconstruct, MAX_ACTIVE_CHILDREN, MAX_TOTAL_CHILDREN, ENTRY_TYPE, totalChildLimit, approveChildAllowance } from "../lib/policy.js";

function task(route = "feature", constraints = []) {
  return makeTask({ taskId: "t1", projectRoot: "/repo", sessionId: "s1", route, scope: "Add the requested behavior", reason: "Substantive feature request", constraints });
}

test("registry covers approved full workflow set and all 24 principles", () => {
  assert.equal(Object.keys(WORKFLOWS).length, 27);
  assert.equal(PRINCIPLE_NAMES.length, 24);
  assert.equal(new Set(PRINCIPLE_NAMES).size, 24);
});

test("routing intent bypasses short casual turns but recognizes engineering asks", () => {
  assert.equal(isEngineeringIntent("Thanks!"), false);
  assert.equal(isEngineeringIntent("Fix the crash when the user opens a saved project."), true);
});

test("task creation validates trusted route and bounds user-provided fields", () => {
  assert.throws(() => task("../../secret"), /Unknown workflow/);
  const created = makeTask({ taskId: "x", projectRoot: "/repo", sessionId: "s", route: "plan", scope: "x".repeat(3000), reason: "r", constraints: Array(20).fill("c".repeat(400)) });
  assert.equal(created.scope.length, 1000);
  assert.equal(created.constraints.length, 12);
  assert.equal(created.constraints[0].length, 300);
});

test("session branch reconstruction uses latest active task and ignores unrelated custom entries", () => {
  const entries = [
    { type: "custom", customType: "other", data: {} },
    { type: "custom", customType: ENTRY_TYPE, data: { schemaVersion: 1, action: "selected", task: task("bug-fix") } },
    { type: "custom", customType: ENTRY_TYPE, data: { schemaVersion: 1, action: "updated", task: { ...task("bug-fix"), stage: "verify" } } },
    { type: "custom", customType: ENTRY_TYPE, data: { schemaVersion: 9, action: "selected", task: task() } },
  ];
  assert.equal(reconstruct(entries).stage, "verify");
  assert.equal(reconstruct(entries).route, "bug-fix");
});

test("verification and stage evidence validates input and updates task", () => {
  const current = task();
  assert.throws(() => applyUpdate(current, { taskId: "other", action: "stage", value: "code" }), /does not match/);
  assert.throws(() => applyUpdate(current, { taskId: "t1", action: "stage" }), /require a value/);
  applyUpdate(current, { action: "stage", value: "plan" });
  applyUpdate(current, { taskId: "t1", action: "verification", check: "unit tests", result: "passed", paths: ["src/a.ts"] });
  assert.equal(current.stage, "verify");
  assert.equal(current.verification[0].result, "passed");
});

test("one scoped completion reminder honors skip constraints and is one-shot", () => {
  const current = task();
  assert.equal(canRemind(current), true);
  current.reminderUsed = true;
  assert.equal(canRemind(current), false);
  assert.equal(canRemind(task("feature", ["Do not run tests"])), false);
  assert.equal(canRemind(task("investigation")), false);
});

test("subagent launch-shape parsing bounds direct, batched, and scripted calls", () => {
  assert.equal(requestedLaunches({ agent: "scout", task: "Read one file" }), 1);
  assert.equal(requestedLaunches({ workflow: "parallel", args: { tasks: [{}, {}] } }), 2);
  assert.equal(requestedLaunches({ workflow: true }), -1);
  assert.equal(requestedLaunches({ action: "status", agent: "scout" }), 0);
  assert.equal(requestedLaunches({ name: "Herdr scout", task: "Read one file" }), 1);
  assert.equal(requestedLaunches({}), 0);
});

test("child lifecycle records starts, completion runId payloads, cancellation, and reload", () => {
  const current = task();
  reserveChildRuns(current, [{ childId: "launched", role: "unknown", isolated: false }, { childId: "cancelled", role: "unknown", isolated: false }]);
  assert.equal(recordChildComplete(current, { runId: "unrelated" }), false);
  assert.equal(current.childRuns[0].status, "active");
  assert.equal(recordChildStart(current, { id: "run-1" }), true);
  const restored = reconstruct([{ type: "custom", customType: ENTRY_TYPE, data: { schemaVersion: 1, action: "selected", task: current } }]);
  assert.equal(recordChildComplete(restored, { runId: "run-1" }), true);
  recordChildToolResult(restored, ["cancelled"]);
  assert.deepEqual(restored.childRuns.map((run) => run.status), ["completed", "completed"]);
});

test("native lifecycle retains unresolved slots and releases only owned terminal outcomes", () => {
  const current = task();
  reserveChildRuns(current, [{ childId: "reservation", requestName: "owned-child", runtimeId: 'native-id', sessionFile: '/test/child.jsonl', isolated: true }]);
  const event = { version: 1, id: "native-id", name: "owned-child", sessionFile: "/test/child.jsonl", status: "started" };
  assert.equal(applyChildLifecycle(current, event), true);
  assert.equal(applyChildLifecycle(current, { ...event, status: "interrupt-requested" }), true);
  assert.equal(current.childRuns[0].status, "active");
  applyChildLifecycle(current, { ...event, status: "unresolved" });
  assert.equal(current.childRuns[0].needsAttention, true);
  assert.equal(applyChildLifecycle(current, { ...event, id: "unrelated", sessionFile: "/other", status: "completed" }), false);
  applyChildLifecycle(current, { ...event, status: "completed" });
  assert.equal(current.childRuns[0].status, "completed");
  assert.equal(applyChildLifecycle(current, { ...event, status: "unresolved" }), false);
});

test("lifecycle identity cannot be replaced by another run sharing a resumed session file", () => {
  const current=task();
  reserveChildRuns(current,[{childId:'first',requestName:'same',runtimeId:'run-one',sessionFile:'/test/shared.jsonl',isolated:true}]);
  const first={version:1,id:'run-one',name:'same',sessionFile:'/test/shared.jsonl',status:'started'};
  applyChildLifecycle(current,first);
  assert.equal(applyChildLifecycle(current,{...first,id:'unrelated',status:'completed'}),false);
  assert.equal(applyChildLifecycle(current,{...first,sessionFile:'/test/wrong.jsonl',status:'completed'}),false);
  applyChildLifecycle(current,{...first,status:'completed'});
  reserveChildRuns(current,[{childId:'second',requestName:'same',runtimeId:'run-two',sessionFile:'/test/shared.jsonl',isolated:true}]);
  assert.equal(applyChildLifecycle(current,{...first,id:'run-two'}),true);
  assert.equal(current.childRuns[1].runtimeId,'run-two');
  applyChildLifecycle(current,{...first,status:'completed'});
  assert.equal(current.childRuns[1].status,'active');
});

test('an unrelated lifecycle record cannot claim a reservation by display name alone',()=>{
  const current=task();
  reserveChildRuns(current,[{childId:'pending',requestName:'same-name',isolated:true}]);
  assert.equal(applyChildLifecycle(current,{version:1,id:'unrelated',name:'same-name',sessionFile:'/test/unrelated.jsonl',status:'completed'}),false);
  assert.equal(current.childRuns[0].runtimeId,undefined);
  assert.equal(current.childRuns[0].status,'active');
});

test("writer isolation classification ignores negated output and unrelated words", () => {
  assert.equal(isLikelyCodeWriter({ task: "Strictly read-only, summarize safeguards. Do not write files." }), false);
  assert.equal(isLikelyCodeWriter({ task: "Implement the requested feature in the source files." }), true);
  assert.equal(isLikelyCodeWriter({ task: "Implement the feature; do not modify tests." }), true);
  assert.equal(isLikelyCodeWriter({ args: { tasks: [{ task: "Read-only analysis; do not write files." }, { task: "Implement the feature" }] } }), true);
  assert.equal(isLikelyCodeWriter({ workflow: "parallel", args: { tasks: [{ task: "Add a test" }] } }), true);
});

test("delegation policy caps active and total reservations", () => {
  const current = task();
  for (let i = 0; i < MAX_ACTIVE_CHILDREN; i++) assert.equal(recordChildLaunch(current, `c${i}`, true).allowed, true);
  assert.equal(recordChildLaunch(current, "overflow", true).allowed, false);
  current.childRuns.forEach((run) => { run.status = "completed"; });
  assert.equal(MAX_TOTAL_CHILDREN,16);
  for (let i = MAX_ACTIVE_CHILDREN; i < MAX_TOTAL_CHILDREN; i++) {
    assert.equal(recordChildLaunch(current, `c${i}`, true).allowed, true);
    current.childRuns.at(-1).status = "completed";
  }
  assert.match(recordChildLaunch(current, "over-total", true).reason, /Total child limit/);
});

test('owner-approved next-launch allowance survives reconstruction and cannot override active limits',()=>{
  const current=task();
  for(let i=0;i<MAX_TOTAL_CHILDREN;i++){assert.equal(recordChildLaunch(current,`old-${i}`,true).allowed,true);current.childRuns.at(-1).status='completed';}
  assert.equal(recordChildLaunch(current,'before-approval',true).allowed,false);
  const allowance=approveChildAllowance(current,4);
  assert.equal(allowance.totalLimit,20);
  const restored=reconstruct([{type:'custom',customType:ENTRY_TYPE,data:{schemaVersion:1,action:'selected',task:current}}]);
  assert.equal(totalChildLimit(restored),20);
  for(let i=0;i<4;i++)assert.equal(recordChildLaunch(restored,`new-${i}`,true).allowed,true);
  assert.equal(recordChildLaunch(restored,'excess',true).allowed,false);
  approveChildAllowance(restored,2);
  assert.match(recordChildLaunch(restored,'active-overflow',true).reason,/Active child limit/);
  restored.childRuns.forEach(run=>{run.status='completed';});
  assert.equal(recordChildLaunch(restored,'last-one',true).allowed,true);
  assert.equal(recordChildLaunch(restored,'last-two',true).allowed,true);
  assert.equal(recordChildLaunch(restored,'over-approved',true).allowed,false);
});

test('valid older allowances retain the default floor without changing recorded approval',()=>{
  const current=task();
  approveChildAllowance(current,1);
  assert.equal(current.launchAllowance.totalLimit,1);
  assert.equal(totalChildLimit(current),16);
  for(let i=0;i<16;i++) {
    assert.equal(recordChildLaunch(current,`default-${i}`,true).allowed,true);
    current.childRuns.at(-1).status='completed';
  }
  assert.equal(recordChildLaunch(current,'seventeenth',true).allowed,false);
});

test('invalid allowances fail closed and invalid approval amounts cannot mutate a task',()=>{
  const current=task();
  for(const amount of [0,-1,1.5,Infinity,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>approveChildAllowance(current,amount));
  assert.equal(current.launchAllowance,undefined);
  approveChildAllowance(current,3);
  current.launchAllowance.taskId='another-task';
  assert.equal(totalChildLimit(current),0);
  assert.equal(recordChildLaunch(current,'unapproved',true).allowed,false);
});

test("batch child reservations are atomic and count restored active records", () => {
  const current = task();
  const entries = Array.from({ length: MAX_ACTIVE_CHILDREN + 1 }, (_, i) => ({ childId: `batch-${i}`, isolated: true }));
  const result = reserveChildRuns(current, entries);
  assert.equal(result.allowed, false);
  assert.equal(current.childRuns.length, 0);
  reserveChildRuns(current, entries.slice(0, MAX_ACTIVE_CHILDREN));
  const restored = reconstruct([{ type: "custom", customType: ENTRY_TYPE, data: { schemaVersion: 1, action: "selected", task: current } }]);
  assert.equal(recordChildLaunch(restored, "after-reload", true).allowed, false);
});
