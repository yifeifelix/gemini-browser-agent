// Thin client for a local CLIProxyAPI (Gemini-compatible) endpoint.
// Auth uses the X-Goog-Api-Key header (verified against CLIProxyAPI
// source: internal/access/config_access/provider.go).
// Pure helpers are exported separately so they can be unit-tested in Node.

export const DEFAULT_PROXY_URL = 'http://127.0.0.1:8317';

export function normalizeBaseUrl(url) {
  const trimmed = (url || '').trim();
  if (!trimmed) return DEFAULT_PROXY_URL;
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
// Pass 'network' for fetch TypeError (connection refused), or an HTTP
// status code. Returns null when the caller should use generic handling.
export function describeApiError(status, baseUrl) {
  if (status === 'network') {
    return `Cannot reach the local proxy at ${baseUrl}. Make sure CLIProxyAPI is running.`;
  }
  if (status === 401 || status === 403) {
    return `The proxy rejected the request (HTTP ${status}). Check the API Key in extension settings.`;
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
    throw new Error(describeApiError('network', base));
  }
  if (!response.ok) {
    const friendly = describeApiError(response.status, base);
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
    throw new Error(describeApiError('network', base));
  }
}
