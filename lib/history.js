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

// Builds Gemini API `contents` from internal history items.
// Only the LAST user item keeps its full DOM text and screenshot;
// earlier user items collapse to their one-line summary. This is the
// core fix for runaway token usage (previously every step re-sent
// every prior DOM).
//
// History item shapes:
//   { role: 'user', summary: string, fullText: string, image: { mimeType, data } | null }
//   { role: 'model', text: string }
export function buildApiContents(history) {
  const lastUserIndex = history.reduce(
    (acc, item, i) => (item.role === 'user' ? i : acc),
    -1
  );

  return history.map((item, i) => {
    if (item.role === 'model') {
      return { role: 'model', parts: [{ text: item.text }] };
    }
    if (i === lastUserIndex) {
      const parts = [{ text: item.fullText }];
      if (item.image) {
        parts.push({ inlineData: { mimeType: item.image.mimeType, data: item.image.data } });
      }
      return { role: 'user', parts };
    }
    return { role: 'user', parts: [{ text: `${item.summary}\n${SNAPSHOT_OMITTED_NOTE}` }] };
  });
}
