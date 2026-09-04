import test from 'node:test';
import assert from 'node:assert/strict';

import { appendEvent, MAX_EVENTS } from '../lib/run-log.js';
import { events } from '../lib/run-events.js';

const run = (goal, steps) => [
  events.runStarted(goal),
  ...Array.from({ length: steps }, (_, i) => events.step(i + 1, steps)),
  events.runFinished('done')
];

test('appends without mutating the log it was given', () => {
  const log = [events.runStarted('g')];
  const next = appendEvent(log, events.step(1, 15), 10);

  assert.equal(log.length, 1);
  assert.equal(next.length, 2);
  assert.notEqual(next, log);
});

test('keeps everything while under the limit', () => {
  const log = run('g', 3);
  assert.equal(appendEvent(log, events.note('x'), 100).length, log.length + 1);
});

test('drops the oldest run whole rather than cutting into it', () => {
  const log = [...run('first', 3), ...run('second', 3)];
  const next = appendEvent(log, events.runStarted('third'), 8);

  const goals = next.filter((e) => e.kind === 'run_started').map((e) => e.goal);
  assert.deepEqual(goals, ['second', 'third']);
});

test('never leaves the log starting in the middle of a run', () => {
  let log = [];
  for (const goal of ['a', 'b', 'c', 'd']) {
    for (const event of run(goal, 6)) log = appendEvent(log, event, 12);
  }
  assert.equal(log.length <= 12, true);
  assert.equal(log[0].kind, 'run_started');
});

test('a single run longer than the limit keeps its opening event', () => {
  let log = [];
  for (const event of run('long', 40)) log = appendEvent(log, event, 10);

  assert.equal(log.length <= 10, true);
  assert.equal(log[0].kind, 'run_started');
  assert.equal(log[0].goal, 'long');
  assert.equal(log[log.length - 1].kind, 'run_finished');
});

test('exposes a default cap', () => {
  assert.equal(typeof MAX_EVENTS, 'number');
  assert.equal(MAX_EVENTS > 0, true);
});
