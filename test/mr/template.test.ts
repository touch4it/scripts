import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {describe, it} from 'node:test';
import {fileURLToPath} from 'node:url';

import {
  assembleBody, encodeDescription, parseTasks, reviewerValue, templateValue,
} from '../../src/mr/template.ts';

// Templates of the shapes the tool is built for, with placeholder identities so
// assertions stay exact. The tool reads the consuming repository's own template
// at runtime; these only have to be representative.
const read = (name: string): string => readFileSync(
  fileURLToPath(new URL(`../../.gitlab/merge_request_templates/${name}`, import.meta.url)),
  'utf8',
);

// A `| N/A | Done | Task |` table, /reviewer, and a milestone.
const table = read('Default.md');
// A `- [ ] Task` list, /assign_reviewer, and no milestone.
const list = read('DefaultSimple.md');

const shapes = [
  {name: 'table (Default.md)', template: table, rows: 6},
  {name: 'list (DefaultSimple.md)', template: list, rows: 6},
];

const contains = (haystack: string, needle: string): void => {
  assert.ok(haystack.includes(needle), `expected to contain ${JSON.stringify(needle)}`);
};

const omits = (haystack: string, needle: string): void => {
  assert.ok(!haystack.includes(needle), `expected not to contain ${JSON.stringify(needle)}`);
};

const reviewerLines = (body: string): string[] =>
  body.split('\n').filter(line => /^\/(?:reviewer|assign_reviewer|request_review)\b/.test(line));

describe('templateValue', () => {
  it('reads the quick actions of the table template', () => {
    assert.equal(templateValue(table, 'assign'), 'assignee');
    assert.equal(templateValue(table, 'reviewer'), 'reviewer');
    assert.equal(templateValue(table, 'target_branch'), 'master');
    assert.equal(templateValue(table, 'milestone'), '0.0.0');
  });

  it('reads the quick actions of the list template', () => {
    assert.equal(templateValue(list, 'assign'), 'assignee');
    assert.equal(templateValue(list, 'assign_reviewer'), 'reviewer');
    assert.equal(templateValue(list, 'target_branch'), 'master');
    assert.equal(templateValue(list, 'milestone'), '');
  });

  it('does not let /assign swallow /assign_reviewer', () => {
    assert.equal(templateValue('/assign_reviewer @jane', 'assign'), '');
  });

  it('strips a leading @ from a handle', () => {
    assert.equal(templateValue('/assign @marian.vismek', 'assign'), 'marian.vismek');
  });

  it('reads a value that is not a handle', () => {
    assert.equal(templateValue('/target_branch master', 'target_branch'), 'master');
    assert.equal(templateValue('/milestone 3.1.0', 'milestone'), '3.1.0');
  });

  it('keeps a multi-word value intact', () => {
    assert.equal(templateValue('/milestone Sprint 42 - hardening', 'milestone'), 'Sprint 42 - hardening');
  });

  it('returns empty string for an absent action', () => {
    assert.equal(templateValue('no actions here', 'assign'), '');
  });

  it('does not let /assign match /assignee', () => {
    assert.equal(templateValue('/assignee @someone', 'assign'), '');
  });

  it('requires whitespace after the action', () => {
    assert.equal(templateValue('/milestone', 'milestone'), '');
  });

  it('takes the first match when an action repeats', () => {
    assert.equal(templateValue('/assign @first\n/assign @second', 'assign'), 'first');
  });

  it('ignores a quick action that is not at the start of a line', () => {
    assert.equal(templateValue('see /assign @nobody for details', 'assign'), '');
  });
});

describe('reviewerValue', () => {
  it('finds the reviewer under whichever alias the template uses', () => {
    assert.equal(reviewerValue(table), 'reviewer');
    assert.equal(reviewerValue(list), 'reviewer');
  });

  it('supports /request_review too', () => {
    assert.equal(reviewerValue('/request_review @jane'), 'jane');
  });

  it('returns empty string when no reviewer is named', () => {
    assert.equal(reviewerValue('# nothing here'), '');
  });
});

describe('parseTasks', () => {
  it('reads the table checklist', () => {
    assert.deepEqual(parseTasks(table), [
      'Corrected MR title',
      'Set milestone',
      'Added/Updated tests',
      'Ran `npm test` locally',
      'Tested other related features',
      'Updated `AGENTS.md` and/or `docs/`',
    ]);
  });

  it('reads the list checklist', () => {
    assert.deepEqual(parseTasks(list), [
      'Updated changelog',
      'Updated environment variables',
      'Added unit tests',
      'Updated OpenAPI documentation',
      'Ran `npm run test` locally',
      'Sent a message to a Mattermost channel',
    ]);
  });

  it('returns nothing when there is no checklist', () => {
    assert.deepEqual(parseTasks('# Title\n\nprose only'), []);
  });
});

