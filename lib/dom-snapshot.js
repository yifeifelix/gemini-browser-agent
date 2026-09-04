// Reads the simplified DOM snapshot that content.js serializes.
//
// The agent's targetId comes from the model, which is steered by untrusted
// page content, so it is never compiled into a RegExp. Lookups compare the
// id token a line declares for itself against the target, which also stops
// one element's Text="…" from impersonating another element's ID.

// Matches the id an element declares for itself: the first ID="…" on its line.
const OWN_ID = /ID="([^"]*)"/;

// Every element line declaring this id, without the "- " bullet.
//
// Page-controlled attributes (placeholder, name, title, href, value) are
// interpolated into the snapshot, so a page that smuggles a newline can forge
// an extra line claiming an id it does not own. More than one match therefore
// means the id is contested and no line can be trusted to describe it.
function findElementLines(dom, targetId) {
  if (typeof dom !== 'string' || !dom || targetId === null || targetId === undefined) {
    return [];
  }
  const wanted = String(targetId);
  const found = [];

  for (const line of dom.split('\n')) {
    if (!line.startsWith('- ')) continue;
    const match = OWN_ID.exec(line);
    if (match && match[1] === wanted) {
      found.push(line.slice(2));
    }
  }
  return found;
}

/**
 * The snapshot line describing an element, for confirmation prompts.
 *
 * @param {string} dom simplified DOM snapshot
 * @param {string|null} targetId id the model asked to act on
 * @returns {string|null}
 */
export function findElementDescription(dom, targetId) {
  const lines = findElementLines(dom, targetId);
  return lines.length === 1 ? lines[0] : null;
}

// Labels that suggest submitting, deleting, paying, or authenticating.
const HIGH_RISK = /pay|buy|purchase|delete|remove|destroy|terminate|authorize|login|signin|sign-in|sign-up|signup|transfer|confirm|submit|checkout/i;

/**
 * Whether acting on this element warrants a manual confirmation, judged from
 * the target element's own snapshot line and nothing else.
 *
 * @param {string} dom simplified DOM snapshot
 * @param {{ targetId?: string|null }} decision
 * @returns {boolean}
 */
export function isCriticalAction(dom, decision) {
  const targetId = decision && decision.targetId;
  if (!targetId) return false;

  const lines = findElementLines(dom, targetId);
  // A contested id means the snapshot cannot say what will be clicked, so it
  // is escalated rather than waved through on the forgery's benign label.
  if (lines.length > 1) return true;
  return lines.length === 1 && HIGH_RISK.test(lines[0]);
}
