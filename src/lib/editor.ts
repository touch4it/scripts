import process from 'node:process';
import type {Key} from 'node:readline';
// eslint-disable-next-line n/no-unsupported-features/node-builtins -- @clack/prompts renders with it on the same Node range
import {styleText} from 'node:util';

import {
  MultiLinePrompt, wrapTextWithPrefix, type CANCEL_SYMBOL, type State,
} from '@clack/core';
import {S_BAR, S_BAR_END, symbol} from '@clack/prompts';

export type TextState = {text: string; cursor: number};
type Edit = (state: TextState) => TextState;
type Position = (text: string, cursor: number) => number;

const isWordChar = (char: string | undefined): boolean => char !== undefined && /[\p{L}\p{N}_]/u.test(char);

function wordStart(text: string, cursor: number): number {
  let index = cursor;
  while (index > 0 && !isWordChar(text[index - 1])) {
    index--;
  }

  while (index > 0 && isWordChar(text[index - 1])) {
    index--;
  }

  return index;
}

function wordEnd(text: string, cursor: number): number {
  let index = cursor;
  while (index < text.length && !isWordChar(text[index])) {
    index++;
  }

  while (index < text.length && isWordChar(text[index])) {
    index++;
  }

  return index;
}

const lineStart: Position = (text, cursor) => (cursor === 0 ? 0 : text.lastIndexOf('\n', cursor - 1) + 1);

function lineEnd(text: string, cursor: number): number {
  const newline = text.indexOf('\n', cursor);
  return newline === -1 ? text.length : newline;
}

const moveTo = (position: Position): Edit => ({text, cursor}) => ({text, cursor: position(text, cursor)});

const deleteTo = (position: Position): Edit => ({text, cursor}) => {
  const target = position(text, cursor);
  const from = Math.min(target, cursor);
  return {text: text.slice(0, from) + text.slice(Math.max(target, cursor)), cursor: from};
};

const EDITS = {
  wordLeft: moveTo(wordStart),
  wordRight: moveTo(wordEnd),
  lineStart: moveTo(lineStart),
  lineEnd: moveTo(lineEnd),
  deleteWordLeft: deleteTo(wordStart),
  deleteWordRight: deleteTo(wordEnd),
  deleteToLineStart: deleteTo(lineStart),
  deleteToLineEnd: deleteTo(lineEnd),
} satisfies Record<string, Edit>;

// Terminals send Option+arrow as meta+arrow or meta+b/f, and Cmd+arrow as Ctrl-A/Ctrl-E or Home/End.
const KEYMAP: Record<string, keyof typeof EDITS> = {
  'meta+left': 'wordLeft',
  'meta+b': 'wordLeft',
  'ctrl+left': 'wordLeft',
  'meta+right': 'wordRight',
  'meta+f': 'wordRight',
  'ctrl+right': 'wordRight',
  'ctrl+a': 'lineStart',
  home: 'lineStart',
  'ctrl+e': 'lineEnd',
  end: 'lineEnd',
  'meta+backspace': 'deleteWordLeft',
  'ctrl+w': 'deleteWordLeft',
  'meta+d': 'deleteWordRight',
  'meta+delete': 'deleteWordRight',
  'ctrl+u': 'deleteToLineStart',
  'ctrl+k': 'deleteToLineEnd',
};

const keyId = (key: Key): string => `${key.ctrl ? 'ctrl+' : ''}${key.meta ? 'meta+' : ''}${key.name ?? ''}`;

/** The edit a key makes to the text, or undefined for a key the editor leaves to clack. */
export function applyKey(key: Key, state: TextState): TextState | undefined {
  const action = KEYMAP[keyId(key)];
  return action && EDITS[action](state);
}

type EventName = Parameters<MultiLinePrompt['emit']>[0];

const isKey = (value: unknown): value is Key => typeof value === 'object' && value !== null;

class EditorPrompt extends MultiLinePrompt {
  override emit<T extends EventName>(event: T, ...data: unknown[]): void {
    const key = data[1];
    const edited = event === 'key' && isKey(key) ? applyKey(key, {text: this.userInput, cursor: this.cursor}) : undefined;
    if (!edited) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- clack does not export its event map
      super.emit(event, ...data as never);
      return;
    }

    this.focused = 'editor';
    this._setUserInput(edited.text);
    this._cursor = edited.cursor;
  }
}

type EditorOptions = {
  message: string;
  placeholder?: string;
  initialValue?: string;
  validate?: (value: string | undefined) => string | undefined;
};

/** Clack's multiline prompt with a submit button, plus word and line editing keys. */
export async function editText({message, placeholder, initialValue, validate}: EditorOptions): Promise<string | typeof CANCEL_SYMBOL> {
  const emptyInput = placeholder
    ? styleText('inverse', placeholder.slice(0, 1)) + styleText('dim', placeholder.slice(1))
    : styleText(['inverse', 'hidden'], '_');
  const bar = (color: 'gray' | 'cyan' | 'yellow'): string => `${styleText(color, S_BAR)}  `;
  const wrap = (text: string, prefix: string, format?: (line: string) => string): string =>
    wrapTextWithPrefix(process.stdout, text, prefix, undefined, undefined, format);

  const prompt = new EditorPrompt({
    placeholder,
    initialValue,
    validate,
    showSubmit: true,
    render() {
      const header = `${styleText('gray', S_BAR)}\n${symbol(this.state)}  ${message}\n`;
      const input = this.userInput ? this.userInputWithCursor : emptyInput;
      const submit = `\n  ${styleText(this.focused === 'submit' ? 'cyan' : 'dim', '[ submit ]')}`;
      const active = (): string => `${header}${wrap(input, bar('cyan'))}\n${styleText('cyan', S_BAR_END)}${submit}\n`;
      const frames = {
        initial: active,
        active,
        validating: active,
        error: () => `${header}${wrap(input, bar('yellow'))}\n${styleText('yellow', S_BAR_END)}  ${styleText('yellow', this.error)}${submit}\n`,
        submit: () => `${header}${wrap(this.value ?? '', bar('gray'), line => styleText('dim', line))}`,
        cancel: () => `${header}${wrap(this.value ?? '', bar('gray'), line => styleText(['strikethrough', 'dim'], line))}`,
      } satisfies Record<State, () => string>;
      return frames[this.state]();
    },
  });
  return (await prompt.prompt()) ?? '';
}
