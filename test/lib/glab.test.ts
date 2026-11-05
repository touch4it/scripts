import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {glabEnv} from '../../src/lib/glab.ts';

describe('glabEnv', () => {
  it('takes only the glab variables from the env file, and the shell wins over the file', () => {
    const file = 'GITLAB_TOKEN=from-file\nGITLAB_HOST=gitlab.example.com\nDATABASE_URL=postgres://x\n';

    assert.deepEqual(glabEnv(file, {PATH: '/bin'}), {
      GITLAB_TOKEN: 'from-file',
      GITLAB_HOST: 'gitlab.example.com',
      PATH: '/bin',
    });
    assert.deepEqual(glabEnv(file, {GITLAB_TOKEN: 'from-shell'}), {
      GITLAB_TOKEN: 'from-shell',
      GITLAB_HOST: 'gitlab.example.com',
    });
    assert.deepEqual(glabEnv(undefined, {PATH: '/bin'}), {PATH: '/bin'});
  });
});
