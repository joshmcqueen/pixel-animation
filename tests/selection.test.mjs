import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleRange, selectedFrames, validateExportFrames, validateFolderName } from '../dist-main/shared/selection.js';

test('range boundaries are inclusive and toggles survive range changes', () => {
  const excluded = new Set([1, 4, 8]);
  assert.deepEqual(selectedFrames(2, 6, excluded), [2, 3, 5, 6]);
  assert.deepEqual(selectedFrames(1, 9, excluded), [2, 3, 5, 6, 7, 9]);
  assert.deepEqual(selectedFrames(4, 4, excluded), []);
  assert.deepEqual(selectedFrames(5, 5, excluded), [5]);
});

test('every-Nth is anchored at range start and leaves outside choices intact', () => {
  const previous = new Set([1, 3, 10]);
  const next = sampleRange(previous, 3, 9, 3);
  assert.deepEqual(selectedFrames(3, 9, next), [3, 6, 9]);
  assert.ok(next.has(1));
  assert.ok(next.has(10));
  assert.deepEqual([...previous], [1, 3, 10]);
  assert.deepEqual(selectedFrames(3, 9, sampleRange(next, 3, 9, 1)), [3, 4, 5, 6, 7, 8, 9]);
  assert.throws(() => sampleRange(next, 1, 3, 0));
});

test('export validates frame bounds and gives unique source order', () => {
  assert.deepEqual(validateExportFrames([8, 2, 2, 5], 10), [2, 5, 8]);
  for (const frames of [[], [0], [11], [1.5], ['2'], null]) assert.throws(() => validateExportFrames(frames, 10));
});

test('export folder names cannot escape the chosen directory', () => {
  assert.equal(validateFolderName('  walk front  '), 'walk front');
  for (const name of ['', ' ', '..', '../escape', 'a/b', 'a\\b', 'a:b', 'a\0b', 'a'.repeat(81), null]) assert.throws(() => validateFolderName(name));
});
