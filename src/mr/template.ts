const TABLE_ROW = /^(?:\|\s*\[[ xX]]\s*){2}\|/;
const LIST_ROW = '- [ ] ';
const DESCRIPTION_PLACEHOLDER = '<Briefly describe';
const EXPLANATION_PLACEHOLDER = '<If any of these';

export type QuickAction
  = | 'assign'
    | 'reviewer'
    | 'assign_reviewer'
    | 'request_review'
    | 'target_branch'
    | 'milestone';

/** GitLab's aliases for assigning a reviewer. None has a push option, so they stay in the body. */
const REVIEWER_ACTIONS = ['reviewer', 'assign_reviewer', 'request_review'] as const satisfies QuickAction[];

/** Quick actions the tool rewrites into push options, dropping them from the body. */
const PUSH_OPTION_ACTIONS: ReadonlySet<string> = new Set<QuickAction>(['assign', 'target_branch', 'milestone']);
const REVIEWER_ACTION_NAMES: ReadonlySet<string> = new Set<QuickAction>(REVIEWER_ACTIONS);

export type BodyInput = {
  description: string;
  explanation?: string;
  reviewer?: string;
  /** One entry per checklist row, in template order. Missing entries count as not done. */
  done?: boolean[];
};

/** The quick action a line invokes, if any. Matches the whole action, so /assign never swallows /assign_reviewer. */
function actionOf(line: string): string | undefined {
  return /^\/([a-z_]+)(?:[ \t]|$)/.exec(line)?.[1];
}

/** Value of a /quick-action line in the template, with any leading '@' stripped. */
export function templateValue(template: string, action: QuickAction): string {
  const match = new RegExp(`^/${action}[ \\t]+(.*)$`, 'm').exec(template);
  return match?.[1]?.trim().replace(/^@/, '') ?? '';
}

/** Reviewer named by the template, under whichever alias it uses. */
export function reviewerValue(template: string): string {
  for (const action of REVIEWER_ACTIONS) {
    const value = templateValue(template, action);
    if (value) {
      return value;
    }
  }

  return '';
}

/**
 * Task names of the template's checklist rows, in order. Handles a two-checkbox
 * table in either column order and a `- [ ] Task` list.
 */
export function parseTasks(template: string): string[] {
  const tasks: string[] = [];

  for (const line of template.split('\n')) {
    if (TABLE_ROW.test(line)) {
      tasks.push(line.split('|')[3]?.trim() ?? '');
    } else if (line.startsWith(LIST_ROW)) {
      tasks.push(line.slice(LIST_ROW.length).trim());
    }
  }

  return tasks;
}

/** True when the checklist table lists its Done column before its N/A column. */
function doneColumnFirst(template: string): boolean {
  const header = template.split('\n').find(line => line.includes('Done') && line.includes('N/A'));
  return header ? header.indexOf('Done') < header.indexOf('N/A') : false;
}

/** Mark a row's two checkboxes for its column order, leaving every space intact. */
function markTableRow(line: string, done: boolean, doneFirst: boolean): string {
  const doneBox = done ? '[x]' : '[ ]';
  const naBox = done ? '[ ]' : '[x]';
  const marks = doneFirst ? [doneBox, naBox] : [naBox, doneBox];
  let index = 0;
  return line.replace(/\[[ xX]]/g, box => marks[index++] ?? box);
}

/**
 * Fill the template: description and explanation replace their placeholders,
 * checklist rows are marked from `done`, and the quick actions the push options
 * carry are dropped. Reviewer actions have no push option, so they stay in the
 * body under the same alias the template used.
 */
export function assembleBody(template: string, input: BodyInput): string {
  const {description, explanation = '', reviewer = '', done = []} = input;
  const out: string[] = [];
  const doneFirst = doneColumnFirst(template);
  let row = 0;
  let reviewerSeen = false;

  for (const line of template.split('\n')) {
    const action = actionOf(line);

    if (line.startsWith(DESCRIPTION_PLACEHOLDER)) {
      out.push(description);
    } else if (line.startsWith(EXPLANATION_PLACEHOLDER)) {
      if (explanation) {
        out.push(explanation);
      }
    } else if (action && REVIEWER_ACTION_NAMES.has(action)) {
      reviewerSeen = true;
      if (reviewer) {
        out.push(`/${action} @${reviewer}`);
      }
    } else if (action && PUSH_OPTION_ACTIONS.has(action)) {
      continue;
    } else if (TABLE_ROW.test(line)) {
      out.push(markTableRow(line, Boolean(done[row++]), doneFirst));
    } else if (line.startsWith(LIST_ROW)) {
      // A list has no N/A column, so anything not done just stays unchecked.
      out.push((done[row++] ? '- [x] ' : '- [ ] ') + line.slice(LIST_ROW.length));
    } else {
      out.push(line);
    }
  }

  if (reviewer && !reviewerSeen) {
    out.push('', `/reviewer @${reviewer}`);
  }

  return out.join('\n').replace(/\n+$/, '');
}

/**
 * Git refuses literal newlines in a push option value; GitLab restores them by
 * gsub'ing the two characters \n back into newlines (15.0+).
 */
export function encodeDescription(body: string): string {
  return body
    .split('\n')
    .map(line => `${line}\\n`)
    .join('');
}