// Behaviour every template shape must share.
for (const {name, template, rows} of shapes) {
  describe(`assembleBody — ${name}`, () => {
    const base = {
      description: 'DESC',
      done: Array.from({length: rows}, () => false),
      reviewer: 'reviewer',
    };

    it('replaces the description placeholder', () => {
      const body = assembleBody(template, base);
      omits(body, '<Briefly describe');
      contains(body, 'DESC');
    });

    it('drops the explanation placeholder when no explanation is given', () => {
      omits(assembleBody(template, base), '<If any of these');
    });

    it('substitutes the explanation where the template puts it', () => {
      const body = assembleBody(template, {...base, explanation: 'Config-only.'});
      omits(body, '<If any of these');
      contains(body, 'Config-only.');
    });

    it('strips the quick actions that are sent as push options instead', () => {
      const body = assembleBody(template, base);
      omits(body, '/assign ');
      omits(body, '/target_branch');
      omits(body, '/milestone');
    });

    it('keeps exactly one reviewer line, since no alias has a push option', () => {
      const body = assembleBody(template, {...base, reviewer: 'jane.doe'});
      assert.equal(reviewerLines(body).length, 1);
      contains(body, '@jane.doe');
    });

    it('omits the reviewer line entirely when the reviewer is cleared', () => {
      assert.deepEqual(reviewerLines(assembleBody(template, {...base, reviewer: ''})), []);
    });

    it('keeps the heading, so the body matches a UI-created MR', () => {
      contains(assembleBody(template, base), '# Merge to Master');
    });

    it('treats a missing answer as not done rather than throwing', () => {
      assert.doesNotThrow(() => assembleBody(template, {...base, done: []}));
    });

    it('leaves user prose untouched, including markdown and shell hazards', () => {
      const description = [
        'Implements #666.',
        '',
        '#86496 was a blocker — fixed.',
        'Pipes | and "quotes" and $VAR and `backticks` and 100%.',
      ].join('\n');
      const body = assembleBody(template, {...base, description});
      contains(body, '#86496 was a blocker — fixed.');
      contains(body, 'Pipes | and "quotes" and $VAR and `backticks` and 100%.');
    });

    it('never emits a real newline once encoded, which git would reject outright', () => {
      omits(encodeDescription(assembleBody(template, {...base, description: 'a\n\nb'})), '\n');
    });

    it('round-trips through GitLab’s gsub back to the original body', () => {
      const body = assembleBody(template, {...base, description: 'Line one.\n\nLine two | with pipe.'});
      assert.equal(encodeDescription(body).split('\\n').join('\n'), `${body}\n`);
    });
  });
}

describe('assembleBody — table specifics', () => {
  const base = {description: 'DESC', done: [true, false, true, false, false, false], reviewer: 'reviewer'};

  it('marks the N/A column for anything not done', () => {
    const rows = assembleBody(table, base).split('\n').filter(line => line.startsWith('| ['));
    assert.ok(rows[0]?.startsWith('| [ ] | [x]'), 'row 1 should be Done');
    contains(rows[0] ?? '', 'Corrected MR title');
    assert.ok(rows[1]?.startsWith('| [x] | [ ]'), 'row 2 should be N/A');
    contains(rows[1] ?? '', 'Set milestone');
  });

  it('preserves the table column alignment', () => {
    const body = assembleBody(table, {...base, done: Array.from({length: 6}, () => true)});
    contains(body, '| [ ] | [x]  | Updated `AGENTS.md` and/or `docs/` |');
  });

  it('keeps the /reviewer alias the template used', () => {
    contains(assembleBody(table, {...base, reviewer: 'jane.doe'}), '/reviewer @jane.doe');
  });
});

describe('assembleBody — list specifics', () => {
  const base = {description: 'DESC', done: [true, false, true, false, false, false], reviewer: 'reviewer'};

  it('ticks done rows and leaves the rest unchecked, since a list has no N/A column', () => {
    const rows = assembleBody(list, base).split('\n').filter(line => line.startsWith('- ['));
    assert.deepEqual(rows.slice(0, 4), [
      '- [x] Updated changelog',
      '- [ ] Updated environment variables',
      '- [x] Added unit tests',
      '- [ ] Updated OpenAPI documentation',
    ]);
  });

  it('keeps the /assign_reviewer alias rather than rewriting it to /reviewer', () => {
    const body = assembleBody(list, {...base, reviewer: 'jane.doe'});
    contains(body, '/assign_reviewer @jane.doe');
    omits(body, '/reviewer @jane.doe');
  });

  it('leaves a cc line alone', () => {
    contains(assembleBody(list, base), 'cc @user1 @user2');
  });
});

describe('assembleBody — template without a reviewer line', () => {
  it('appends one', () => {
    const bare = '# T\n\n<Briefly describe x>\n\n/assign @a\n';
    const body = assembleBody(bare, {description: 'D', reviewer: 'jane.doe', done: []});
    assert.deepEqual(reviewerLines(body), ['/reviewer @jane.doe']);
  });

  it('does not append a reviewer that was cleared', () => {
    const bare = '# T\n\n<Briefly describe x>\n';
    assert.deepEqual(reviewerLines(assembleBody(bare, {description: 'D', reviewer: '', done: []})), []);
  });
});

describe('encodeDescription', () => {
  it('encodes an empty line as a bare escape', () => {
    assert.equal(encodeDescription('a\n\nb'), 'a\\n\\nb\\n');
  });
});
