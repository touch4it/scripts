import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {
  BACK, runSteps, type Back, type Step,
} from '../../src/lib/prompts.ts';

type Draft = {a: string; c: string; d: string};

describe('runSteps', () => {
  it('goes back past skipped steps, keeps every answer as the next default, and stays on the first step', async () => {
    const asked: string[] = [];
    const scripted = (key: keyof Draft, answers: Array<string | Back>): Step<Draft> => ({
      async ask(draft) {
        asked.push(`${key}:${draft[key]}`);
        const answer = answers.shift()!;
        return answer === BACK ? BACK : {[key]: answer};
      },
    });
    const skipped: Step<Draft> = {
      when: () => false,
      ask() {
        throw new Error('a skipped step was asked');
      },
    };

    const draft = await runSteps([
      scripted('a', [BACK, 'a1', 'a2']),
      skipped,
      scripted('c', ['c1', BACK, 'c2']),
      scripted('d', [BACK, 'd1']),
    ], {a: '', c: '', d: ''});

    assert.deepEqual(asked, ['a:', 'a:', 'c:', 'd:', 'c:c1', 'a:a1', 'c:c1', 'd:']);
    assert.deepEqual(draft, {a: 'a2', c: 'c2', d: 'd1'});
  });
});
