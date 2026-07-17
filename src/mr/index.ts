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
  ask, askMultiline, askText, bail, required,
} from '../lib/prompts.ts';
import {newMergeRequestUrl, parseRemote} from '../lib/remote.ts';
import {
  assembleBody, encodeDescription, parseTasks, reviewerValue, templateValue,
} from './template.ts';

const TEMPLATE = '.gitlab/merge_request_templates/Default.md';
const PROTECTED = ['master', 'master-next', 'qa', 'staging', 'production'];

export type MrOptions = {
  dryRun?: boolean;
};

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

  const template = readFileSync(TEMPLATE, 'utf8');

  const target = templateValue(template, 'target_branch') || 'master';

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

  if (!hasRef(`refs/remotes/origin/${target}`)) {
    bail(`no origin/${target} to compare against`);
  }

  if (commitsAhead(target) === 0) {
    bail(`no commits ahead of origin/${target}`);
  }

  const remoteHead = hasRef(`refs/remotes/origin/${branch}`) ? revision(`refs/remotes/origin/${branch}`) : undefined;
  if (remoteHead && remoteHead === revision('HEAD')) {
    bail(`'${branch}' is already pushed and unchanged, so this push would move no ref.\n`
      + 'GitLab only applies push options on a ref update — no MR would be created.\n'
      + `Add a commit, or open it in the UI:\n  ${
        newMergeRequestUrl({...remote, branch})}`);
  }

  const title = await askText('Title', firstCommitSubject(target));
  if (!title) {
    bail('empty title — aborted');
  }

  const description = await askMultiline(
    'Description — what is this for?',
    'Link a Redmine issue if there is one.',
  );
  if (!description) {
    bail('empty description — aborted');
  }

  const assignee = await ask('Assignee', templateValue(template, 'assign'));
  const reviewer = await ask('Reviewer', reviewerValue(template));
  const milestone = await ask('Milestone', templateValue(template, 'milestone'));

  const tasks = parseTasks(template);
  if (tasks.length === 0) {
    bail(`no checklist rows found in ${TEMPLATE}`);
  }

  const selected = required(await multiselect({
    message: 'Requirements — space marks Done, enter confirms.',
    options: tasks.map((task, index) => ({value: index, label: task})),
    required: false,
  }));
  const done = tasks.map((_, index) => selected.includes(index));

  const notDone = done.filter(isDone => !isDone).length;
  let explanation = '';
  if (notDone > 0) {
    explanation = await askMultiline(`${notDone} row(s) not marked Done — why?`, 'optional');
  }

  const body = assembleBody(template, {
    description, explanation, reviewer, done,
  });

  log.step([
    `Title:     ${title}`,
    `Branch:    ${branch} -> ${target}`,
    `Assignee:  ${assignee || '<none>'}`,
    `Reviewer:  ${reviewer || '<none>'}`,
    `Milestone: ${milestone || '<none>'}`,
  ].join('\n'));
  process.stdout.write(`${'-'.repeat(61)}\n${body}\n${'-'.repeat(61)}\n`);

  const go = required(await confirm({message: 'Create this merge request?', initialValue: false}));
  if (!go) {
    bail('Aborted.');
  }

  const options = [
    '-o',
    'merge_request.create',
    '-o',
    `merge_request.target=${target}`,
    '-o',
    `merge_request.title=${title}`,
    '-o',
    `merge_request.description=${encodeDescription(body)}`,
  ];
  if (assignee) {
    options.push('-o', `merge_request.assign=${assignee}`);
  }

  if (milestone) {
    options.push('-o', `merge_request.milestone=${milestone}`);
  }

  if (/^(WIP|Draft): /.test(title)) {
    options.push('-o', 'merge_request.draft');
  }

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
