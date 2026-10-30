import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { GuardrailStop, normalizeIssue } from './common.mjs';

function runGh({ args, inputObject }) {
  let tempDirectory = null;
  const fullArgs = [...args];

  try {
    if (inputObject !== undefined) {
      tempDirectory = mkdtempSync(join(tmpdir(), 'pi-verified-workflows-github-'));
      const inputPath = join(tempDirectory, 'input.json');
      writeFileSync(inputPath, `${JSON.stringify(inputObject, null, 2)}\n`, 'utf8');
      fullArgs.push('--input', inputPath);
    }

    const result = spawnSync('gh', fullArgs, {
      encoding: 'utf8',
      timeout: 60_000,
      maxBuffer: 10 * 1024 * 1024,
    });

    if (result.error) {
      throw result.error;
    }

    if (result.status !== 0) {
      throw new Error(result.stderr.trim() || `gh exited with status ${result.status}`);
    }

    const stdout = result.stdout.trim();
    return stdout.length === 0 ? null : JSON.parse(stdout);
  } catch (error) {
    if (error instanceof GuardrailStop) {
      throw error;
    }

    throw new Error(`gh command failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (tempDirectory) {
      rmSync(tempDirectory, { force: true, recursive: true });
    }
  }
}

function normalizeRepository(rawRepository, { host, owner, name }) {
  return {
    host,
    owner,
    name,
    fullName: rawRepository.full_name,
    private: Boolean(rawRepository.private),
    permissions: rawRepository.permissions ?? {},
  };
}

export function createGhTransport() {
  return {
    async getActor({ host }) {
      const actor = runGh({
        args: ['api', '--hostname', host, 'user'],
      });
      return {
        login: actor.login,
        host,
      };
    },

    async getRepository({ host, owner, name }) {
      const repository = runGh({
        args: ['api', '--hostname', host, `repos/${owner}/${name}`],
      });
      return normalizeRepository(repository, { host, owner, name });
    },

    async listIssues({ host, owner, name }) {
      const issues = [];
      let page = 1;

      while (true) {
        const pageItems = runGh({
          args: [
            'api',
            '--hostname',
            host,
            `repos/${owner}/${name}/issues?state=all&per_page=100&page=${page}`,
          ],
        });

        if (!Array.isArray(pageItems)) {
          throw new Error('Expected an array response when listing issues.');
        }

        issues.push(...pageItems.map((item) => normalizeIssue(item)));

        if (pageItems.length < 100) {
          break;
        }

        page += 1;
      }

      return issues;
    },

    async getIssue({ host, owner, name, number }) {
      const issue = runGh({
        args: ['api', '--hostname', host, `repos/${owner}/${name}/issues/${number}`],
      });
      return normalizeIssue(issue);
    },

    async createIssue({ host, owner, name, title, body }) {
      const issue = runGh({
        args: ['api', '--hostname', host, '--method', 'POST', `repos/${owner}/${name}/issues`],
        inputObject: {
          title,
          body,
        },
      });
      return normalizeIssue(issue);
    },

    async patchIssue({ host, owner, name, number, fields }) {
      const inputObject = {
        ...(Object.prototype.hasOwnProperty.call(fields, 'title') ? { title: fields.title } : {}),
        ...(Object.prototype.hasOwnProperty.call(fields, 'body') ? { body: fields.body } : {}),
        ...(Object.prototype.hasOwnProperty.call(fields, 'state') ? { state: fields.state } : {}),
      };

      if (Object.prototype.hasOwnProperty.call(fields, 'state') && fields.state === 'closed') {
        inputObject.state_reason = fields.stateReason ?? null;
      }

      const issue = runGh({
        args: ['api', '--hostname', host, '--method', 'PATCH', `repos/${owner}/${name}/issues/${number}`],
        inputObject,
      });
      return normalizeIssue(issue);
    },
  };
}
