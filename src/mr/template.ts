const TABLE_ROW = /^(?:\|\s*\[[ xX]]\s*){2}\|/;
const LIST_ROW = '- [ ] ';
const REGION_OPEN = /^<!--\s*mr:(\S+?)((?:\s+[a-z]+="[^"]*")*)\s*-->$/;
const REGION_CLOSE = /^<!--\s*\/mr:(\S+?)\s*-->$/;
const ATTRIBUTE = /([a-z]+)="([^"]*)"/g;

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

const SLOTS = ['description', 'explanation', 'tasks'] as const;
export type Slot = typeof SLOTS[number];
const REQUIRED_SLOTS: readonly Slot[] = ['description', 'tasks'];

/** Attributes each slot accepts on its opening marker. */
const SLOT_ATTRIBUTES = {
  description: [],
  explanation: [],
  tasks: ['na'],
} as const satisfies Record<Slot, readonly string[]>;

/** A `<!-- mr:slot -->` … `<!-- /mr:slot -->` block. Its lines are what a person filling the template in the UI sees. */
type Region = {
  slot: Slot;
  lines: string[];
  /** Mark for a list row that is not done. */
  na: string;
};

export type Template = {
  /** Template lines outside any region, and the regions in place. */
  segments: Array<string | Region>;
};

export class TemplateError extends Error {}

export type BodyInput = {
  description: string;
  explanation?: string;
  reviewer?: string;
  /** One entry per checklist row, in template order. Missing entries count as not done. */
  done?: boolean[];
};

function isSlot(name: string): name is Slot {
  return (SLOTS as readonly string[]).includes(name);
}

function openRegion(name: string, attributeText: string): Region {
  if (!isSlot(name)) {
    throw new TemplateError(`unknown region mr:${name}, expected one of ${SLOTS.map(slot => `mr:${slot}`).join(', ')}`);
  }

  const allowed: readonly string[] = SLOT_ATTRIBUTES[name];
  const attributes = new Map([...attributeText.matchAll(ATTRIBUTE)].map(([, key, value]) => [key!, value!]));
  for (const key of attributes.keys()) {
    if (!allowed.includes(key)) {
      throw new TemplateError(`mr:${name} does not take the attribute ${key}`);
    }
  }

  return {slot: name, lines: [], na: attributes.get('na') ?? '[ ]'};
}

function isTableHeader(line: string): boolean {
  return line.includes('Done') && line.includes('N/A');
}

/** True when the checklist table lists its Done column before its N/A column. */
function doneColumnFirst(lines: string[]): boolean {
  const header = lines.find(line => isTableHeader(line)) ?? '';
  return header.indexOf('Done') < header.indexOf('N/A');
}

function checkTasks(region: Region): void {
  const hasTable = region.lines.some(line => TABLE_ROW.test(line));
  if (hasTable && !region.lines.some(line => isTableHeader(line))) {
    throw new TemplateError('the mr:tasks table needs a header naming its Done and N/A columns');
  }
}

/**
 * Split the template into plain lines and `mr:` regions. Throws a TemplateError
 * for a malformed marker, a repeated or missing required region, or a task table
 * without a Done and N/A header.
 */
export function parseTemplate(text: string): Template {
  const segments: Array<string | Region> = [];
  const seen = new Set<Slot>();
  let open: Region | undefined;

  for (const line of text.split('\n')) {
    const opening = REGION_OPEN.exec(line.trim());
    const closing = REGION_CLOSE.exec(line.trim());

    if (opening) {
      if (open) {
        throw new TemplateError(`mr:${opening[1]} opens inside mr:${open.slot}`);
      }

      open = openRegion(opening[1]!, opening[2] ?? '');
      if (seen.has(open.slot)) {
        throw new TemplateError(`mr:${open.slot} appears more than once`);
      }

      seen.add(open.slot);
    } else if (closing) {
      if (!open || closing[1] !== open.slot) {
        throw new TemplateError(`/mr:${closing[1]} closes no open region`);
      }

      segments.push(open);
      open = undefined;
    } else if (open) {
      open.lines.push(line);
    } else {
      segments.push(line);
    }
  }

  if (open) {
    throw new TemplateError(`mr:${open.slot} is never closed`);
  }

  for (const slot of REQUIRED_SLOTS) {
    if (!seen.has(slot)) {
      throw new TemplateError(`missing the <!-- mr:${slot} --> … <!-- /mr:${slot} --> region`);
    }
  }

  for (const segment of segments) {
    if (typeof segment !== 'string' && segment.slot === 'tasks') {
      checkTasks(segment);
    }
  }

  return {segments};
}

