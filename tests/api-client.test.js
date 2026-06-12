import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeBaseUrl,
  parseModelList,
  describeApiError,
  DEFAULT_PROXY_URL
} from '../lib/api-client.js';

test('normalizeBaseUrl strips trailing slashes and whitespace', () => {
  assert.equal(normalizeBaseUrl('http://127.0.0.1:8317/'), 'http://127.0.0.1:8317');
  assert.equal(normalizeBaseUrl('  http://localhost:9000  '), 'http://localhost:9000');
});

test('normalizeBaseUrl falls back to default for empty input', () => {
  assert.equal(normalizeBaseUrl(''), DEFAULT_PROXY_URL);
  assert.equal(normalizeBaseUrl(undefined), DEFAULT_PROXY_URL);
});

test('parseModelList maps models/ prefixed names to ids', () => {
  const json = {
    models: [
      { name: 'models/gemini-3.1-pro', displayName: 'Gemini 3.1 Pro' },
      { name: 'models/gemini-2.5-flash' },
      { bogus: true }
    ]
  };
  assert.deepEqual(parseModelList(json), [
    { id: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro' },
    { id: 'gemini-2.5-flash', label: 'gemini-2.5-flash' }
  ]);
});

test('parseModelList tolerates malformed payloads', () => {
  assert.deepEqual(parseModelList(null), []);
  assert.deepEqual(parseModelList({}), []);
  assert.deepEqual(parseModelList({ models: 'nope' }), []);
});

test('describeApiError gives actionable messages', () => {
  assert.match(describeApiError('network', 'http://127.0.0.1:8317'), /CLIProxyAPI is running/);
  assert.match(describeApiError(401, 'x'), /API Key/);
  assert.match(describeApiError(403, 'x'), /API Key/);
  assert.equal(describeApiError(500, 'x'), null);
});
