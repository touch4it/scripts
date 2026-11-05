import process from 'node:process';
import {existsSync, readFileSync} from 'node:fs';

import {
  confirm, intro, log, multiselect, outro,
} from '@clack/prompts';

import {
  commitsAhead,
  currentBranch,
  fetchOrigin,
  firstCommitSubject,
  hasRef,
  isDirty,
  originUrl,
  push,
  repoRoot,
  revision,
} from '../lib/git.ts';
import {
  ask, askMultiline, askText, bail, BACK, required, runSteps, stepAnswer, type Step,
} from '../lib/prompts.ts';
import {newMergeRequestUrl, parseRemote, type Remote} from '../lib/remote.ts';
import {
  assembleBody,
  encodeDescription,
  hasSlot,
  parseTasks,
  parseTemplate,
  reviewerValue,
  TemplateError,
  templateValue,
  type Template,
} from './template.ts';

const TEMPLATE = '.gitlab/merge_request_templates/Default.md';
const PROTECTED = ['master', 'master-next', 'qa', 'staging', 'production'];

export type MrOptions = {
  dryRun?: boolean;
};

type Draft = {
  target: string;
  title: string;
  description: string;
  assignee: string;
  reviewer: string;
  milestone: string;
  done: boolean[];
  explanation: string;
};

type Context = {
  branch: string;
  template: Template;
  tasks: string[];
};

function readTemplate(text: string): Template {
  try {
    return parseTemplate(text);
  } catch (error) {
    if (error instanceof TemplateError) {
      bail(`${TEMPLATE}: ${error.message}`);
    }

    throw error;
  }
}

function targetProblem(target: string): string | undefined {
  if (!hasRef(`refs/remotes/origin/${target}`)) {
    return `no origin/${target} to compare against`;
  }

  if (commitsAhead(target) === 0) {
    return `no commits ahead of origin/${target}`;
  }

  return undefined;
}

const requireText = (what: string) => (value: string): string | undefined => (value ? undefined : `${what} is required`);

function bodyOf({template}: Context, draft: Draft): string {
  const needsExplanation = hasSlot(template, 'explanation') && draft.done.includes(false);
  return assembleBody(template, {
    description: draft.description,
    explanation: needsExplanation ? draft.explanation : '',
    reviewer: draft.reviewer,
    done: draft.done,
  });
}

function draftSteps(context: Context): Array<Step<Draft>> {
  const {branch, template, tasks} = context;
  const toField = <Key extends keyof Draft>(key: Key) => (value: Draft[Key] | typeof BACK): Partial<Draft> | typeof BACK =>
    value === BACK ? BACK : {[key]: value};

  return [
    {
      ask: async draft => toField('target')(await askText('Target branch', draft.target, targetProblem)),
    },
    {
      ask: async draft => toField('title')(await askText(
        'Title',
        draft.title || firstCommitSubject(draft.target),
        requireText('Title'),
      )),
    },
    {
      ask: async draft => toField('description')(await askMultiline('Description — what is this for?', {
        placeholder: 'Link a Redmine issue if there is one.',
        initialValue: draft.description,
        validate: requireText('Description'),
      })),
    },
    {ask: async draft => toField('assignee')(await ask('Assignee', draft.assignee))},
    {ask: async draft => toField('reviewer')(await ask('Reviewer', draft.reviewer))},
    {ask: async draft => toField('milestone')(await ask('Milestone', draft.milestone))},
    {
      async ask(draft) {
        const selected = await stepAnswer(multiselect({
          message: 'Requirements — space marks Done, enter confirms.',
          options: tasks.map((task, index) => ({value: index, label: task})),
          initialValues: tasks.flatMap((_, index) => (draft.done[index] ? [index] : [])),
          required: false,
        }));
        return selected === BACK ? BACK : {done: tasks.map((_, index) => selected.includes(index))};
      },
    },
    {
      when: draft => hasSlot(template, 'explanation') && draft.done.includes(false),
      ask: async draft => toField('explanation')(await askMultiline(
        `${draft.done.filter(isDone => !isDone).length} row(s) not marked Done — why?`,
        {placeholder: 'optional', initialValue: draft.explanation},
      )),
    },
    {
      async ask(draft) {
        log.step([
          `Title:     ${draft.title}`,
          `Branch:    ${branch} -> ${draft.target}`,
          `Assignee:  ${draft.assignee || '<none>'}`,
          `Reviewer:  ${draft.reviewer || '<none>'}`,
          `Milestone: ${draft.milestone || '<none>'}`,
        ].join('\n'));
        process.stdout.write(`${'-'.repeat(61)}\n${bodyOf(context, draft)}\n${'-'.repeat(61)}\n`);

        const go = await stepAnswer(confirm({message: 'Create this merge request? (Esc to go back)', initialValue: false}));
        if (go === BACK) {
          return BACK;
        }

        return go ? {} : bail('Aborted.');
      },
    },
  ];
}

