import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  buildLaunchPlan,
  buildResumeLaunchPlan,
  launchPolicyPath,
  buildPiPromptArgs,
  buildSubagentToolAllowlist,
  shellEscape,
  type LaunchPlan,
  type LaunchPlanContext,
  type SubagentLaunchParams,
} from "../src/launch.ts";
import type { AgentDefaults } from "../src/agents.ts";

interface Fixture {
  root: string;
  cwd: string;
  piBin: string;
  agentDir: string;
  env: Record<string, string | undefined>;
}

const cleanups: Array<() => void> = [];
const savedAgentDir = process.env.PI_CODING_AGENT_DIR;

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
  if (savedAgentDir == null) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = savedAgentDir;
});

function makeFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "herdr-launch-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));

  const cwd = join(root, "work");
  mkdirSync(cwd, { recursive: true });

  const binDir = join(root, "bin");
  mkdirSync(binDir);
  const piBin = join(binDir, "pi");
  writeFileSync(piBin, "#!/bin/bash\nexit 0\n");
  chmodSync(piBin, 0o755);

  const agentDir = join(root, "agent-config");
  mkdirSync(agentDir, { recursive: true });
  // agents.ts helpers (resolveSubagentPaths / getDefaultSessionDirFor) read
  // process.env.PI_CODING_AGENT_DIR directly; keep it in sync with ctx.env.
  process.env.PI_CODING_AGENT_DIR = agentDir;

  const env: Record<string, string | undefined> = {
    PATH: `${binDir}:/usr/bin:/bin`,
    PI_CODING_AGENT_DIR: agentDir,
    HERDR_PANE_ID: "w1:p1",
  };

  return { root, cwd, piBin, agentDir, env };
}

function makeCtx(fx: Fixture, overrides?: Partial<LaunchPlanContext>): LaunchPlanContext {
  return {
    sessionDir: join(fx.root, "orch-sessions"),
    sessionId: "orch-session-id",
    parentSessionFile: join(fx.root, "orch-sessions", "parent.jsonl"),
    parentCwd: fx.cwd,
    env: fx.env,
    id: "abcd1234",
    now: new Date("2026-07-06T12:00:00.000Z"),
    ...overrides,
  };
}

function baseParams(overrides?: Partial<SubagentLaunchParams>): SubagentLaunchParams {
  return { name: "Worker", task: "Do the thing", ...overrides };
}

function plan(
  fx: Fixture,
  params?: Partial<SubagentLaunchParams>,
  agentDefs: AgentDefaults | null = null,
  ctxOverrides?: Partial<LaunchPlanContext>,
): LaunchPlan {
  return buildLaunchPlan(baseParams(params), agentDefs, makeCtx(fx, ctxOverrides));
}

function scriptOf(p: LaunchPlan): string {
  const file = p.files.find((f) => f.path === p.launchScriptFile);
  assert.ok(file, "launch script must be in plan.files");
  return file.content;
}

