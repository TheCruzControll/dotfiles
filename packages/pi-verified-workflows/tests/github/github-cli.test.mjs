import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, '../..');
const planScript = resolve(packageRoot, 'scripts/github/plan.mjs');
const applyScript = resolve(packageRoot, 'scripts/github/apply.mjs');

function createWorkspace() {
  return mkdtempSync(join(tmpdir(), 'pi-verified-workflows-github-test-'));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readJsonLines(path) {
  const content = readFileSync(path, 'utf8').trim();
  if (!content) {
    return [];
  }
  return content.split('\n').map((line) => JSON.parse(line));
}

function runCli(scriptPath, args, environment) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: packageRoot,
    env: {
      ...process.env,
      ...environment,
    },
    encoding: 'utf8',
  });

  return {
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
    json: JSON.parse(result.stdout),
  };
}

function fixtureState(issues, writeBehaviors = {}) {
  return {
    actor: {
      login: 'octocat',
      host: 'github.com',
    },
    repositories: {
      'acme/widgets': {
        private: false,
        permissions: {
          push: true,
        },
        nextIssueId: 900,
        nextIssueNumber: 10,
        lastUpdatedAt: '2024-01-01T00:00:00.000Z',
        issues,
        writeBehaviors,
      },
    },
  };
}

function issue(number, overrides = {}) {
  return {
    id: 100 + number,
    number,
    title: `Issue ${number}`,
    body: `Body ${number}`,
    state: 'open',
    stateReason: null,
    updatedAt: `2024-01-01T00:00:0${number}.000Z`,
    htmlUrl: `https://github.com/acme/widgets/issues/${number}`,
    pullRequest: false,
    ...overrides,
  };
}

function baseRequest(operations) {
  return {
    actor: {
      login: 'octocat',
      host: 'github.com',
    },
    repository: {
      owner: 'acme',
      name: 'widgets',
      host: 'github.com',
    },
    operations,
  };
}

function approvePlan(planPath) {
  const plan = readJson(planPath);
  plan.approval = {
    status: 'approved',
    planDigest: plan.binding.planDigest,
    approvedAt: '2026-01-02T03:04:05.000Z',
    approvedBy: 'reviewer',
  };
  writeJson(planPath, plan);
  return plan;
}

function envFor(statePath, logPath) {
  return {
    PI_GITHUB_TRANSPORT: 'fixture',
    PI_GITHUB_FIXTURE_STATE_FILE: statePath,
    PI_GITHUB_FIXTURE_LOG_FILE: logPath,
  };
}

test('github:plan previews changes without any write calls', () => {
  const workspace = createWorkspace();
  const statePath = join(workspace, 'state.json');
  const requestPath = join(workspace, 'request.json');
  const planPath = join(workspace, 'plan.json');
  const logPath = join(workspace, 'plan.log.jsonl');

  writeJson(statePath, fixtureState([
    issue(1, { body: 'Original body' }),
  ]));
  writeJson(requestPath, baseRequest([
    {
      id: 'close-1',
      type: 'update_issue',
      issue: { number: 1 },
      body: 'Approved replacement body',
      state: 'closed',
      stateReason: 'completed',
    },
  ]));

  const result = runCli(planScript, ['--input', requestPath, '--output', planPath], envFor(statePath, logPath));

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.json.ok, true);
  assert.equal(result.json.operation, 'github:plan');
  assert.equal(typeof result.json.plan.operations[0].verification.body, 'object');
  assert.equal(result.json.plan.operations[0].verification.body.sha256.length, 64);

  const plan = readJson(planPath);
  assert.equal(plan.operations[0].stepType, 'patch_issue');
  assert.deepEqual(plan.operations[0].mutation, {
    body: 'Approved replacement body',
    state: 'closed',
    stateReason: 'completed',
  });
  assert.equal(plan.operations[0].verification.stateReason, 'completed');

  const log = readJsonLines(logPath);
  assert.deepEqual(log.map((entry) => entry.action), ['getActor', 'getRepository', 'getIssue']);
  assert.equal(log.some((entry) => entry.write), false);
});

