// Pure helpers for prompt assembly and token-budget control.
// No chrome.* APIs here so this module can be unit-tested in Node.

export const DOM_CHAR_BUDGET = 8000;
export const SNAPSHOT_OMITTED_NOTE = '[Page snapshot omitted to save tokens]';

// Truncates a simplified DOM string to a character budget.
// Keeps whole lines from the top (title/URL header first), never cuts mid-line.
export function truncateDom(dom, maxChars = DOM_CHAR_BUDGET) {
  if (typeof dom !== 'string') return '';
  if (dom.length <= maxChars) return dom;

  const note = '...(interactive element list truncated to save tokens)';
  const lines = dom.split('\n');
  const kept = [];
  let used = note.length + 1;

  for (const line of lines) {
    if (used + line.length + 1 > maxChars) break;
    kept.push(line);
    used += line.length + 1;
  }

  return [...kept, note].join('\n');
}
