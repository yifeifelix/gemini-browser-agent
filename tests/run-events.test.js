import test from 'node:test';
import assert from 'node:assert/strict';

import { events, toThread } from '../lib/run-events.js';

test('a finished run becomes a user turn, a work card, and an answer', () => {
  const thread = toThread([
    events.runStarted('book a flight'),
    events.step(1, 15),
    events.status('thinking'),
    events.thought('I will search first'),
    events.action({ action: 'click', targetId: '3' }),
    events.answer('Found **3** flights'),
    events.runFinished('done')
  ]);

  assert.deepEqual(thread.map((item) => item.kind), ['user', 'work', 'answer']);
  assert.equal(thread[0].text, 'book a flight');
  assert.equal(thread[1].state, 'done');
  assert.equal(thread[1].step, 1);
  assert.equal(thread[1].of, 15);
  assert.equal(thread[2].markdown, 'Found **3** flights');
});

test('the work card tracks the latest step it saw', () => {
  const thread = toThread([
    events.runStarted('g'),
    events.step(1, 15),
    events.step(2, 15),
    events.step(3, 15)
  ]);
  assert.equal(thread[1].step, 3);
});

test('a run still in flight is left running', () => {
  const thread = toThread([events.runStarted('g'), events.step(1, 15)]);
  assert.equal(thread[1].state, 'running');
});

test('a failed run is marked failed', () => {
  const thread = toThread([
    events.runStarted('g'),
    events.step(1, 15),
    events.runFinished('error')
  ]);
  assert.equal(thread[1].state, 'failed');
});

test('a log that begins mid-run still renders as a work card', () => {
  // What the panel sees after the cap dropped the front of the log.
  const thread = toThread([
    events.step(4, 15),
    events.thought('continuing'),
    events.runFinished('done')
  ]);

  assert.deepEqual(thread.map((item) => item.kind), ['work']);
  assert.equal(thread[0].step, 4);
  assert.equal(thread[0].state, 'done');
});

test('two runs produce two separate work cards', () => {
  const thread = toThread([
    events.runStarted('first'),
    events.step(1, 15),
    events.answer('one'),
    events.runFinished('done'),
    events.runStarted('second'),
    events.step(1, 15),
    events.answer('two'),
    events.runFinished('done')
  ]);

  assert.deepEqual(
    thread.map((item) => item.kind),
    ['user', 'work', 'answer', 'user', 'work', 'answer']
  );
  assert.equal(thread[0].text, 'first');
  assert.equal(thread[3].text, 'second');
});

test('a run interrupted by the next one is marked failed, not finished', () => {
  const thread = toThread([
    events.runStarted('first'),
    events.step(2, 15),
    events.runStarted('second')
  ]);
  // The first run never emitted run_finished, so it did not finish.
  assert.equal(thread[1].state, 'failed');
  assert.equal(thread[3].state, 'running');
});

test('notes outside a run stay loose, notes inside land on the card', () => {
  const thread = toThread([
    events.note('proxy unreachable', 'error'),
    events.runStarted('g'),
    events.note('reading page')
  ]);

  assert.deepEqual(thread.map((item) => item.kind), ['note', 'user', 'work']);
  assert.equal(thread[0].level, 'error');
  assert.equal(thread[2].lines.length, 1);
});

test('a status event can carry a detail, and the card keeps it', () => {
  const thread = toThread([
    events.runStarted('g'),
    events.status('reading_page', 'Flight search — Example')
  ]);
  assert.equal(thread[1].phase, 'reading_page');
  assert.equal(thread[1].phaseDetail, 'Flight search — Example');
});

test('steps are kept as work lines so the card body stays readable', () => {
  const thread = toThread([
    events.runStarted('g'),
    events.step(1, 15),
    events.thought('a'),
    events.step(2, 15),
    events.thought('b')
  ]);
  assert.deepEqual(
    thread[1].lines.map((l) => l.kind),
    ['step', 'thought', 'step', 'thought']
  );
});

test('a run that answered then finished is not retroactively failed', () => {
  const thread = toThread([
    events.runStarted('first'),
    events.answer('done'),
    events.runFinished('done'),
    events.runStarted('second')
  ]);
  assert.equal(thread[1].state, 'done');
});
