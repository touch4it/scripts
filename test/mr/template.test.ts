import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {describe, it} from 'node:test';
import {fileURLToPath} from 'node:url';

import {
  assembleBody,
  encodeDescription,
  parseTasks,
  parseTemplate,
  reviewerValue,
  TemplateError,
  templateValue,
} from '../../src/mr/template.ts';

// Templates of the shapes the tool is built for, with placeholder identities so
// assertions stay exact. The tool reads the consuming repository's own template
// at runtime; these only have to be representative.
const read = (name: string): string => readFileSync(
  fileURLToPath(new URL(`../../.gitlab/merge_request_templates/${name}`, import.meta.url)),
  'utf8',
);

// A `| N/A | Done | Task |` table, /reviewer, and a milestone.
const tableText = read('Default.md');
const table = parseTemplate(tableText);
// A `| Done | N/A | Task |` table with the checkbox columns switched.
const switched = parseTemplate(read('Default2.md'));
// A `- [ ] Task` list, /assign_reviewer, and no milestone.
const listText = read('Default3.md');
const list = parseTemplate(listText);
// A list marking skipped rows `[~]`, with its instructions in fenced blocks.
const fenced = parseTemplate(read('Default4.md'));

const shapes = [
  {name: 'table (Default.md)', template: table, rows: 6},
  {name: 'switched table (Default2.md)', template: switched, rows: 10},
  {name: 'list (Default3.md)', template: list, rows: 6},
  {name: 'fenced list (Default4.md)', template: fenced, rows: 4},
];

