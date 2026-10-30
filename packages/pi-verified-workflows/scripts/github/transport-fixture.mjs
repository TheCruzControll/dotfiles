import { readFileSync, writeFileSync } from 'node:fs';

import { GuardrailStop, normalizeIssue } from './common.mjs';

function readState(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeState(path, state) {
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function appendLog(logPath, entry) {
  if (!logPath) {
    return;
  }

  writeFileSync(logPath, `${JSON.stringify(entry)}\n`, {
    encoding: 'utf8',
    flag: 'a',
  });
}

function repoKey(owner, name) {
  return `${owner}/${name}`;
}

function nextUpdatedAt(previousValue) {
  const previousMs = previousValue ? Date.parse(previousValue) : Number.NaN;
  const baseMs = Number.isNaN(previousMs) ? Date.parse('2024-01-01T00:00:00.000Z') : previousMs;
  return new Date(baseMs + 1000).toISOString();
}

function normalizeFixtureIssue(rawIssue) {
  const normalized = normalizeIssue(rawIssue);
  return {
    ...normalized,
    htmlUrl:
      normalized.htmlUrl ??
      rawIssue.html_url ??
      `https://github.com/${rawIssue.__repoKey ?? 'example/example'}/issues/${normalized.number}`,
  };
}

function takeBehavior(repository, key) {
  const behaviors = repository.writeBehaviors?.[key];
  if (!Array.isArray(behaviors) || behaviors.length === 0) {
    return null;
  }

  const [nextBehavior, ...remaining] = behaviors;
  repository.writeBehaviors[key] = remaining;
  return nextBehavior;
}

function applyBehavior(behavior, issue) {
  if (!behavior) {
    return issue;
  }

  if (behavior.type === 'error') {
    throw new GuardrailStop(
      behavior.code ?? 'ambiguous_result',
      behavior.message ?? 'Fixture transport reported an ambiguous mutation outcome.',
    );
  }

  if (behavior.type === 'persist_override') {
    return {
      ...issue,
      ...behavior.fields,
      updatedAt: behavior.fields?.updatedAt ?? issue.updatedAt,
    };
  }

  return issue;
}

export function createFixtureTransport(environment = process.env) {
  const statePath = environment.PI_GITHUB_FIXTURE_STATE_FILE;
  if (!statePath) {
    throw new Error('PI_GITHUB_FIXTURE_STATE_FILE is required for fixture transport.');
  }

  const logPath = environment.PI_GITHUB_FIXTURE_LOG_FILE ?? null;
  let sequence = 0;

  function withState(actionName, write, fn) {
    const state = readState(statePath);
    sequence += 1;
    appendLog(logPath, {
      sequence,
      action: actionName,
      write,
    });
    const result = fn(state);
    if (write) {
      writeState(statePath, state);
    }
    return result;
  }

  function getRepositoryRecord(state, owner, name) {
    const key = repoKey(owner, name);
    const repository = state.repositories?.[key];
    if (!repository) {
      throw new GuardrailStop('validation_failed', `Fixture repository ${key} was not found.`);
    }
    return { key, repository };
  }

  return {
    async getActor({ host }) {
      return withState('getActor', false, (state) => ({
        login: state.actor?.login,
        host: state.actor?.host ?? host,
      }));
    },

    async getRepository({ host, owner, name }) {
      return withState('getRepository', false, (state) => {
        const { key, repository } = getRepositoryRecord(state, owner, name);
        return {
          host,
          owner,
          name,
          fullName: key,
          private: Boolean(repository.private),
          permissions: repository.permissions ?? {},
        };
      });
    },

    async listIssues({ owner, name }) {
      return withState('listIssues', false, (state) => {
        const { key, repository } = getRepositoryRecord(state, owner, name);
        return (repository.issues ?? []).map((issue) => normalizeFixtureIssue({ ...issue, __repoKey: key }));
      });
    },

    async getIssue({ owner, name, number }) {
      return withState('getIssue', false, (state) => {
        const { key, repository } = getRepositoryRecord(state, owner, name);
        const issue = (repository.issues ?? []).find((item) => Number(item.number) === Number(number));
        return issue ? normalizeFixtureIssue({ ...issue, __repoKey: key }) : null;
      });
    },

    async createIssue({ owner, name, title, body }) {
      return withState('createIssue', true, (state) => {
        const { key, repository } = getRepositoryRecord(state, owner, name);
        repository.nextIssueId = repository.nextIssueId ?? 1000;
        repository.nextIssueNumber = repository.nextIssueNumber ?? 1;

        let issue = {
          id: repository.nextIssueId,
          number: repository.nextIssueNumber,
          title,
          body,
          state: 'open',
          stateReason: null,
          updatedAt: nextUpdatedAt(repository.lastUpdatedAt ?? null),
          htmlUrl: `https://github.com/${key}/issues/${repository.nextIssueNumber}`,
          pullRequest: false,
        };

        repository.nextIssueId += 1;
        repository.nextIssueNumber += 1;
        repository.lastUpdatedAt = issue.updatedAt;

        const behavior = takeBehavior(repository, 'createIssue');
        issue = applyBehavior(behavior, issue);

        repository.issues = [...(repository.issues ?? []), issue];
        return normalizeFixtureIssue({ ...issue, __repoKey: key });
      });
    },

    async patchIssue({ owner, name, number, fields }) {
      return withState('patchIssue', true, (state) => {
        const { key, repository } = getRepositoryRecord(state, owner, name);
        const index = (repository.issues ?? []).findIndex((item) => Number(item.number) === Number(number));
        if (index === -1) {
          throw new GuardrailStop('validation_failed', `Fixture issue #${number} was not found.`);
        }

        const currentIssue = normalizeFixtureIssue({ ...repository.issues[index], __repoKey: key });
        let nextIssue = {
          ...currentIssue,
          ...(Object.prototype.hasOwnProperty.call(fields, 'title') ? { title: fields.title } : {}),
          ...(Object.prototype.hasOwnProperty.call(fields, 'body') ? { body: fields.body } : {}),
          ...(Object.prototype.hasOwnProperty.call(fields, 'state') ? { state: fields.state } : {}),
        };

        if (Object.prototype.hasOwnProperty.call(fields, 'state')) {
          nextIssue.stateReason = fields.state === 'closed' ? (fields.stateReason ?? null) : null;
        }

        nextIssue.updatedAt = nextUpdatedAt(currentIssue.updatedAt);
        repository.lastUpdatedAt = nextIssue.updatedAt;

        const behavior = takeBehavior(repository, `patchIssue:${number}`);
        nextIssue = applyBehavior(behavior, nextIssue);

        repository.issues[index] = nextIssue;
        return normalizeFixtureIssue({ ...nextIssue, __repoKey: key });
      });
    },
  };
}
