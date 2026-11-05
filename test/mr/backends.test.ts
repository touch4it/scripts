import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {memberChoices, milestoneChoices} from '../../src/mr/backends.ts';

describe('GitLab list parsing', () => {
  it('keeps active members once each, sorted, with the name as hint', () => {
    assert.deepEqual(memberChoices([
      {username: 'zoe', name: 'Zoe Z', state: 'active'},
      {username: 'adam', name: 'Adam A', state: 'active'},
      {username: 'zoe', name: 'Zoe Z', state: 'active'},
      {username: 'gone', name: 'Gone G', state: 'blocked'},
      {name: 'No Username', state: 'active'},
      'junk',
    ]), [
      {value: 'adam', hint: 'Adam A'},
      {value: 'zoe', hint: 'Zoe Z'},
    ]);
    assert.deepEqual(memberChoices({message: '401 Unauthorized'}), []);
  });

  it('lists milestone titles once each, with the due date as hint', () => {
    assert.deepEqual(milestoneChoices([
      {title: 'Sprint 2', due_date: '2026-11-20'},
      {title: 'Sprint 1', due_date: null},
      {title: 'Sprint 2', due_date: '2026-11-20'},
      {due_date: '2026-12-01'},
    ]), [
      {value: 'Sprint 1', hint: undefined},
      {value: 'Sprint 2', hint: '2026-11-20'},
    ]);
  });
});