function pushOptions(draft: Draft, body: string): string[] {
  const options = [
    '-o',
    'merge_request.create',
    '-o',
    `merge_request.target=${draft.target}`,
    '-o',
    `merge_request.title=${draft.title}`,
    '-o',
    `merge_request.description=${encodeDescription(body)}`,
  ];
  if (draft.assignee) {
    options.push('-o', `merge_request.assign=${draft.assignee}`);
  }

  if (draft.milestone) {
    options.push('-o', `merge_request.milestone=${draft.milestone}`);
  }

  if (/^(WIP|Draft): /.test(draft.title)) {
    options.push('-o', 'merge_request.draft');
  }

  return options;
}

function checkBranch(): {branch: string; remote: Remote} {
  const branch = currentBranch();
  if (!branch) {
    bail('detached HEAD — check out a branch first');
  }

  if (PROTECTED.includes(branch)) {
    bail(`cannot open a merge request from '${branch}'`);
  }

  const url = originUrl();
  if (!url) {
    bail('no "origin" remote');
  }

  const remote = parseRemote(url);
  if (!remote) {
    bail(`cannot parse origin URL: ${url}`);
  }

  return {branch, remote};
}

function checkPushMovesRef(branch: string, remote: Remote): void {
  const remoteHead = hasRef(`refs/remotes/origin/${branch}`) ? revision(`refs/remotes/origin/${branch}`) : undefined;
  if (remoteHead && remoteHead === revision('HEAD')) {
    bail(`'${branch}' is already pushed and unchanged, so this push would move no ref.\n`
      + 'GitLab only applies push options on a ref update — no MR would be created.\n'
      + `Add a commit, or open it in the UI:\n  ${
        newMergeRequestUrl({...remote, branch})}`);
  }
}

export async function runMr({dryRun = false}: MrOptions = {}): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error('scripts: mr needs an interactive terminal');
    process.exit(1);
  }

  const root = repoRoot();
  if (!root) {
    console.error('scripts: not a git repository');
    process.exit(1);
  }

  process.chdir(root);

  intro('merge request');

  if (!existsSync(TEMPLATE)) {
    bail(`template not found: ${TEMPLATE}`);
  }

  const text = readFileSync(TEMPLATE, 'utf8');
  const template = readTemplate(text);
  const tasks = parseTasks(template);
  if (tasks.length === 0) {
    bail(`${TEMPLATE}: the mr:tasks region has no checklist rows`);
  }

  const {branch, remote} = checkBranch();

  if (isDirty()) {
    const proceed = required(await confirm({
      message: 'Working tree is dirty — uncommitted changes will not be part of the MR. Continue?',
      initialValue: false,
    }));
    if (!proceed) {
      bail('Aborted.');
    }
  }

  if (!fetchOrigin()) {
    log.warn('fetch failed — falling back to possibly stale refs');
  }

  checkPushMovesRef(branch, remote);

  log.info('Esc goes back to the previous step, Ctrl-C aborts.');

  const context = {branch, template, tasks};
  const draft = await runSteps(draftSteps(context), {
    target: templateValue(text, 'target_branch') || 'master',
    title: '',
    description: '',
    assignee: templateValue(text, 'assign'),
    reviewer: reviewerValue(text),
    milestone: templateValue(text, 'milestone'),
    done: [],
    explanation: '',
  });

  const options = pushOptions(draft, bodyOf(context, draft));

  if (dryRun) {
    process.stdout.write(`DRY RUN — would push:\n${options.map(option => `  ${option}`).join('\n')}\n`);
    outro('dry run — nothing pushed');
    return;
  }

  const {code, output} = await push({options, branch});
  if (code !== 0) {
    bail('push failed');
  }

  if (output.includes('WARNINGS')) {
    bail('GitLab reported push-option warnings above — the merge request may not have been created');
  }

  outro('merge request created');
}
