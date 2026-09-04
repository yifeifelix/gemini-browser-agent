import test from 'node:test';
import assert from 'node:assert/strict';

import { validateNavigation } from '../lib/navigation.js';

test('rejects an empty URL value', () => {
  const result = validateNavigation({ action: 'navigate', value: '   ' });
  assert.equal(result.valid, false);
  assert.match(result.error, /empty/i);
});

test('upgrades http to https', () => {
  const result = validateNavigation({ action: 'navigate', value: 'http://example.com/a' });
  assert.equal(result.valid, true);
  assert.equal(result.value, 'https://example.com/a');
});

test('adds https when the scheme is missing', () => {
  const result = validateNavigation({ action: 'navigate', value: 'example.com/a' });
  assert.equal(result.valid, true);
  assert.equal(result.value, 'https://example.com/a');
});

test('blocks loopback hosts', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    const result = validateNavigation({ action: 'navigate', value: `https://${host}/x` });
    assert.equal(result.valid, false, `${host} should be blocked`);
    assert.match(result.error, /local\/private/i);
  }
});

test('blocks private IPv4 ranges', () => {
  for (const host of ['10.0.0.5', '172.16.3.1', '172.31.255.1', '192.168.1.1']) {
    const result = validateNavigation({ action: 'navigate', value: `https://${host}/x` });
    assert.equal(result.valid, false, `${host} should be blocked`);
  }
});

test('allows public hosts that merely look private', () => {
  for (const host of ['172.15.0.1', '172.32.0.1', '110.0.0.1', '192.169.1.1']) {
    const result = validateNavigation({ action: 'navigate', value: `https://${host}/x` });
    assert.equal(result.valid, true, `${host} should be allowed`);
  }
});

test('rejects a malformed URL', () => {
  const result = validateNavigation({ action: 'navigate', value: 'https://exa mple .com:99999' });
  assert.equal(result.valid, false);
  assert.match(result.error, /malformed/i);
});

test('does not mutate the decision it is given', () => {
  const decision = Object.freeze({ action: 'navigate', value: 'http://example.com' });
  const result = validateNavigation(decision);
  assert.equal(result.value, 'https://example.com/');
  assert.equal(decision.value, 'http://example.com');
});

test('passes non-navigate actions through untouched', () => {
  const decision = { action: 'click', targetId: '12', value: null };
  const result = validateNavigation(decision);
  assert.equal(result.valid, true);
  assert.equal(result.value, null);
});
