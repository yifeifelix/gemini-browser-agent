// The vocabulary the agent run speaks to whatever is rendering it.
//
// Before this module the side panel reverse-engineered the run's structure
// out of English log sentences, so rewording a log broke the UI. Events carry
// the structure explicitly; prose belongs to the renderer.

export const events = {
  runStarted: (goal) => ({ kind: 'run_started', goal }),
  step: (n, of) => ({ kind: 'step', n, of }),
  status: (phase, detail = null) => ({ kind: 'status', phase, detail }),
  thought: (text) => ({ kind: 'thought', text }),
  action: (decision) => ({
    kind: 'action',
    action: decision.action,
    targetId: decision.targetId ?? null,
    value: decision.value ?? null
  }),
  note: (text, level = 'info') => ({ kind: 'note', text, level }),
  answer: (markdown) => ({ kind: 'answer', markdown }),
  runFinished: (outcome) => ({ kind: 'run_finished', outcome })
};

const OUTCOME_STATE = { done: 'done', stopped: 'done', failed: 'failed', error: 'failed' };

function newWorkCard(goal) {
  return { kind: 'work', goal, step: 0, of: 0, phase: null, phaseDetail: null, lines: [], state: 'running' };
}

/**
 * Reduces a run event log into the thread the side panel renders: user turns,
 * work cards, answers, and loose notes, in order.
 *
 * @param {ReadonlyArray<object>} log
 * @returns {Array<object>}
 */
export function toThread(log) {
  if (!Array.isArray(log)) return [];

  const thread = [];
  let card = null;

  const close = (state) => {
    if (card) {
      card.state = state;
      card = null;
    }
  };

  for (const event of log) {
    if (!event || typeof event.kind !== 'string') continue;

    switch (event.kind) {
      case 'run_started':
        close('failed'); // still open means the previous run never finished
        thread.push({ kind: 'user', text: event.goal });
        card = newWorkCard(event.goal);
        thread.push(card);
        break;

      case 'run_finished':
        close(OUTCOME_STATE[event.outcome] || 'done');
        break;

      case 'answer':
        close('done');
        thread.push({ kind: 'answer', markdown: event.markdown });
        break;

      case 'step':
        card = card || openOrphanCard(thread);
        card.step = event.n;
        card.of = event.of;
        card.lines.push(event);
        break;

      case 'status':
        card = card || openOrphanCard(thread);
        card.phase = event.phase;
        card.phaseDetail = event.detail ?? null;
        break;

      case 'thought':
      case 'action':
        card = card || openOrphanCard(thread);
        card.lines.push(event);
        break;

      case 'note':
        if (card) card.lines.push(event);
        else thread.push({ kind: 'note', text: event.text, level: event.level });
        break;

      default:
        break;
    }
  }

  return thread;
}

// A run whose run_started fell off the front of the capped log still renders
// as a work card rather than as loose lines.
function openOrphanCard(thread) {
  const card = newWorkCard(null);
  thread.push(card);
  return card;
}
