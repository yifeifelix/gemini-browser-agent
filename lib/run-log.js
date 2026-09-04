// The bounded event log the background keeps so a reopened side panel can
// rebuild the thread.
//
// The old log capped itself by shifting single lines off the front, which
// eventually removed the marker the panel used to know a run had started —
// and the panel then rebuilt the thread wrongly. Trimming happens at run
// boundaries instead, so the log never begins in the middle of a run.

export const MAX_EVENTS = 200;

/**
 * Appends one run event, trimming older runs to stay within the cap.
 *
 * @param {ReadonlyArray<object>} log
 * @param {object} event
 * @param {number} [limit]
 * @returns {Array<object>} a new log
 */
export function appendEvent(log, event, limit = MAX_EVENTS) {
  const next = [...(Array.isArray(log) ? log : []), event];
  return next.length <= limit ? next : trim(next, limit);
}

function trim(log, limit) {
  let out = log;

  while (out.length > limit) {
    const starts = runStartIndices(out);

    // More than one run present: drop the oldest one entirely.
    if (starts.length >= 2) {
      out = out.slice(starts[1]);
      continue;
    }

    // A single run longer than the cap: keep its opening event and the most
    // recent activity, so the thread still knows a run is in progress.
    const anchorIndex = starts.length === 1 ? starts[0] : -1;
    if (anchorIndex === -1) return out.slice(out.length - limit);

    const tailStart = out.length - (limit - 1);
    if (anchorIndex >= tailStart) return out.slice(out.length - limit);
    return [out[anchorIndex], ...out.slice(tailStart)];
  }

  return out;
}

function runStartIndices(log) {
  const indices = [];
  for (let i = 0; i < log.length; i++) {
    if (log[i] && log[i].kind === 'run_started') indices.push(i);
  }
  return indices;
}
