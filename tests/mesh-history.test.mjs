// Copyright (c) 2025 cmutnik
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistory } from '../tools/mesh-modifier/history.js';

test('history: undo and redo walk through the recorded states', () => {
  const h = createHistory();
  h.reset('a', 'a');
  assert.deepEqual([h.canUndo, h.canRedo], [false, false]);
  h.push('b', 'b'); h.push('c', 'c');
  assert.equal(h.undo(), 'b'); assert.equal(h.undo(), 'a'); assert.equal(h.undo(), null, 'nothing before the first state');
  assert.deepEqual([h.canUndo, h.canRedo], [false, true]);
  assert.equal(h.redo(), 'b'); assert.equal(h.redo(), 'c'); assert.equal(h.redo(), null);
  assert.deepEqual([h.canUndo, h.canRedo], [true, false]);
});

test('history: an unchanged state is not recorded, a new one after undo drops the redo branch', () => {
  const h = createHistory();
  h.reset('a', 'k1');
  assert.equal(h.push('a again', 'k1'), false); assert.equal(h.size, 1);
  h.push('b', 'k2'); h.push('c', 'k3');
  h.undo(); h.undo();
  assert.equal(h.push('d', 'k4'), true);
  assert.equal(h.canRedo, false, 'the old future is gone');
  assert.equal(h.undo(), 'a');
  assert.equal(h.redo(), 'd');
});

test('history: it keeps only the most recent states', () => {
  const h = createHistory(3);
  h.reset(0, '0');
  for (let i = 1; i <= 5; i++) h.push(i, String(i));
  assert.equal(h.size, 3);
  assert.equal(h.undo(), 4); assert.equal(h.undo(), 3); assert.equal(h.undo(), null);
});

test('history: reset forgets everything', () => {
  const h = createHistory();
  h.reset('a', 'a'); h.push('b', 'b');
  h.reset('x', 'x');
  assert.deepEqual([h.size, h.canUndo, h.canRedo], [1, false, false]);
});