describe("launch plan: env wrapping (direnv / prefix overrides)", () => {
  it("wraps with direnv exec when cwd has .envrc", () => {
    const fx = makeFixture();
    writeFileSync(join(fx.cwd, ".envrc"), "use devenv\n");
    const script = scriptOf(plan(fx, { cwd: fx.cwd }));
    assert.ok(
      script.includes(`direnv exec ${shellEscape(fx.cwd)} ${shellEscape(fx.piBin)}`),
      `expected direnv wrap in:\n${script}`,
    );
  });

  it("wraps with direnv exec when an ancestor dir has .envrc", () => {
    const fx = makeFixture();
    writeFileSync(join(fx.root, ".envrc"), "use devenv\n");
    const nested = join(fx.cwd, "sub", "dir");
    mkdirSync(nested, { recursive: true });
    const script = scriptOf(plan(fx, { cwd: nested }));
    assert.ok(script.includes(`direnv exec ${shellEscape(nested)} ${shellEscape(fx.piBin)}`));
  });

  it("does not wrap without .envrc", () => {
    const fx = makeFixture();
    const script = scriptOf(plan(fx, { cwd: fx.cwd }));
    assert.ok(!script.includes("direnv"), `unexpected direnv in:\n${script}`);
  });

  it("PI_HERDR_DIRENV=0 disables autodetect", () => {
    const fx = makeFixture();
    writeFileSync(join(fx.cwd, ".envrc"), "use devenv\n");
    fx.env.PI_HERDR_DIRENV = "0";
    const script = scriptOf(plan(fx, { cwd: fx.cwd }));
    assert.ok(!script.includes("direnv"));
  });

  it("PI_HERDR_LAUNCH_PREFIX overrides autodetect (plain prefix)", () => {
    const fx = makeFixture();
    writeFileSync(join(fx.cwd, ".envrc"), "use devenv\n");
    fx.env.PI_HERDR_LAUNCH_PREFIX = "mise exec --";
    const script = scriptOf(plan(fx, { cwd: fx.cwd }));
    assert.ok(script.includes(`mise exec -- ${shellEscape(fx.piBin)}`));
    assert.ok(!script.includes("direnv"));
  });

  it("PI_HERDR_LAUNCH_PREFIX interpolates {cwd}", () => {
    const fx = makeFixture();
    fx.env.PI_HERDR_LAUNCH_PREFIX = "nix develop {cwd} -c";
    const script = scriptOf(plan(fx, { cwd: fx.cwd }));
    assert.ok(script.includes(`nix develop ${shellEscape(fx.cwd)} -c ${shellEscape(fx.piBin)}`));
  });

  it("empty PI_HERDR_LAUNCH_PREFIX disables wrapping even with .envrc", () => {
    const fx = makeFixture();
    writeFileSync(join(fx.cwd, ".envrc"), "use devenv\n");
    fx.env.PI_HERDR_LAUNCH_PREFIX = "";
    const script = scriptOf(plan(fx, { cwd: fx.cwd }));
    assert.ok(!script.includes("direnv"));
    assert.ok(script.includes(`\n${shellEscape(fx.piBin)} `), "pi invoked unwrapped");
  });
});

