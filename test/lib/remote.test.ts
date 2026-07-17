import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {newMergeRequestUrl, parseRemote} from '../../src/lib/remote.ts';

describe('parseRemote', () => {
  const cases: Array<[url: string, host: string, project: string]> = [
    ['git@gitlab.touch4it.com:pba/fe-backoffice.git', 'gitlab.touch4it.com', 'pba/fe-backoffice'],
    ['git@gitlab.touch4it.com:pba/fe-backoffice', 'gitlab.touch4it.com', 'pba/fe-backoffice'],
    ['https://gitlab.touch4it.com/pba/fe-backoffice.git', 'gitlab.touch4it.com', 'pba/fe-backoffice'],
    ['https://marian@gitlab.touch4it.com/pba/fe-backoffice.git', 'gitlab.touch4it.com', 'pba/fe-backoffice'],
    ['ssh://git@gitlab.touch4it.com:2222/pba/fe-backoffice.git', 'gitlab.touch4it.com', 'pba/fe-backoffice'],
    ['ssh://git@gitlab.touch4it.com/pba/fe-backoffice.git', 'gitlab.touch4it.com', 'pba/fe-backoffice'],
    ['gitlab.touch4it.com:pba/fe-backoffice.git', 'gitlab.touch4it.com', 'pba/fe-backoffice'],
    ['git@gitlab.com:someone/fe-backoffice.git', 'gitlab.com', 'someone/fe-backoffice'],
  ];

  for (const [url, host, project] of cases) {
    it(`parses ${url}`, () => {
      assert.deepEqual(parseRemote(url), {host, project});
    });
  }

  it('keeps nested subgroups intact', () => {
    assert.deepEqual(parseRemote('git@gitlab.touch4it.com:pba/team/sub/proj.git'), {
      host: 'gitlab.touch4it.com',
      project: 'pba/team/sub/proj',
    });
    assert.deepEqual(parseRemote('https://gitlab.touch4it.com/pba/team/sub/proj.git'), {
      host: 'gitlab.touch4it.com',
      project: 'pba/team/sub/proj',
    });
  });

  it('only strips a trailing .git, not one inside the project name', () => {
    assert.deepEqual(parseRemote('git@gitlab.touch4it.com:pba/my.gitlab.git'), {
      host: 'gitlab.touch4it.com',
      project: 'pba/my.gitlab',
    });
  });

  for (const url of ['/Users/marianvismek/Dev/mirror', 'file:///Users/marianvismek/Dev/mirror', '', 'nonsense']) {
    it(`rejects ${JSON.stringify(url)} rather than mangling it`, () => {
      assert.equal(parseRemote(url), undefined);
    });
  }
});

describe('newMergeRequestUrl', () => {
  it('builds the UI fallback link from the derived remote', () => {
    assert.equal(
      newMergeRequestUrl({host: 'gitlab.touch4it.com', project: 'pba/fe-backoffice', branch: '85052-mr'}),
      'https://gitlab.touch4it.com/pba/fe-backoffice/-/merge_requests/new?merge_request%5Bsource_branch%5D=85052-mr',
    );
  });

  it('escapes branch names containing a slash', () => {
    const url = newMergeRequestUrl({host: 'h', project: 'p', branch: 'feat/x y'});
    assert.ok(url.includes('feat%2Fx%20y'), `slash and space should be escaped, got ${url}`);
  });
});