test('github duplicate marker planning becomes an approved no-op and apply performs no write', () => {
  const workspace = createWorkspace();
  const statePath = join(workspace, 'state.json');
  const requestPath = join(workspace, 'request.json');
  const planPath = join(workspace, 'plan.json');
  const planLogPath = join(workspace, 'plan.log.jsonl');
  const applyLogPath = join(workspace, 'apply.log.jsonl');
  const marker = '<!-- pi-operation: duplicate-123 -->';
  const body = `Approved body\n\n${marker}`;

  writeJson(statePath, fixtureState([
    issue(7, { title: 'Approved title', body }),
  ]));
  writeJson(requestPath, baseRequest([
    {
      id: 'create-duplicate-safe',
      type: 'create_issue',
      title: 'Approved title',
      body,
      marker,
    },
  ]));

  const planResult = runCli(planScript, ['--input', requestPath, '--output', planPath], envFor(statePath, planLogPath));
  assert.equal(planResult.status, 0, planResult.stderr);

  const plan = readJson(planPath);
  assert.equal(plan.operations[0].stepType, 'no_op');
  assert.equal(plan.operations[0].target.issueNumber, 7);

  approvePlan(planPath);
  const applyResult = runCli(applyScript, ['--plan', planPath], envFor(statePath, applyLogPath));
  assert.equal(applyResult.status, 0, applyResult.stderr);
  assert.equal(applyResult.json.result.stats.mutationCount, 0);
  assert.equal(applyResult.json.result.stats.noOpCount, 1);

  const applyLog = readJsonLines(applyLogPath);
  assert.equal(applyLog.some((entry) => entry.action === 'createIssue' || entry.action === 'patchIssue'), false);
});

test('github:apply stops on stale remote state before any mutation', () => {
  const workspace = createWorkspace();
  const statePath = join(workspace, 'state.json');
  const requestPath = join(workspace, 'request.json');
  const planPath = join(workspace, 'plan.json');
  const applyLogPath = join(workspace, 'apply.log.jsonl');

  writeJson(statePath, fixtureState([
    issue(1, { body: 'Original body' }),
  ]));
  writeJson(requestPath, baseRequest([
    {
      id: 'edit-body',
      type: 'update_issue',
      issue: { number: 1 },
      body: 'Approved body',
    },
  ]));

  const planResult = runCli(planScript, ['--input', requestPath, '--output', planPath], envFor(statePath, join(workspace, 'plan.log.jsonl')));
  assert.equal(planResult.status, 0, planResult.stderr);
  approvePlan(planPath);

  const state = readJson(statePath);
  state.repositories['acme/widgets'].issues[0].body = 'Changed after approval';
  state.repositories['acme/widgets'].issues[0].updatedAt = '2024-01-02T00:00:00.000Z';
  writeJson(statePath, state);

  const applyResult = runCli(applyScript, ['--plan', planPath], envFor(statePath, applyLogPath));
  assert.equal(applyResult.status, 2);
  assert.equal(applyResult.json.ok, false);
  assert.equal(applyResult.json.code, 'stale_state');

  const applyLog = readJsonLines(applyLogPath);
  assert.equal(applyLog.some((entry) => entry.action === 'patchIssue' || entry.action === 'createIssue'), false);
});

