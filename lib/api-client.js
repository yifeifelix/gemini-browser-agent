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

// Maps connection-level failures to actionable user-facing messages.
// Pass 'network' for a fetch TypeError, or an HTTP status code.
// Returns null when the caller should use generic handling.
export function describeApiError(status) {
  if (status === 'network') {
    return 'Cannot reach the Gemini API. Check your internet connection and try again.';
  }
  // Google's Generative Language API responds with 400 INVALID_ARGUMENT
  // (API_KEY_INVALID) for malformed or unknown API keys.
  if (status === 400 || status === 401 || status === 403) {
    return `Google rejected your API Key (HTTP ${status}). Check that the key is correct and still active in Google AI Studio.`;
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
  const details = errJson && errJson.error && errJson.error.details;
  if (!Array.isArray(details)) return result;
  for (const d of details) {
    const type = (d && d['@type']) || '';
    if (type.includes('QuotaFailure') && Array.isArray(d.violations)) {
      const daily = d.violations.some((v) =>
        /PerDay/i.test(`${v.quotaId || ''} ${v.quotaMetric || ''}`)
      );
      if (daily) result.kind = 'daily';
    } else if (type.includes('RetryInfo') && d.retryDelay) {
      result.retryDelaySeconds = parseInt(d.retryDelay, 10) || 30;
    }
  }
  return result;
}

// Gemini 3+ models take thinkingConfig.thinkingLevel; older models use a
// token budget instead and reject the level (HTTP 400), so only send it
// where it is supported.
export function buildThinkingConfig(model, level = 'low') {
  if (/^gemini-([3-9]|\d{2,})/.test(model || '')) {
    return { thinkingLevel: level };
  }
  return null;
}

export async function listModels(baseUrl, apiKey) {
  const base = normalizeBaseUrl(baseUrl);
  let response;
  try {
    response = await fetch(`${base}/v1beta/models`, {
      headers: { 'X-Goog-Api-Key': apiKey }
    });
  } catch (err) {
    throw new Error(describeApiError('network'));
  }
  if (!response.ok) {
    const friendly = describeApiError(response.status);
    throw new Error(friendly || `Model list request failed (HTTP ${response.status}).`);
  }
  return parseModelList(await response.json());
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
