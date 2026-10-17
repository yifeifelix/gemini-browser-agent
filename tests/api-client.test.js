import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeBaseUrl,
  parseModelList,
  describeApiError,
  classifyRateLimit,
  buildThinkingConfig,
  DEFAULT_API_URL,
  DEFAULT_MODEL
} from '../lib/api-client.js';

test('normalizeBaseUrl strips trailing slashes and whitespace', () => {
  assert.equal(normalizeBaseUrl('http://localhost:9001/'), 'http://localhost:9001');
  assert.equal(normalizeBaseUrl('  http://localhost:9000  '), 'http://localhost:9000');
});

test('normalizeBaseUrl falls back to default for empty input', () => {
  assert.equal(normalizeBaseUrl(''), DEFAULT_API_URL);
  assert.equal(normalizeBaseUrl(undefined), DEFAULT_API_URL);
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

test('default base URL is the official Gemini API', () => {
  assert.equal(DEFAULT_API_URL, 'https://generativelanguage.googleapis.com');
  assert.equal(DEFAULT_MODEL, 'gemini-3.8-flash');
});

test('describeApiError gives key-oriented messages without proxy wording', () => {
  assert.match(describeApiError('network'), /Gemini API/);
  assert.match(describeApiError(400), /API Key/); // Google returns 400 for invalid API keys
  assert.match(describeApiError(401), /API Key/);
  assert.match(describeApiError(403), /API Key/);
  assert.equal(describeApiError(500), null);
  for (const s of ['network', 400, 401, 403]) {
    assert.doesNotMatch(describeApiError(s), /proxy|cliproxy/i);
  }
});

test('classifyRateLimit detects exhausted daily quota', () => {
  const body = {
    error: {
      code: 429,
      details: [
        {
          '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
          violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }]
        },
        { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '12s' }
      ]
    }
  };
  assert.equal(classifyRateLimit(body).kind, 'daily');
});

test('classifyRateLimit treats per-minute limits as retryable and reads RetryInfo', () => {
  const body = {
    error: {
      details: [
        {
          '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
          violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }]
        },
        { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '41s' }
      ]
    }
  };
  assert.deepEqual(classifyRateLimit(body), { kind: 'minute', retryDelaySeconds: 41 });
});

test('classifyRateLimit falls back to minute/30s on missing or malformed bodies', () => {
  assert.deepEqual(classifyRateLimit(null), { kind: 'minute', retryDelaySeconds: 30 });
  assert.deepEqual(classifyRateLimit({ error: {} }), { kind: 'minute', retryDelaySeconds: 30 });
});

test('buildThinkingConfig sends level only for Gemini 3+ models', () => {
  assert.deepEqual(buildThinkingConfig('gemini-3.8-flash'), { thinkingLevel: 'low' });
  assert.deepEqual(buildThinkingConfig('gemini-3.1-pro'), { thinkingLevel: 'low' });
  assert.equal(buildThinkingConfig('gemini-2.5-flash'), null);
  assert.equal(buildThinkingConfig(undefined), null);
});
