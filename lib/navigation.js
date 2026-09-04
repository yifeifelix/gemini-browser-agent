// Validation for the agent's `navigate` action.
// Pure: returns a decision on the URL rather than mutating the caller's
// decision object, so the same input always yields the same verdict.

/**
 * Validates a decision's navigation target.
 *
 * Non-navigate actions pass through unchanged. For `navigate`, the URL is
 * coerced to https, parsed once, and rejected when it points at the local
 * machine or a private network.
 *
 * @param {{ action?: string, value?: string|null }} decision
 * @returns {{ valid: true, value: string|null } | { valid: false, error: string }}
 */
export function validateNavigation(decision) {
  if (!decision || decision.action !== 'navigate') {
    return { valid: true, value: (decision && decision.value) ?? null };
  }

  const raw = (decision.value || '').trim();
  if (!raw) {
    return { valid: false, error: 'Empty URL value provided.' };
  }

  let url = raw;
  if (url.startsWith('http://')) {
    url = 'https://' + url.substring(7);
  } else if (!url.startsWith('https://')) {
    url = 'https://' + url;
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    return { valid: false, error: 'Malformed URL path.' };
  }

  const host = parsed.hostname.toLowerCase();
  if (isLoopback(host) || isPrivateIPv4(host)) {
    return {
      valid: false,
      error: `Accessing local/private network domains (${host}) is blocked for safety.`
    };
  }

  // Return the parsed href, so the host that was checked and the URL that
  // gets navigated can never be two different strings.
  return { valid: true, value: parsed.href };
}

function isLoopback(host) {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

function isPrivateIPv4(host) {
  return /^10\./.test(host) ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host) ||
    /^192\.168\./.test(host);
}