test('github:apply mutates serially and verifies each write with a read-back', () => {
  const workspace = createWorkspace();
  const statePath = join(workspace, 'state.json');
  const requestPath = join(workspace, 'request.json');
  const planPath = join(workspace, 'plan.json');
  const applyLogPath = join(workspace, 'apply.log.jsonl');

  writeJson(statePath, fixtureState([
    issue(1, { body: 'One original' }),
    issue(2, { body: 'Two original' }),
  ]));
  writeJson(requestPath, baseRequest([
    {
      id: 'edit-1',
      type: 'update_issue',
      issue: { number: 1 },
      body: 'One approved',
    },
    {
      id: 'close-2',
      type: 'update_issue',
      issue: { number: 2 },
      body: 'Two approved',
      state: 'closed',
      stateReason: 'not_planned',
    },
  ]));

  const planResult = runCli(planScript, ['--input', requestPath, '--output', planPath], envFor(statePath, join(workspace, 'plan.log.jsonl')));
  assert.equal(planResult.status, 0, planResult.stderr);
  approvePlan(planPath);

  const applyResult = runCli(applyScript, ['--plan', planPath], envFor(statePath, applyLogPath));
  assert.equal(applyResult.status, 0, applyResult.stderr);
  assert.equal(applyResult.json.result.stats.mutationCount, 2);

  const applyLog = readJsonLines(applyLogPath).map((entry) => entry.action);
  const firstPatch = applyLog.indexOf('patchIssue');
  const firstVerify = applyLog.indexOf('getIssue', firstPatch + 1);
  const secondPatch = applyLog.indexOf('patchIssue', firstVerify + 1);
  const secondVerify = applyLog.indexOf('getIssue', secondPatch + 1);
  assert.notEqual(firstPatch, -1);
  assert.notEqual(firstVerify, -1);
  assert.notEqual(secondPatch, -1);
  assert.notEqual(secondVerify, -1);
  assert.ok(firstPatch < firstVerify && firstVerify < secondPatch && secondPatch < secondVerify);

  const state = readJson(statePath);
  const [firstIssue, secondIssue] = state.repositories['acme/widgets'].issues;
  assert.equal(firstIssue.body, 'One approved');
  assert.equal(firstIssue.state, 'open');
  assert.equal(secondIssue.body, 'Two approved');
  assert.equal(secondIssue.state, 'closed');
  assert.equal(secondIssue.stateReason, 'not_planned');
});

test('github:apply refuses ambiguous verification results and does not retry blindly', () => {
  const workspace = createWorkspace();
  const statePath = join(workspace, 'state.json');
  const requestPath = join(workspace, 'request.json');
  const planPath = join(workspace, 'plan.json');
  const applyLogPath = join(workspace, 'apply.log.jsonl');

  writeJson(statePath, fixtureState([
    issue(1, { body: 'Original body' }),
  ], {
    'patchIssue:1': [
      {
        type: 'persist_override',
        fields: {
          body: 'Tampered after write',
        },
      },
    ],
  }));
  writeJson(requestPath, baseRequest([
    {
      id: 'edit-1',
      type: 'update_issue',
      issue: { number: 1 },
      body: 'Approved body',
    },
  ]));

  const planResult = runCli(planScript, ['--input', requestPath, '--output', planPath], envFor(statePath, join(workspace, 'plan.log.jsonl')));
  assert.equal(planResult.status, 0, planResult.stderr);
  approvePlan(planPath);

  const applyResult = runCli(applyScript, ['--plan', planPath], envFor(statePath, applyLogPath));
  assert.equal(applyResult.status, 2);
  assert.equal(applyResult.json.code, 'ambiguous_result');

  const applyLog = readJsonLines(applyLogPath);
  assert.equal(applyLog.filter((entry) => entry.action === 'patchIssue').length, 1);
  assert.ok(applyLog.some((entry) => entry.action === 'getIssue'));

  const state = readJson(statePath);
  assert.equal(state.repositories['acme/widgets'].issues[0].body, 'Tampered after write');
});

test('github CLIs expose JSON help on stdout', () => {
  const planHelp = runCli(planScript, ['--help'], {});
  assert.equal(planHelp.status, 0);
  assert.equal(planHelp.json.ok, true);
  assert.equal(planHelp.json.operation, 'github:plan');
  assert.match(planHelp.json.help.usage, /--input/);

  const applyHelp = runCli(applyScript, ['--help'], {});
  assert.equal(applyHelp.status, 0);
  assert.equal(applyHelp.json.ok, true);
  assert.equal(applyHelp.json.operation, 'github:apply');
  assert.match(applyHelp.json.help.usage, /--plan/);
});
