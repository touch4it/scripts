import process from 'node:process';

import {
  autocomplete, cancel, isCancel, text, type CANCEL_SYMBOL,
} from '@clack/prompts';

import {editText} from './editor.ts';

export const BACK = Symbol('back');
export type Back = typeof BACK;

type Answer<T> = T | typeof CANCEL_SYMBOL;
type Validate = (value: string) => string | undefined;

export type Choice = {value: string; label?: string; hint?: string};

export type Step<Draft> = {
  when?: (draft: Draft) => boolean;
  ask: (draft: Draft) => Promise<Partial<Draft> | Back>;
};

export function bail(message: string): never {
  cancel(message);
  process.exit(1);
}

/** Unwraps a clack answer, aborting on Ctrl-C or Esc. */
export function required<T>(value: Answer<T>): T {
  if (isCancel(value)) {
    bail('Aborted.');
  }

  return value;
}

/** Unwraps a clack answer: Esc steps back, Ctrl-C aborts. */
export async function stepAnswer<T>(prompt: Promise<Answer<T>>): Promise<T | Back> {
  let escaped = false;
  const onKeypress = (_: unknown, key?: {name?: string}): void => {
    escaped = key?.name === 'escape';
  };

  process.stdin.on('keypress', onKeypress);
  try {
    const value = await prompt;
    return isCancel(value) && escaped ? BACK : required(value);
  } finally {
    process.stdin.off('keypress', onKeypress);
  }
}

/** Runs the steps in order, skipping a step whose `when` is false. Esc returns to the previous step that ran. */
export async function runSteps<Draft>(steps: Array<Step<Draft>>, initial: Draft): Promise<Draft> {
  let draft = initial;
  const applies = (step: Step<Draft>): boolean => step.when?.(draft) ?? true;

  for (let index = 0; index < steps.length;) {
    const step = steps[index]!;
    if (!applies(step)) {
      index++;
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const answer = await step.ask(draft);
    if (answer === BACK) {
      index = Math.max(0, steps.slice(0, index).findLastIndex(applies));
      continue;
    }

    draft = {...draft, ...answer};
    index++;
  }

  return draft;
}

function orDefault(value: string | undefined, defaultValue: string): string {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? defaultValue : trimmed;
}

/** Prompt carrying a default: Enter keeps it, "-" clears it, a leading @ is optional. */
export async function ask(message: string, defaultValue: string): Promise<string | Back> {
  const answer = await stepAnswer(text({
    message: `${message} (- for none)`,
    placeholder: defaultValue || 'none',
    defaultValue,
  }));
  if (answer === BACK) {
    return BACK;
  }

  const value = answer.trim();
  return value === '-' ? '' : value.replace(/^@/, '');
}

/** Searchable list: typing filters the choices. */
export async function pick(message: string, choices: Choice[], initialValue: string, validate?: Validate): Promise<string | Back> {
  const listed = choices.some(choice => choice.value === initialValue);
  return stepAnswer(autocomplete({
    message,
    options: choices,
    initialValue: listed ? initialValue : undefined,
    placeholder: 'Type to filter',
    maxItems: 8,
    validate(value) {
      if (value === undefined) {
        return 'Nothing matches the filter';
      }

      return validate?.(String(value));
    },
  }));
}

/** A searchable list with a "none" entry when choices are known, the free-text prompt of `ask` otherwise. */
export async function askOrPick(message: string, defaultValue: string, choices: Choice[] | undefined): Promise<string | Back> {
  if (!choices) {
    return ask(message, defaultValue);
  }

  const listed = choices.some(choice => choice.value === defaultValue);
  return pick(message, [
    {value: '', label: 'none'},
    ...(defaultValue && !listed ? [{value: defaultValue, hint: 'not in the list'}] : []),
    ...choices,
  ], defaultValue);
}

export async function askText(message: string, defaultValue: string, validate?: Validate): Promise<string | Back> {
  const answer = await stepAnswer(text({
    message,
    placeholder: defaultValue,
    defaultValue,
    validate: validate && (value => validate(orDefault(value, defaultValue))),
  }));
  return answer === BACK ? BACK : answer.trim();
}

export async function askMultiline(
  message: string,
  {placeholder, initialValue, validate}: {placeholder?: string; initialValue?: string; validate?: Validate} = {},
): Promise<string | Back> {
  const answer = await stepAnswer(editText({
    message,
    placeholder,
    initialValue,
    validate: validate && (value => validate(orDefault(value, ''))),
  }));
  return answer === BACK ? BACK : answer.trim();
}