function regionOf(template: Template, slot: Slot): Region | undefined {
  return template.segments.find((segment): segment is Region => typeof segment !== 'string' && segment.slot === slot);
}

export function hasSlot(template: Template, slot: Slot): boolean {
  return regionOf(template, slot) !== undefined;
}

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
 * Task names of the rows in the mr:tasks region, in order. Handles a
 * two-checkbox table in either column order and a `- [ ] Task` list.
 */
export function parseTasks(template: Template): string[] {
  const tasks: string[] = [];

  for (const line of regionOf(template, 'tasks')?.lines ?? []) {
    if (TABLE_ROW.test(line)) {
      tasks.push(line.split('|')[3]?.trim() ?? '');
    } else if (line.startsWith(LIST_ROW)) {
      tasks.push(line.slice(LIST_ROW.length).trim());
    }
  }

  return tasks;
}

/** Mark a row's two checkboxes for its column order, leaving every space intact. */
function markTableRow(line: string, done: boolean, doneFirst: boolean): string {
  const doneBox = done ? '[x]' : '[ ]';
  const naBox = done ? '[ ]' : '[x]';
  const marks = doneFirst ? [doneBox, naBox] : [naBox, doneBox];
  let index = 0;
  return line.replace(/\[[ xX]]/g, box => marks[index++] ?? box);
}

function markTasks(region: Region, done: boolean[]): string[] {
  const doneFirst = doneColumnFirst(region.lines);
  let row = 0;

  return region.lines.map(line => {
    if (TABLE_ROW.test(line)) {
      return markTableRow(line, Boolean(done[row++]), doneFirst);
    }

    if (line.startsWith(LIST_ROW)) {
      return `- ${done[row++] ? '[x]' : region.na} ${line.slice(LIST_ROW.length)}`;
    }

    return line;
  });
}

const SLOT_RENDERERS = {
  description: (_region, input) => [input.description],
  explanation: (_region, input) => (input.explanation ? [input.explanation] : []),
  tasks: (region, input) => markTasks(region, input.done ?? []),
} satisfies Record<Slot, (region: Region, input: BodyInput) => string[]>;

/**
 * Fill the template: each region is replaced by its value, checklist rows are
 * marked from `done`, and the quick actions the push options carry are dropped.
 * Reviewer actions have no push option, so they stay in the body under the same
 * alias the template used.
 */
export function assembleBody(template: Template, input: BodyInput): string {
  const {reviewer = ''} = input;
  const out: string[] = [];
  let reviewerSeen = false;
  let skipBlank = false;

  for (const segment of template.segments) {
    if (typeof segment !== 'string') {
      const lines = SLOT_RENDERERS[segment.slot](segment, input);
      out.push(...lines);
      skipBlank = lines.length === 0 && out.at(-1) === '';
      continue;
    }

    if (skipBlank && segment === '') {
      continue;
    }

    skipBlank = false;
    const action = actionOf(segment);

    if (action && REVIEWER_ACTION_NAMES.has(action)) {
      reviewerSeen = true;
      if (reviewer) {
        out.push(`/${action} @${reviewer}`);
      }
    } else if (!action || !PUSH_OPTION_ACTIONS.has(action)) {
      out.push(segment);
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
