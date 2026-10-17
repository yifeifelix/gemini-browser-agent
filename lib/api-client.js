// Thin client for the official Gemini API (bring-your-own-key, free tier).
// Auth uses the X-Goog-Api-Key header.
// Pure helpers are exported separately so they can be unit-tested in Node.

export const DEFAULT_API_URL = 'https://generativelanguage.googleapis.com';
export const DEFAULT_MODEL = 'gemini-3.8-flash';

export function normalizeBaseUrl(url) {
  const trimmed = (url || '').trim();
  if (!trimmed) return DEFAULT_API_URL;
  return trimmed.replace(/\/+$/, '');
}

// Parses a GET /v1beta/models response body into [{ id, label }].
export function parseModelList(json) {
  if (!json || !Array.isArray(json.models)) return [];
  return json.models
    .map((m) => {
      const id = (m.name || '').replace(/^models\//, '');
      if (!id) return null;
      return { id, label: m.displayName || id };
    })
    .filter(Boolean);
}

// True when the HTTP failure means the API key itself is the problem.
// 401/403 always do; Google reports a bad key as 400 with API_KEY_INVALID,
// while other 400s (bad request body, unsupported parameter) are not key issues.
export function isKeyError(status, errJson) {
  if (status === 401 || status === 403) return true;
  if (status !== 400) return false;
  const err = errJson && errJson.error;
  if (!err) return false;
  const details = Array.isArray(err.details) ? err.details : [];
  return (
    details.some((d) => d && d.reason === 'API_KEY_INVALID') ||
    /API_KEY_INVALID|API key not valid/i.test(err.message || '')
  );
}

// Maps failures to actionable user-facing messages.
// Pass 'network' for a fetch TypeError, or an HTTP status code plus the
// parsed error body when available. Returns null when the caller should
// use generic handling.
export function describeApiError(status, errJson) {
  if (status === 'network') {
    return 'Cannot reach the Gemini API. Check your internet connection and try again.';
  }
  if (isKeyError(status, errJson)) {
    return `Google rejected your API Key (HTTP ${status}). Check that the key is correct and still active in Google AI Studio.`;
  }
  if (status === 400) {
    const msg = errJson && errJson.error && errJson.error.message;
    return `The Gemini API rejected the request (HTTP 400)${msg ? `: ${msg}` : '.'}`;
  }
  return null;
}

export const DAILY_QUOTA_MESSAGE =
  "Today's free quota is used up. It resets at midnight Pacific Time.";

// Classifies a 429 error body. A QuotaFailure violation whose quotaId
// contains "PerDay" means the daily free quota is exhausted (retrying is
// pointless); anything else is a per-minute rate limit worth backing off on.
// retryDelaySeconds comes from RetryInfo when present.
export function classifyRateLimit(errJson) {
  const result = { kind: 'minute', retryDelaySeconds: 30 };
  const err = errJson && errJson.error;
  if (err && /per\s*day|PerDay/i.test(err.message || '')) result.kind = 'daily';
  const details = err && err.details;
  if (!Array.isArray(details)) return result;
  for (const d of details) {
    const type = (d && d['@type']) || '';
    if (type.includes('QuotaFailure') && Array.isArray(d.violations)) {
      const daily = d.violations.some((v) =>
        /PerDay/i.test(`${v.quotaId || ''} ${v.quotaMetric || ''}`)
      );
      if (daily) result.kind = 'daily';
    } else if (type.includes('RetryInfo') && d.retryDelay) {
      result.retryDelaySeconds = Math.ceil(parseFloat(d.retryDelay)) || 30;
    }
  }
  return result;
}

// Models confirmed to accept thinkingConfig.thinkingLevel "LOW". An explicit
// allowlist: sibling models (*-image, *-tts, *-live, older budget-based
// families) reject the field with HTTP 400, so anything unlisted gets none.
export const THINKING_LOW_MODELS = ['gemini-3.8-flash'];

export function buildThinkingConfig(model) {
  return THINKING_LOW_MODELS.includes(model) ? { thinkingLevel: 'LOW' } : null;
}

async function readErrorBody(response) {
  try {
    return await response.json();
  } catch (e) {
    return null;
  }
}

// Follows nextPageToken so models beyond the first page are not missed.
export async function listModels(baseUrl, apiKey) {
  const base = normalizeBaseUrl(baseUrl);
  const models = [];
  let pageToken = '';
  for (let page = 0; page < 10; page++) {
    let url = `${base}/v1beta/models?pageSize=1000`;
    if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;
    let response;
    try {
      response = await fetch(url, { headers: { 'X-Goog-Api-Key': apiKey } });
    } catch (err) {
      throw new Error(describeApiError('network'));
    }
    if (!response.ok) {
      const errJson = await readErrorBody(response);
      const err = new Error(
        describeApiError(response.status, errJson) || `Model list request failed (HTTP ${response.status}).`
      );
      err.keyInvalid = isKeyError(response.status, errJson);
      throw err;
    }
    const json = await response.json();
    models.push(...parseModelList(json));
    pageToken = json && json.nextPageToken;
    if (!pageToken) break;
  }
  return models;
}

// Returns the raw Response so the caller can implement 429 retry logic.
// Throws with a friendly message only for connection-level failures.
export async function generateContent(baseUrl, apiKey, model, body) {
  const base = normalizeBaseUrl(baseUrl);
  try {
    return await fetch(`${base}/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: {
        'X-Goog-Api-Key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
  } catch (err) {
    throw new Error(describeApiError('network'));
  }
}
