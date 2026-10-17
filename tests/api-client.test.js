import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeBaseUrl,
  parseModelList,
  describeApiError,
  classifyRateLimit,
  isKeyError,
  listModels,
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
  assert.match(describeApiError(401), /API Key/);
  assert.match(describeApiError(403), /API Key/);
  assert.equal(describeApiError(500), null);
  for (const s of ['network', 401, 403]) {
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

test('buildThinkingConfig uses an allowlist and the LOW enum', () => {
  assert.deepEqual(buildThinkingConfig('gemini-3.8-flash'), { thinkingLevel: 'LOW' });
  assert.equal(buildThinkingConfig('gemini-3.1-flash-lite-image'), null);
  assert.equal(buildThinkingConfig('gemini-3.8-flash-tts'), null);
  assert.equal(buildThinkingConfig('gemini-3.8-flash-live'), null);
  assert.equal(buildThinkingConfig('gemini-2.5-flash'), null);
  assert.equal(buildThinkingConfig(undefined), null);
});

test('400 is a key problem only when the body says API_KEY_INVALID', () => {
  const badKey = { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID' }] } };
  const other = { error: { code: 400, message: 'Thinking level is not supported for this model.' } };
  assert.equal(isKeyError(400, badKey), true);
  assert.equal(isKeyError(400, other), false);
  assert.equal(isKeyError(400, null), false);
  assert.equal(isKeyError(401, null), true);
  assert.equal(isKeyError(403, null), true);
  assert.match(describeApiError(400, badKey), /API Key/);
  const msg = describeApiError(400, other);
  assert.match(msg, /Thinking level is not supported for this model\./);
  assert.doesNotMatch(msg, /API Key/);
});

test('classifyRateLimit handles fractional delays and message-only daily hints', () => {
  const frac = { error: { details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '7.5s' }] } };
  assert.equal(classifyRateLimit(frac).retryDelaySeconds, 8);
  const msgOnly = { error: { message: 'Quota exceeded: requests per day limit reached' } };
  assert.equal(classifyRateLimit(msgOnly).kind, 'daily');
});

function stubFetch(responses) {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    const r = responses.shift();
    return { ok: r.status === undefined, status: r.status || 200, json: async () => r.body };
  };
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

test('listModels requests pageSize=1000 with the key header and follows pages', async () => {
  const stub = stubFetch([
    { body: { models: [{ name: 'models/a' }], nextPageToken: 'tok 2' } },
    { body: { models: [{ name: 'models/gemini-3.8-flash' }] } }
  ]);
  try {
    const models = await listModels(DEFAULT_API_URL, 'KEY');
    assert.deepEqual(models.map((m) => m.id), ['a', 'gemini-3.8-flash']);
    assert.equal(stub.calls[0].url, `${DEFAULT_API_URL}/v1beta/models?pageSize=1000`);
    assert.equal(stub.calls[1].url, `${DEFAULT_API_URL}/v1beta/models?pageSize=1000&pageToken=tok%202`);
    assert.equal(stub.calls[0].init.headers['X-Goog-Api-Key'], 'KEY');
  } finally {
    stub.restore();
  }
});

test('listModels flags rejected keys but not other failures', async () => {
  let stub = stubFetch([{ status: 400, body: { error: { details: [{ reason: 'API_KEY_INVALID' }] } } }]);
  try {
    await assert.rejects(listModels(DEFAULT_API_URL, 'bad'), (e) => e.keyInvalid === true && /API Key/.test(e.message));
  } finally { stub.restore(); }
  stub = stubFetch([{ status: 400, body: { error: { message: 'Something else' } } }]);
  try {
    await assert.rejects(listModels(DEFAULT_API_URL, 'k'), (e) => e.keyInvalid === false && /Something else/.test(e.message));
  } finally { stub.restore(); }
});
