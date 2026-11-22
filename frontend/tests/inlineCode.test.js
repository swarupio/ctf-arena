import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInlineCode } from '../src/pages/inlineCode.js';

test('backtick spans become code parts and the rest stays text', () => {
  assert.deepEqual(parseInlineCode('Flag format: `CTF{...}`'), [
    { type: 'text', value: 'Flag format: ' },
    { type: 'code', value: 'CTF{...}' },
  ]);
  assert.deepEqual(parseInlineCode('a `b` c `d` e'), [
    { type: 'text', value: 'a ' }, { type: 'code', value: 'b' }, { type: 'text', value: ' c ' },
    { type: 'code', value: 'd' }, { type: 'text', value: ' e' },
  ]);
});

test('unmatched and empty backticks stay literal', () => {
  assert.deepEqual(parseInlineCode('one ` tick'), [{ type: 'text', value: 'one ` tick' }]);
  assert.deepEqual(parseInlineCode('empty `` pair'), [{ type: 'text', value: 'empty `` pair' }]);
  assert.deepEqual(parseInlineCode('`a` and `b'), [{ type: 'code', value: 'a' }, { type: 'text', value: ' and `b' }]);
});

test('markup is data, never interpreted; non-strings and empty input are safe', () => {
  assert.deepEqual(parseInlineCode('`<img src=x onerror=1>`'), [{ type: 'code', value: '<img src=x onerror=1>' }]);
  assert.deepEqual(parseInlineCode('<b>hi</b>'), [{ type: 'text', value: '<b>hi</b>' }]);
  assert.deepEqual(parseInlineCode(''), []);
  assert.deepEqual(parseInlineCode(undefined), []);
  assert.deepEqual(parseInlineCode(42), []);
});