describe("launch plan: pi binary resolution", () => {
  it("resolves an absolute pi from PATH by default (never bare `pi`)", () => {
    const fx = makeFixture();
    const p = plan(fx);
    assert.equal(p.piArgv[0], fx.piBin);
    assert.ok(p.piArgv[0].startsWith("/"), "pi binary must be absolute");
    const script = scriptOf(p);
    assert.ok(!/(^|[^/'\w])pi\s/.test(script.split("\n").find((l) => l.includes("--session")) ?? ""));
  });

  it("PI_HERDR_PI_BIN overrides the binary", () => {
    const fx = makeFixture();
    fx.env.PI_HERDR_PI_BIN = "/opt/custom/pi";
    const p = plan(fx);
    assert.equal(p.piArgv[0], "/opt/custom/pi");
    assert.ok(scriptOf(p).includes(shellEscape("/opt/custom/pi")));
  });

  it("throws a clear error when pi is not on PATH", () => {
    const fx = makeFixture();
    fx.env.PATH = "/nonexistent-dir-xyz";
    assert.throws(() => plan(fx), /pi.*PATH/i);
  });
});

describe("launch plan: curated env exports", () => {
  it("exports orchestrator PATH and PI_SUBAGENT_* vars, never a full env dump", () => {
    const fx = makeFixture();
    fx.env.SECRET_XYZ = "leak-me-not";
    fx.env.PI_SUBAGENT_ID = "parents-own-id"; // orchestrator is itself a subagent
    const agentDefs: AgentDefaults = { autoExit: true, denyTools: "subagent" };
    const p = plan(fx, { agent: "worker" }, agentDefs);
    const script = scriptOf(p);

    assert.ok(script.includes(`export PATH=${shellEscape(fx.env.PATH!)}`));
    assert.ok(script.includes(`export PI_SUBAGENT_NAME=${shellEscape("Worker")}`));
    assert.ok(script.includes(`export PI_SUBAGENT_ID=${shellEscape("abcd1234")}`));
    assert.ok(script.includes(`export PI_SUBAGENT_SESSION=${shellEscape(p.sessionFile)}`));
    assert.ok(script.includes(`export PI_SUBAGENT_AGENT=${shellEscape("worker")}`));
    assert.ok(script.includes("export PI_SUBAGENT_AUTO_EXIT=1"));
    assert.ok(script.includes(`export PI_DENY_TOOLS=${shellEscape("subagent")}`));
    // pane id is only known inside the pane; forwarded from herdr's own env
    assert.ok(script.includes('export PI_SUBAGENT_PANE="${HERDR_PANE_ID:-}"'));

    assert.ok(!script.includes("SECRET_XYZ"), "full env vars must not leak");
    assert.ok(!script.includes("parents-own-id"), "orchestrator's own PI_SUBAGENT_ID must not leak");
  });

  it("omits PI_SUBAGENT_AUTO_EXIT and PI_SUBAGENT_AGENT without agent defs", () => {
    const fx = makeFixture();
    const script = scriptOf(plan(fx));
    assert.ok(!script.includes("PI_SUBAGENT_AUTO_EXIT"));
    assert.ok(!script.includes("PI_SUBAGENT_AGENT="));
  });

  it("local .pi/agent wins for PI_CODING_AGENT_DIR", () => {
    const fx = makeFixture();
    const localAgentDir = join(fx.cwd, ".pi", "agent");
    mkdirSync(join(localAgentDir, "extensions"), { recursive: true });
    writeFileSync(join(localAgentDir, "extensions", "herdr-agent-state.ts"), "export default () => {};");
    const script = scriptOf(plan(fx, { cwd: fx.cwd }));
    assert.ok(script.includes(`export PI_CODING_AGENT_DIR=${shellEscape(localAgentDir)}`));
  });

  it("inherits env PI_CODING_AGENT_DIR when no local .pi/agent", () => {
    const fx = makeFixture();
    const script = scriptOf(plan(fx, { cwd: fx.cwd }));
    assert.ok(script.includes(`export PI_CODING_AGENT_DIR=${shellEscape(fx.agentDir)}`));
  });
});

describe("launch plan: exitcode sidecar and hold-open", () => {
  it("writes the exitcode sidecar and holds open only in the startup window", () => {
    const fx = makeFixture();
    const p = plan(fx);
    const script = scriptOf(p);
    assert.ok(script.includes(`echo "$code $PI_SUBAGENT_ID" > ${shellEscape(`${p.sessionFile}.exitcode`)}`));
    assert.ok(script.includes(`[ "$code" -ne 0 ] && [ "$SECONDS" -lt 15 ]`));
    assert.ok(script.includes("read -r"));
    assert.equal(p.holdOpenSecs, 15);
  });

  it("PI_HERDR_HOLD_OPEN_SECS overrides the window", () => {
    const fx = makeFixture();
    fx.env.PI_HERDR_HOLD_OPEN_SECS = "30";
    const p = plan(fx);
    assert.ok(scriptOf(p).includes(`[ "$SECONDS" -lt 30 ]`));
    assert.equal(p.holdOpenSecs, 30);
  });

  it("PI_HERDR_HOLD_OPEN_SECS=0 removes hold-open entirely", () => {
    const fx = makeFixture();
    fx.env.PI_HERDR_HOLD_OPEN_SECS = "0";
    const p = plan(fx);
    const script = scriptOf(p);
    assert.ok(!script.includes("read -r"));
    assert.ok(!script.includes("-lt"));
    assert.equal(p.holdOpenSecs, 0);
    // sidecar write must survive hold-open removal
    assert.ok(script.includes(`echo "$code $PI_SUBAGENT_ID" > ${shellEscape(`${p.sessionFile}.exitcode`)}`));
  });
});

describe("launch plan: pi argv", () => {
  it("passes --session, -e subagent-done, and task artifact", () => {
    const fx = makeFixture();
    const donePath = join(fx.root, "subagent-done.ts");
    const p = plan(fx, {}, null, { subagentDonePath: donePath });
    const argv = p.piArgv;
    assert.ok(argv.includes("--approve"), "child must not block on project trust");
    assert.equal(argv[argv.indexOf("--session") + 1], p.sessionFile);
    assert.equal(argv[argv.indexOf("-e") + 1], donePath);
    assert.ok(donePath.startsWith("/"));
    // standalone → artifact-backed task delivery
    assert.ok(p.taskArtifactFile, "task artifact expected for standalone mode");
    assert.equal(argv[argv.length - 1], `@${p.taskArtifactFile}`);
  });

  it("combines model and thinking as model:thinking", () => {
    const fx = makeFixture();
    const p = plan(fx, {}, { model: "anthropic/claude-x", thinking: "high" });
    const argv = p.piArgv;
    assert.equal(argv[argv.indexOf("--model") + 1], "anthropic/claude-x:high");
  });

  it("param model overrides agent model, without thinking suffix when unset", () => {
    const fx = makeFixture();
    const p = plan(fx, { model: "openai/gpt-x" }, { model: "anthropic/claude-x" });
    assert.equal(p.piArgv[p.piArgv.indexOf("--model") + 1], "openai/gpt-x");
  });

  it("uses --append-system-prompt with a sysprompt file for append mode", () => {
    const fx = makeFixture();
    const p = plan(fx, {}, { body: "You are a worker.", systemPromptMode: "append" });
    const argv = p.piArgv;
    assert.ok(p.syspromptFile, "sysprompt artifact expected");
    assert.equal(argv[argv.indexOf("--append-system-prompt") + 1], p.syspromptFile);
    const file = p.files.find((f) => f.path === p.syspromptFile);
    assert.equal(file?.content, "You are a worker.");
    // identity moved to system prompt — not duplicated in the task
    const task = p.files.find((f) => f.path === p.taskArtifactFile);
    assert.ok(!task?.content.includes("You are a worker."));
  });

  it("uses --system-prompt for replace mode", () => {
    const fx = makeFixture();
    const p = plan(fx, {}, { body: "Replace me.", systemPromptMode: "replace" });
    assert.ok(p.piArgv.includes("--system-prompt"));
    assert.ok(!p.piArgv.includes("--append-system-prompt"));
  });

  it("embeds agent body in the task when no system-prompt mode", () => {
    const fx = makeFixture();
    const p = plan(fx, {}, { body: "You are a worker." });
    assert.equal(p.syspromptFile, null);
    const task = p.files.find((f) => f.path === p.taskArtifactFile);
    assert.ok(task?.content.includes("You are a worker."));
  });

  it("--tools allowlist always includes caller_ping and subagent_done", () => {
    const fx = makeFixture();
    const p = plan(fx, {}, { tools: "read,bash" });
    const argv = p.piArgv;
    assert.equal(argv[argv.indexOf("--tools") + 1], "read,bash,caller_ping,subagent_done");
  });

  it("omits --tools without an explicit restriction", () => {
    const fx = makeFixture();
    assert.ok(!plan(fx).piArgv.includes("--tools"));
  });

  it("passes skill prompts with the empty-separator trick for artifact delivery", () => {
    const fx = makeFixture();
    const p = plan(fx, {}, { skills: "review,lint" });
    const argv = p.piArgv;
    const tail = argv.slice(-4);
    assert.deepEqual(tail, ["", "/skill:review", "/skill:lint", `@${p.taskArtifactFile}`]);
  });
});

describe("launch plan: task delivery", () => {
  it("fork mode passes the task directly and seeds the session", () => {
    const fx = makeFixture();
    const p = plan(fx, { fork: true, task: "Iterate on the thing" });
    assert.equal(p.taskArtifactFile, null);
    assert.equal(p.piArgv[p.piArgv.length - 1], "Iterate on the thing");
    assert.equal(p.seedSession?.mode, "fork");
    // no wrapper instructions in fork mode
    assert.ok(!p.piArgv.some((a) => a.includes("Complete your task")));
  });

  it("standalone mode writes the task artifact with wrapper instructions", () => {
    const fx = makeFixture();
    const p = plan(fx, { task: "Fix the bug" }, { autoExit: true });
    assert.equal(p.seedSession, null);
    const task = p.files.find((f) => f.path === p.taskArtifactFile);
    assert.ok(task);
    assert.ok(task.content.includes("Fix the bug"));
    assert.ok(task.content.includes("Complete your task autonomously. When finished, call the subagent_done tool."));
    assert.ok(task.content.includes("`summary` argument of subagent_done"));
    assert.ok(!task.content.includes("FINAL assistant message"), "handoff is the tool argument, not the last message");
    assert.match(p.taskArtifactFile!, /context\/worker-.*\.md$/);
  });

  it("lineage-only mode seeds without fork content and uses artifact delivery", () => {
    const fx = makeFixture();
    const p = plan(fx, {}, { sessionMode: "lineage-only" });
    assert.equal(p.seedSession?.mode, "lineage-only");
    assert.ok(p.taskArtifactFile);
  });

  it("non-auto-exit agents get the subagent_done wrapper instructions", () => {
    const fx = makeFixture();
    const p = plan(fx, {}, { autoExit: false });
    const task = p.files.find((f) => f.path === p.taskArtifactFile);
    assert.ok(task?.content.includes("call the subagent_done tool"));
    assert.ok(task?.content.includes("`summary` argument of subagent_done"));
    assert.ok(task?.content.includes("If the user closes the session instead"));
  });
});

describe("launch plan: structure", () => {
  it("pane start carries the launch script path beside the caller pane", () => {
    const fx = makeFixture();
    const p = plan(fx, { cwd: fx.cwd });
    assert.equal(p.paneStart.launchScriptFile, p.launchScriptFile);
    assert.equal(p.paneStart.cwd, fx.cwd);
    assert.equal(p.paneStart.name, "Worker");
    assert.equal(p.paneStart.targetPaneId, "w1:p1");
    assert.equal(p.paneStart.direction, "right");
    assert.match(p.launchScriptFile, /subagent-scripts\/worker-abcd1234\.sh$/);
    assert.ok(p.launchScriptFile.includes(join("artifacts", "orch-session-id")));
  });

  it("defaults cwd to the orchestrator cwd", () => {
    const fx = makeFixture();
    const p = plan(fx);
    assert.equal(p.paneStart.cwd, fx.cwd);
    assert.ok(scriptOf(p).includes(`cd ${shellEscape(fx.cwd)}`));
  });

  it("session file lives under the per-cwd session dir and carries the id", () => {
    const fx = makeFixture();
    const p = plan(fx);
    assert.ok(p.sessionFile.endsWith(".jsonl"));
    assert.ok(p.sessionFile.includes("abcd1234"));
    assert.ok(p.sessionFile.includes(join(fx.agentDir, "sessions")));
  });

  it("rejects cli: claude with a clear unsupported error", () => {
    const fx = makeFixture();
    assert.throws(
      () => plan(fx, { agent: "cc" }, { cli: "claude" }),
      /not supported by pi-herdr-subagents/,
    );
  });

  it("generated script passes bash -n", () => {
    const fx = makeFixture();
    writeFileSync(join(fx.cwd, ".envrc"), "use devenv\n");
    const p = plan(fx, { cwd: fx.cwd, agent: "worker" }, {
      autoExit: true,
      tools: "read,bash",
      skills: "commit",
      model: "anthropic/claude-x",
      thinking: "high",
      body: "You are a worker.",
      systemPromptMode: "append",
      denyTools: "web_search",
    });
    const scriptPath = join(fx.root, "check.sh");
    writeFileSync(scriptPath, scriptOf(p));
    execFileSync("bash", ["-n", scriptPath]); // throws on syntax error
  });
});

describe("ported helpers", () => {
  it("shellEscape single-quotes and escapes embedded quotes", () => {
    assert.equal(shellEscape("plain"), "'plain'");
    assert.equal(shellEscape("it's"), "'it'\\''s'");
    assert.equal(shellEscape(""), "''");
  });

  it("buildSubagentToolAllowlist preserves requested tools and adds child control tools", () => {
    assert.equal(
      buildSubagentToolAllowlist("read,bash,web_search"),
      "read,bash,web_search,caller_ping,subagent_done",
    );
  });

  it("buildSubagentToolAllowlist returns null without an explicit tool restriction", () => {
    assert.equal(buildSubagentToolAllowlist(undefined), null);
    assert.equal(buildSubagentToolAllowlist(""), null);
  });

  it("buildPiPromptArgs inserts separator for artifact-backed launches with skills", () => {
    assert.deepEqual(
      buildPiPromptArgs({ effectiveSkills: "review,lint", taskDelivery: "artifact", taskArg: "@artifact.md" }),
      ["", "/skill:review", "/skill:lint", "@artifact.md"],
    );
  });

  it("buildPiPromptArgs omits separator for artifact-backed launches without skills", () => {
    assert.deepEqual(
      buildPiPromptArgs({ effectiveSkills: undefined, taskDelivery: "artifact", taskArg: "@artifact.md" }),
      ["@artifact.md"],
    );
  });

  it("buildPiPromptArgs omits separator for direct launches with skills", () => {
    assert.deepEqual(
      buildPiPromptArgs({ effectiveSkills: "review", taskDelivery: "direct", taskArg: "do the task" }),
      ["/skill:review", "do the task"],
    );
  });
});

function persistPolicy(p: LaunchPlan) {
  const policy = p.files.find(f => f.path === launchPolicyPath(p.sessionFile))!;
  writeFileSync(policy.path, policy.content, { mode: 0o600 });
  return JSON.parse(policy.content);
}

describe('declared preflight at launch and resume planning', () => {
  it('refuses missing requirements in both callers and leaves undeclared plans compatible', () => {
    const fx = makeFixture();
    assert.throws(() => plan(fx, { preflight: { paths: ['missing-dependency'] } }), /Preflight/);
    const p = plan(fx, { preflight: { cwd: fx.cwd, executables: ['pi'] } });
    persistPolicy(p);
    assert.throws(() => buildResumeLaunchPlan({ sessionPath: p.sessionFile, preflight: { paths: ['missing-dependency'] } }, makeCtx(fx)), /Preflight/);
    assert.ok(buildResumeLaunchPlan({ sessionPath: p.sessionFile }, makeCtx(fx)));
  });
});

describe('saved launch policy and resume contract', () => {
  it('reapplies effective restrictions, role, model, thinking, cwd and agent directory without leaking env', () => {
    const fx = makeFixture();
    fx.env.SECRET_TOKEN = 'never-persist';
    const p = plan(fx, { cwd: fx.cwd, agent: 'advisor', model: 'provider/override' }, {
      tools: 'read,grep,find,ls', inheritSkills: false, spawning: false,
      denyTools: 'bash,write,edit', body: 'Read-only council role', systemPromptMode: 'replace',
      model: 'provider/default', thinking: 'high',
    });
    const policy = persistPolicy(p);
    assert.ok(!JSON.stringify(policy).includes('never-persist'));
    assert.ok(!('PATH' in policy));
    const challenge = 'Curated challenge: membership is not sorting.\nRespond to this exact evidence.';
    const resumed = buildResumeLaunchPlan({ sessionPath: p.sessionFile, message: challenge },
      makeCtx(fx, { parentCwd: '/different-parent' }));
    for (const flag of ['--approve', '--tools', '--model', '--system-prompt']) assert.ok(resumed.piArgv.includes(flag));
    assert.equal(resumed.piArgv[resumed.piArgv.indexOf('--tools') + 1], policy.tools);
    assert.equal(resumed.piArgv[resumed.piArgv.indexOf('--model') + 1], 'provider/override');
    assert.equal(resumed.piArgv[resumed.piArgv.indexOf('--thinking') + 1], 'high');
    assert.ok(resumed.piArgv.includes('--no-skills'));
    assert.equal(resumed.paneStart.cwd, fx.cwd);
    const script = resumed.files.find(f => f.path === resumed.launchScriptFile)!.content;
    assert.ok(script.includes(`PI_CODING_AGENT_DIR=${shellEscape(fx.agentDir)}`));
    assert.ok(script.includes(`PI_DENY_TOOLS=${shellEscape(policy.denyTools)}`));
    assert.ok(script.includes("PI_SUBAGENT_AGENT='advisor'"));
    assert.ok(!script.includes('never-persist'));
    assert.equal(resumed.files.find(f => f.path === resumed.resumeMessageFile)!.content, challenge);
    const roleFile = resumed.piArgv[resumed.piArgv.indexOf('--system-prompt') + 1];
    assert.equal(resumed.files.find(f => f.path === roleFile)!.content, policy.role);
    assert.ok(!resumed.piArgv.includes('--print') && !resumed.piArgv.includes('--mode'));
    assert.ok(!/export HERDR_(PANE_ID|SOCKET_PATH|ENV)=/.test(script));
  });
  it('preserves inherited skills and task-embedded role with append semantics', () => {
    const fx = makeFixture(); const p = plan(fx, {}, { body: 'Original role' }); persistPolicy(p);
    const resumed = buildResumeLaunchPlan({ sessionPath: p.sessionFile }, makeCtx(fx));
    assert.ok(!resumed.piArgv.includes('--no-skills'));
    assert.ok(resumed.piArgv.includes('--append-system-prompt'));
  });
  it('refuses legacy, malformed, and uncurated policy rather than widening restrictions', () => {
    const fx = makeFixture(); const p = plan(fx);
    const resume = () => buildResumeLaunchPlan({ sessionPath: p.sessionFile }, makeCtx(fx));
    assert.throws(resume, /legacy session.*Resume refused/);
    writeFileSync(launchPolicyPath(p.sessionFile), '{broken'); assert.throws(resume);
    const policy = persistPolicy(p);
    writeFileSync(launchPolicyPath(p.sessionFile), JSON.stringify({ ...policy, env: { SECRET: 'no' } }));
    assert.throws(resume, /Invalid saved launch policy/);
  });
  it('keeps one conventional reporter through agent-dir override and resume', () => {
    const fx = makeFixture();
    mkdirSync(join(fx.agentDir, 'extensions'));
    const reporter = join(fx.agentDir, 'extensions', 'herdr-agent-state.ts');
    writeFileSync(reporter, 'export default () => {};');
    const normal = plan(fx); assert.ok(!normal.piArgv.includes(reporter), 'autoload owns normal reporter');
    const childDir = join(fx.cwd, '.pi', 'agent'); mkdirSync(childDir, { recursive: true });
    const p = plan(fx, { cwd: fx.cwd }); persistPolicy(p);
    assert.equal(p.piArgv.filter(a => a === reporter).length, 1);
    const resumed = buildResumeLaunchPlan({ sessionPath: p.sessionFile }, makeCtx(fx));
    assert.equal(resumed.piArgv.filter(a => a === reporter).length, 1);
    assert.equal(resumed.paneStart.targetPaneId, 'w1:p1');
    rmSync(reporter); assert.throws(() => buildResumeLaunchPlan({ sessionPath: p.sessionFile }, makeCtx(fx)), /reporter.*missing/);
  });
  it('requires reporter setup for overridden agent dirs; supports explicit configurable path', () => {
    const fx = makeFixture(); mkdirSync(join(fx.cwd, '.pi', 'agent'), { recursive: true });
    assert.throws(() => plan(fx, { cwd: fx.cwd }), /sidebar reporting/);
    const reporter = join(fx.root, 'installed-reporter.ts'); writeFileSync(reporter, 'export default () => {};');
    fx.env.PI_HERDR_REPORTER_EXTENSION = reporter;
    const p = plan(fx, { cwd: fx.cwd }); persistPolicy(p);
    assert.equal(p.piArgv.filter(a => a === reporter).length, 1);
    delete fx.env.PI_HERDR_REPORTER_EXTENSION;
    const resumed = buildResumeLaunchPlan({ sessionPath: p.sessionFile }, makeCtx(fx));
    assert.equal(resumed.piArgv.filter(a => a === reporter).length, 1);
  });
});


describe('reporter duplicate and missing-path safeguards', () => {
  it('autoloaded child reporter is saved and not explicitly loaded again on resume', () => {
    const fx = makeFixture(); const dir = join(fx.cwd, '.pi', 'agent');
    mkdirSync(join(dir, 'extensions'), { recursive: true });
    const reporter = join(dir, 'extensions', 'herdr-agent-state.ts'); writeFileSync(reporter, 'export default () => {};');
    const p = plan(fx, { cwd: fx.cwd }); const policy = persistPolicy(p);
    assert.equal(policy.reporterExtension, reporter); assert.ok(!p.piArgv.includes(reporter));
    assert.ok(!buildResumeLaunchPlan({ sessionPath: p.sessionFile }, makeCtx(fx)).piArgv.includes(reporter));
    rmSync(reporter);
    assert.throws(() => buildResumeLaunchPlan({ sessionPath: p.sessionFile }, makeCtx(fx)), /reporter.*missing/);
  });
  it('symlinked conventional reporter and explicit path do not create two loads', () => {
    const fx = makeFixture(); const reporter = join(fx.root, 'reporter.ts');
    writeFileSync(reporter, 'export default () => {};'); mkdirSync(join(fx.agentDir, 'extensions'));
    symlinkSync(reporter, join(fx.agentDir, 'extensions', 'herdr-agent-state.ts'));
    fx.env.PI_HERDR_REPORTER_EXTENSION = reporter;
    const p = plan(fx); persistPolicy(p);
    assert.equal(p.piArgv.filter(a => a === reporter).length, 0);
    assert.equal(buildResumeLaunchPlan({ sessionPath: p.sessionFile }, makeCtx(fx)).piArgv.filter(a => a === reporter).length, 0);
  });
  it('fails on a missing explicit reporter and conflicting resume autoload', () => {
    const fx = makeFixture();
    fx.env.PI_HERDR_REPORTER_EXTENSION = join(fx.root, 'missing.ts');
    assert.throws(() => plan(fx), /reporter extension is missing/);
    const reporter = join(fx.root, 'reporter.ts'); writeFileSync(reporter, 'export default () => {};');
    fx.env.PI_HERDR_REPORTER_EXTENSION = reporter; const p = plan(fx); persistPolicy(p);
    mkdirSync(join(fx.agentDir, 'extensions'));
    writeFileSync(join(fx.agentDir, 'extensions', 'herdr-agent-state.ts'), 'different reporter');
    assert.throws(() => buildResumeLaunchPlan({ sessionPath: p.sessionFile }, makeCtx(fx)), /Conflicting Herdr reporters/);
  });
});

describe('complete persisted policy schema', () => {
  it('serializes intentional absence as required null fields and preserves default selections', () => {
    const fx = makeFixture(); const p = plan(fx); const policy = persistPolicy(p);
    assert.equal(policy.version, 2);
    for (const field of ['agent', 'model', 'thinking', 'tools', 'role', 'roleMode', 'denyTools', 'reporterExtension']) {
      assert.ok(Object.hasOwn(policy, field), field);
      assert.equal(policy[field], null, field);
    }
    assert.equal(policy.noSkills, false);
    const resumed = buildResumeLaunchPlan({ sessionPath: p.sessionFile }, makeCtx(fx));
    for (const flag of ['--tools', '--model', '--thinking', '--system-prompt', '--append-system-prompt', '--no-skills']) {
      assert.ok(!resumed.piArgv.includes(flag), flag);
    }
  });
  it('rejects deletion of every field, including restrictions from a read-only policy', () => {
    const fx = makeFixture();
    const p = plan(fx, { agent: 'reviewer' }, {
      tools: 'read,grep,find,ls', inheritSkills: false, spawning: false,
      body: 'Stay read-only', systemPromptMode: 'replace', model: 'provider/model', thinking: 'high',
    });
    const policy = persistPolicy(p);
    for (const field of Object.keys(policy)) {
      const stripped = { ...policy }; delete stripped[field];
      writeFileSync(launchPolicyPath(p.sessionFile), JSON.stringify(stripped));
      assert.throws(() => buildResumeLaunchPlan({ sessionPath: p.sessionFile }, makeCtx(fx)), /Invalid saved launch policy/, field);
    }
  });
  it('rejects empty, mistyped, legacy and inconsistent restriction values', () => {
    const fx = makeFixture();
    const p = plan(fx, {}, { tools: 'read', body: 'Reviewer role', systemPromptMode: 'replace', spawning: false });
    const policy = persistPolicy(p);
    const mutations: Record<string, unknown>[] = [];
    for (const field of Object.keys(policy).filter(key => !['version', 'noSkills'].includes(key))) {
      mutations.push({ [field]: '' }, { [field]: '   ' });
    }
    mutations.push(
      { version: 1 }, { noSkills: null }, { noSkills: 'false' },
      { role: null }, { roleMode: null }, { roleMode: 'invalid' },
      { tools: 'read,,caller_ping,subagent_done' }, { tools: 'read' },
      { tools: '+read,caller_ping,subagent_done' }, { denyTools: ',' },
      { thinking: 'unknown' }, { reporterExtension: 'relative.ts' },
    );
    for (const mutation of mutations) {
      writeFileSync(launchPolicyPath(p.sessionFile), JSON.stringify({ ...policy, ...mutation }));
      assert.throws(() => buildResumeLaunchPlan({ sessionPath: p.sessionFile }, makeCtx(fx)), /Invalid saved launch policy/, JSON.stringify(mutation));
    }
  });
});

it('same-second default-name resumes retain distinct exact challenge artifacts', () => {
  const fx = makeFixture();
  const first = plan(fx, {}, { tools: 'read' }, { id: 'advisor-a' }); persistPolicy(first);
  const second = plan(fx, {}, { tools: 'read' }, { id: 'advisor-b' }); persistPolicy(second);
  const now = new Date('2026-10-30T10:20:30.000Z');
  const resumes = [first, second].map((child, index) => buildResumeLaunchPlan({
    sessionPath: child.sessionFile, message: `Exact challenge for advisor ${index}`,
  }, makeCtx(fx, { now, id: `cross-${index}` })));
  assert.equal(resumes[0].name, 'Resume'); assert.equal(resumes[1].name, 'Resume');
  assert.notEqual(resumes[0].resumeMessageFile, resumes[1].resumeMessageFile);
  const written = new Map<string, string>();
  for (const resume of resumes) for (const file of resume.files) written.set(file.path, file.content);
  for (const [index, resume] of resumes.entries()) {
    assert.ok(resume.resumeMessageFile!.includes(`cross-${index}`));
    assert.equal(written.get(resume.resumeMessageFile!), `Exact challenge for advisor ${index}`);
    assert.ok(resume.piArgv.includes(`@${resume.resumeMessageFile}`));
  }
});
