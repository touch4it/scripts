import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {applyKey} from '../../src/lib/editor.ts';

describe('applyKey', () => {
  it('moves and deletes by word and line the way macOS text fields do, and leaves other keys to clack', () => {
    const text = 'fix the bug\nsecond line';
    const at = (cursor: number) => ({text, cursor});

    assert.deepEqual(applyKey({name: 'left', meta: true}, at(11)), at(8));
    assert.deepEqual(applyKey({name: 'b', meta: true}, at(8)), at(4));
    assert.deepEqual(applyKey({name: 'right', meta: true}, at(0)), at(3));
    assert.deepEqual(applyKey({name: 'f', meta: true}, at(11)), at(18));
    assert.deepEqual(applyKey({name: 'a', ctrl: true}, at(15)), at(12));
    assert.deepEqual(applyKey({name: 'home'}, {text: '\nabc', cursor: 0}), {text: '\nabc', cursor: 0});
    assert.deepEqual(applyKey({name: 'e', ctrl: true}, at(2)), at(11));

    assert.deepEqual(applyKey({name: 'backspace', meta: true}, at(11)), {text: 'fix the \nsecond line', cursor: 8});
    assert.deepEqual(applyKey({name: 'd', meta: true}, at(3)), {text: 'fix bug\nsecond line', cursor: 3});
    assert.deepEqual(applyKey({name: 'u', ctrl: true}, at(15)), {text: 'fix the bug\nond line', cursor: 12});
    assert.deepEqual(applyKey({name: 'k', ctrl: true}, at(4)), {text: 'fix \nsecond line', cursor: 4});

    assert.equal(applyKey({name: 'left'}, at(4)), undefined);
    assert.equal(applyKey({name: 'escape'}, at(4)), undefined);
    assert.equal(applyKey({name: 'a'}, at(4)), undefined);
  });
});
