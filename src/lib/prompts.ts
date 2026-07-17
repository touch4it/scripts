import process from 'node:process';

import {
  cancel, isCancel, multiline, text,
} from '@clack/prompts';

export function bail(message: string): never {
  cancel(message);
  process.exit(1);
}

/** Unwraps a clack answer, aborting on Ctrl-C. */
export function required<T>(value: T | symbol): T {
  if (isCancel(value)) {
    bail('Aborted.');
  }

  return value;
}

/** Prompt carrying a default: Enter keeps it, "-" clears it, a leading @ is optional. */
export async function ask(message: string, defaultValue: string): Promise<string> {
  const answer = required(await text({
    message: `${message} (- for none)`,
    placeholder: defaultValue || 'none',
    defaultValue,
  }));
  const value = String(answer ?? '').trim();
  return value === '-' ? '' : value.replace(/^@/, '');
}

export async function askText(message: string, defaultValue: string): Promise<string> {
  const answer = required(await text({message, placeholder: defaultValue, defaultValue}));
  return String(answer ?? '').trim();
}

/** Multi-line free text. showSubmit is required: without it Enter twice submits, so a blank line is unreachable. */
export async function askMultiline(message: string, placeholder?: string): Promise<string> {
  const answer = required(await multiline({message, placeholder, showSubmit: true}));
  return String(answer ?? '').trim();
}