const minimal = (extra = ''): string =>
  `# T\n\n<!-- mr:description -->\nx\n<!-- /mr:description -->\n\n<!-- mr:tasks -->\n<!-- /mr:tasks -->\n${extra}`;

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
    assert.equal(templateValue(tableText, 'assign'), 'assignee');
    assert.equal(templateValue(tableText, 'reviewer'), 'reviewer');
    assert.equal(templateValue(tableText, 'target_branch'), 'master');
    assert.equal(templateValue(tableText, 'milestone'), '0.0.0');
  });

  it('reads the quick actions of the list template', () => {
    assert.equal(templateValue(listText, 'assign'), 'assignee');
    assert.equal(templateValue(listText, 'assign_reviewer'), 'reviewer');
    assert.equal(templateValue(listText, 'target_branch'), 'master');
    assert.equal(templateValue(listText, 'milestone'), '');
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
    assert.equal(reviewerValue(tableText), 'reviewer');
    assert.equal(reviewerValue(listText), 'reviewer');
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

  it('reads the switched-column table checklist', () => {
    assert.deepEqual(parseTasks(switched), [
      'Added/Updated tests',
      'Ran `npm run lint` locally for all affected systems',
      'Ran `npm run test` locally for all affected systems',
      'Tested other related features',
      'Updated OpenAPI documentation',
      'Updated AsyncAPI documentation in `resources/asyncapi/`',
      'Updated documentation in `docs/`',
      'Set milestone',
      'Updated technical notes in Requirement',
      'Notified data team if data structure is affected',
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

  it('reads only the rows inside the mr:tasks region', () => {
    assert.deepEqual(parseTasks(parseTemplate(minimal('\n- [ ] Outside the region\n'))), []);
  });
});

describe('parseTemplate', () => {
  it('rejects a template whose regions are missing or malformed', () => {
    const rejects = (text: string, message: RegExp): void => {
      assert.throws(() => parseTemplate(text), (error: unknown) => error instanceof TemplateError && message.test(error.message));
    };

    rejects('# T\n\n<Briefly describe x>\n', /missing the <!-- mr:description -->/);
    rejects('<!-- mr:description -->\nx\n<!-- /mr:description -->\n', /missing the <!-- mr:tasks -->/);
    rejects(minimal('<!-- mr:summary -->\n<!-- /mr:summary -->\n'), /unknown region mr:summary/);
    rejects(minimal('<!-- mr:explanation -->\n'), /mr:explanation is never closed/);
    rejects(minimal('<!-- /mr:explanation -->\n'), /closes no open region/);
    rejects(minimal('<!-- mr:description -->\n<!-- /mr:description -->\n'), /mr:description appears more than once/);
    rejects('<!-- mr:description -->\n<!-- mr:tasks -->\n', /mr:tasks opens inside mr:description/);
    rejects('<!-- mr:description na="[~]" -->\n<!-- /mr:description -->\n', /does not take the attribute na/);
    rejects(
      '<!-- mr:description -->\n<!-- /mr:description -->\n<!-- mr:tasks -->\n| [ ] | [ ] | Task |\n<!-- /mr:tasks -->\n',
      /needs a header naming its Done and N\/A columns/,
    );
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

    it('replaces the description region, markers included', () => {
      const body = assembleBody(template, base);
      omits(body, 'Briefly describe');
      omits(body, 'mr:');
      contains(body, 'DESC');
    });

    it('drops the explanation region and its blank line when no explanation is given', () => {
      const body = assembleBody(template, base);
      omits(body, 'If any of these');
      omits(body, '\n\n\n');
    });

    it('substitutes the explanation where the template puts it', () => {
      const body = assembleBody(template, {...base, explanation: 'Config-only.'});
      omits(body, 'If any of these');
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

describe('assembleBody — switched table specifics', () => {
  const base = {
    description: 'DESC',
    done: [true, false, ...Array.from({length: 8}, () => false)],
    reviewer: 'reviewer',
  };

  it('checks the Done column first, N/A second', () => {
    const rows = assembleBody(switched, base).split('\n').filter(line => line.startsWith('| ['));
    assert.ok(rows[0]?.startsWith('| [x]'), 'row 1 should tick the leading Done column');
    contains(rows[0] ?? '', 'Added/Updated tests');
    assert.ok(rows[1]?.startsWith('| [ ]  | [x]'), 'row 2 should tick the trailing N/A column');
    contains(rows[1] ?? '', 'Ran `npm run lint`');
  });

  it('preserves the wider column alignment', () => {
    const body = assembleBody(switched, {...base, done: Array.from({length: 10}, () => true)});
    contains(body, '| [x]  | [ ] | Added/Updated tests');
  });

  it('keeps the /assign_reviewer alias the template used', () => {
    contains(assembleBody(switched, {...base, reviewer: 'jane.doe'}), '/assign_reviewer @jane.doe');
  });
});

describe('assembleBody — list specifics', () => {
  const base = {description: 'DESC', done: [true, false, true, false, false, false], reviewer: 'reviewer'};

  it('ticks done rows and leaves the rest unchecked when the region sets no na mark', () => {
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

describe('assembleBody — fenced list specifics', () => {
  it('marks rows that are not done with the region’s na mark', () => {
    const rows = assembleBody(fenced, {description: 'DESC', done: [true, false]})
      .split('\n')
      .filter(line => line.startsWith('- ['));
    assert.deepEqual(rows, [
      '- [x] Added/Updated tests',
      '- [~] Ran `npm run lint` locally',
      '- [~] Ran `npm run test` locally',
      '- [~] Updated OpenAPI documentation',
    ]);
  });

  it('replaces the fenced instructions instead of keeping them', () => {
    const body = assembleBody(fenced, {description: 'DESC', explanation: 'Docs only.'});
    omits(body, '```text');
    contains(body, '## What is this for\n\nDESC\n\n## Pre-merge tasks\n\nDocs only.\n\n- [~] Added/Updated tests');
  });
});

describe('assembleBody — template without a reviewer line', () => {
  it('appends one', () => {
    const bare = parseTemplate(minimal('\n/assign @a\n'));
    const body = assembleBody(bare, {description: 'D', reviewer: 'jane.doe', done: []});
    assert.deepEqual(reviewerLines(body), ['/reviewer @jane.doe']);
  });

  it('does not append a reviewer that was cleared', () => {
    const bare = parseTemplate(minimal());
    assert.deepEqual(reviewerLines(assembleBody(bare, {description: 'D', reviewer: '', done: []})), []);
  });
});

describe('encodeDescription', () => {
  it('encodes an empty line as a bare escape', () => {
    assert.equal(encodeDescription('a\n\nb'), 'a\\n\\nb\\n');
  });
});
