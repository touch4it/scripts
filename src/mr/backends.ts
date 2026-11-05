import process from 'node:process';

import {log, spinner} from '@clack/prompts';

import {hasRef, push, revision} from '../lib/git.ts';
import {
  connectGlab, projectPath, type Glab, type GlabStatus,
} from '../lib/glab.ts';
import {bail, type Choice} from '../lib/prompts.ts';
import {newMergeRequestUrl, type Remote} from '../lib/remote.ts';
import {encodeDescription} from './template.ts';

export type MrRequest = {
  branch: string;
  target: string;
  title: string;
  body: string;
  assignee: string;
  reviewer: string;
  milestone: string;
};

export type Choices = {members?: Choice[]; milestones?: Choice[]};

export type Backend = {
  choices: Choices;
  create: (request: MrRequest, dryRun: boolean) => Promise<void>;
};

const ENV_FILE = '.env';

const isDraftTitle = (title: string): boolean => /^(WIP|Draft): /.test(title);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const records = (json: unknown): Array<Record<string, unknown>> => (Array.isArray(json) ? json.filter(isRecord) : []);

const textField = (record: Record<string, unknown>, key: string): string | undefined =>
  typeof record[key] === 'string' ? record[key] : undefined;

function uniqueSorted(choices: Choice[]): Choice[] {
  const byValue = new Map(choices.map(choice => [choice.value, choice]));
  return [...byValue.values()].sort((a, b) => a.value.localeCompare(b.value));
}

/** Active members from GitLab's members/all response. */
export function memberChoices(json: unknown): Choice[] {
  return uniqueSorted(records(json).flatMap(member => {
    const username = textField(member, 'username');
    return username && member.state === 'active' ? [{value: username, hint: textField(member, 'name')}] : [];
  }));
}

/** Titles from GitLab's milestones response, the due date as a hint. */
export function milestoneChoices(json: unknown): Choice[] {
  return uniqueSorted(records(json).flatMap(milestone => {
    const title = textField(milestone, 'title');
    return title ? [{value: title, hint: textField(milestone, 'due_date')}] : [];
  }));
}

function printDryRun(lines: string[]): void {
  process.stdout.write(`DRY RUN — would run:\n${lines.map(line => `  ${line}`).join('\n')}\n`);
}

function pushOptionsBackend(remote: Remote, branch: string): Backend {
  const remoteHead = hasRef(`refs/remotes/origin/${branch}`) ? revision(`refs/remotes/origin/${branch}`) : undefined;
  if (remoteHead && remoteHead === revision('HEAD')) {
    bail(`'${branch}' is already pushed and unchanged, so this push would move no ref.\n`
      + 'GitLab only applies push options on a ref update — no MR would be created.\n'
      + `Add a commit, or open it in the UI:\n  ${
        newMergeRequestUrl({...remote, branch})}`);
  }

  return {
    choices: {},
    async create(request, dryRun) {
      const options = [
        '-o',
        'merge_request.create',
        '-o',
        `merge_request.target=${request.target}`,
        '-o',
        `merge_request.title=${request.title}`,
        '-o',
        `merge_request.description=${encodeDescription(request.body)}`,
      ];
      if (request.assignee) {
        options.push('-o', `merge_request.assign=${request.assignee}`);
      }

      if (request.milestone) {
        options.push('-o', `merge_request.milestone=${request.milestone}`);
      }

      if (isDraftTitle(request.title)) {
        options.push('-o', 'merge_request.draft');
      }

      if (dryRun) {
        printDryRun(['git push --set-upstream', ...options]);
        return;
      }

      const {code, output} = await push({options, branch: request.branch});
      if (code !== 0) {
        bail('push failed');
      }

      if (output.includes('WARNINGS')) {
        bail('GitLab reported push-option warnings above — the merge request may not have been created');
      }
    },
  };
}

async function loadChoices(glab: Glab, remote: Remote): Promise<Choices> {
  const project = projectPath(remote.project);
  async function load(path: string, parse: (json: unknown) => Choice[]): Promise<Choice[] | undefined> {
    try {
      return parse(await glab.getJson(`${project}/${path}`));
    } catch {
      return undefined;
    }
  }

  const loading = spinner();
  loading.start(`Loading members and milestones from ${glab.host}`);
  const [members, milestones] = await Promise.all([
    load('members/all?per_page=100', memberChoices),
    load('milestones?state=active&include_ancestors=true&per_page=100', milestoneChoices),
  ]);
  loading.stop(`Using glab on ${glab.host}`);

  for (const [what, list] of [['members', members], ['milestones', milestones]] as const) {
    if (!list) {
      log.warn(`could not load ${what} through glab, so that prompt takes free text`);
    }
  }

  return {members, milestones};
}

async function glabBackend(glab: Glab, remote: Remote): Promise<Backend> {
  const choices = await loadChoices(glab, remote);

  return {
    choices,
    async create(request, dryRun) {
      const args = [
        'mr',
        'create',
        '--repo',
        `https://${remote.host}/${remote.project}`,
        '--source-branch',
        request.branch,
        '--target-branch',
        request.target,
        '--title',
        request.title,
        '--description-file',
        '-',
        '--yes',
      ];
      if (request.assignee) {
        args.push('--assignee', request.assignee);
      }

      if (request.reviewer) {
        args.push('--reviewer', request.reviewer);
      }

      if (request.milestone) {
        args.push('--milestone', request.milestone);
      }

      if (isDraftTitle(request.title)) {
        args.push('--draft');
      }

      if (dryRun) {
        printDryRun([`git push --set-upstream origin HEAD:refs/heads/${request.branch}`, `glab ${args.join(' ')}  (description on stdin)`]);
        return;
      }

      const {code} = await push({options: [], branch: request.branch});
      if (code !== 0) {
        bail('push failed');
      }

      if (await glab.exec(args, request.body) !== 0) {
        bail(`glab could not create the merge request. The branch is pushed, so you can open it in the UI:\n  ${
          newMergeRequestUrl({...remote, branch: request.branch})}`);
      }
    },
  };
}

/** Glab when it is logged in to the origin host, git push options otherwise. */
export async function connectBackend(remote: Remote, branch: string): Promise<Backend> {
  const status: GlabStatus = await connectGlab(remote.host, ENV_FILE);
  switch (status.kind) {
    case 'ready': {
      return glabBackend(status.glab, remote);
    }

    case 'logged-out': {
      log.info(`glab is not logged in to ${status.host}, so mr uses git push options.\n`
        + `For member and milestone lists, run glab auth login --hostname ${status.host},\n`
        + `or set GITLAB_TOKEN and GITLAB_HOST=${status.host} in ${ENV_FILE}`);
      return pushOptionsBackend(remote, branch);
    }

    case 'missing': {
      return pushOptionsBackend(remote, branch);
    }
  }
}
