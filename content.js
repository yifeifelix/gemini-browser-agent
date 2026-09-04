// Unique ID counter for interactive elements
let agentIdCounter = 1;

// List for messages from background.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'GET_DOM') {
    const simplifiedDOM = simplifyDOM();
    sendResponse({ dom: simplifiedDOM });
  } else if (request.type === 'EXECUTE_ACTION') {
    const result = executeAction(request.action, request.targetId, request.value);
    sendResponse(result);
  } else if (request.type === 'GET_SELECTION') {
    const selectedText = window.getSelection ? window.getSelection().toString() : '';
    sendResponse({ selection: selectedText });
  } else if (request.type === 'SHOW_MARKERS') {
    sendResponse(showMarkers());
  } else if (request.type === 'HIDE_MARKERS') {
    sendResponse(hideMarkers());
  }
  return true; // Keep message channel open for async response
});

// Page-controlled text is interpolated into the snapshot the agent reads, so
// it must not be able to break out of its attribute or forge a whole element
// line: collapse whitespace, neutralize quotes, cap length.
function field(raw, max = 80) {
  return String(raw === null || raw === undefined ? '' : raw)
    .replace(/\s+/g, ' ')
    .replace(/"/g, "'")
    .trim()
    .substring(0, max);
}

// Checks if an element is visible to the user
function isElementVisible(el) {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  return true;
}

// Scans the DOM and serializes a clean, text-based interactive tree
function simplifyDOM() {
  const interactiveSelectors = [
    'a', 'button', 'input', 'select', 'textarea',
    '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="textbox"]',
    '[contenteditable="true"]'
  ];
  
  const elements = document.querySelectorAll(interactiveSelectors.join(','));
  let serializedElements = [];
  
  // Set window title and URL
  let output = `PAGE_TITLE: "${field(document.title, 200)}"\nPAGE_URL: "${field(window.location.href, 300)}"\n\nINTERACTIVE_ELEMENTS:\n`;
  
  elements.forEach((el) => {
    if (!isElementVisible(el)) return;
    
    // Assign or retrieve data-agent-id
    let agentId = el.getAttribute('data-agent-id');
    if (!agentId) {
      agentId = agentIdCounter.toString();
      el.setAttribute('data-agent-id', agentId);
      agentIdCounter++;
    }
    
    const tagName = el.tagName.toLowerCase();
    const type = el.getAttribute('type') || '';
    const placeholder = el.getAttribute('placeholder') || '';
    const rawValue = el.value || '';
    const name = el.getAttribute('name') || '';
    const id = el.getAttribute('id') || '';
    
    // Check if the field is sensitive (passwords, tokens, cards, emails, phones, SSNs)
    const isSensitive = 
      type === 'password' || 
      type === 'hidden' ||
      /pass|pwd|key|token|secret|card|cvv|email|phone|auth|api|code|social|ssn|secur/i.test(name) ||
      /pass|pwd|key|token|secret|card|cvv|email|phone|auth|api|code|social|ssn|secur/i.test(id) ||
      /pass|pwd|key|token|secret|card|cvv|email|phone|auth|api|code|social|ssn|secur/i.test(placeholder);
      
    const value = isSensitive && rawValue ? '[REDACTED_PII]' : rawValue;
    const textContent = field(el.textContent);
    const role = el.getAttribute('role') || '';
    const title = el.getAttribute('title') || '';
    
    // Build descriptive line
    let desc = `- `;
    if (tagName === 'input') {
      desc += `Input[type="${field(type, 20)}"] ID="${agentId}" Name="${field(name, 40)}"`;
      if (placeholder) desc += ` Placeholder="${field(placeholder)}"`;
      if (value) desc += ` Value="${field(value)}"`;
    } else if (tagName === 'textarea') {
      desc += `Textarea ID="${agentId}" Name="${field(name, 40)}"`;
      if (placeholder) desc += ` Placeholder="${field(placeholder)}"`;
      if (value) desc += ` Value="${field(value)}"`;
    } else if (tagName === 'select') {
      desc += `Select ID="${agentId}" Name="${field(name, 40)}" Value="${field(value)}" Options:`;
      const options = Array.from(el.options).map(opt => `"${field(opt.value || opt.text, 40)}"`).slice(0, 5).join(', ');
      desc += ` [${options}]`;
    } else if (tagName === 'a') {
      desc += `Link ID="${agentId}" Text="${textContent}" href="${field(el.getAttribute('href'), 120)}"`;
    } else if (tagName === 'button' || role === 'button') {
      desc += `Button ID="${agentId}" Text="${textContent}"`;
    } else {
      desc += `Element[${tagName}] ID="${agentId}" Text="${textContent}"`;
    }
    
    if (title) desc += ` Title="${field(title)}"`;
    
    serializedElements.push(desc);
  });
  
  if (serializedElements.length === 0) {
    output += "(No visible interactive elements found on the page.)";
  } else {
    output += serializedElements.join('\n');
  }
  
  return output;
}

// Executes action (click, input, pressEnter, select) on target element
function executeAction(action, targetId, value) {
  const el = document.querySelector(`[data-agent-id="${targetId}"]`);
  if (!el) {
    return { success: false, error: `Element with Agent ID "${targetId}" not found in current DOM.` };
  }
  
  try {
    el.focus();
    
    if (action === 'click') {
      // Simulate real mouse click sequence
      el.click();
      return { success: true, message: `Clicked element ID="${targetId}"` };
      
    } else if (action === 'input') {
      setElementValue(el, value);
      return { success: true, message: `Typed ${value.length} chars into element ID="${targetId}" (replacing previous content)` };
      
    } else if (action === 'pressEnter') {
      // Dispatch enter keyboard events
      const enterDown = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true });
      const enterPress = new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true });
      const enterUp = new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true });
      
      el.dispatchEvent(enterDown);
      el.dispatchEvent(enterPress);
      el.dispatchEvent(enterUp);
      
      // Fallback: if input is in a form, trigger form submit safely via requestSubmit
      if (el.form) {
        if (typeof el.form.requestSubmit === 'function') {
          el.form.requestSubmit();
        } else {
          el.form.submit();
        }
      }
      return { success: true, message: `Pressed Enter on element ID="${targetId}"` };
      
    } else if (action === 'select') {
      el.value = value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { success: true, message: `Selected value "${value}" for element ID="${targetId}"` };
    }
    
    return { success: false, error: `Unsupported action: "${action}"` };
  } catch (err) {
    return { success: false, error: `Error executing action on element ID="${targetId}": ${err.message}` };
  }
}

// Sets text on regular inputs, contenteditable hosts, and complex code
// editors (Monaco/CodeMirror) whose hidden textarea ignores direct
// .value writes. Editing-command path first (fires a real input event
// stream that editors treat as typing), direct assignment as fallback.
function setElementValue(el, value) {
  el.focus();

  // Select existing content so the insert REPLACES instead of appending
  if (el.isContentEditable) {
    document.execCommand('selectAll', false, null);
  } else if (typeof el.setSelectionRange === 'function' && typeof el.value === 'string') {
    try { el.setSelectionRange(0, el.value.length); } catch (e) { /* unsupported input types */ }
  }
  // Code editors bind Select-All on their hidden textarea's keydown
  const ctrlA = { key: 'a', code: 'KeyA', keyCode: 65, ctrlKey: true, bubbles: true };
  el.dispatchEvent(new KeyboardEvent('keydown', ctrlA));
  el.dispatchEvent(new KeyboardEvent('keyup', ctrlA));

  // Synthetic paste first: editors (Monaco/CodeMirror) insert pasted text
  // VERBATIM, while the insertText "typing" path triggers per-line
  // auto-indent that mangles already-indented code. Plain inputs ignore
  // untrusted paste events, detectable via defaultPrevented.
  try {
    const dt = new DataTransfer();
    dt.setData('text/plain', value);
    const pasteEvt = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    el.dispatchEvent(pasteEvt);
    if (pasteEvt.defaultPrevented) {
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
  } catch (e) {
    // ClipboardEvent/DataTransfer unsupported — fall through to insertText
  }

  const inserted = document.execCommand('insertText', false, value);

  if (!inserted) {
    if (el.isContentEditable) {
      el.textContent = value;
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

// ===== Set-of-Marks visual markers =====
// Draws numbered badges over interactive elements so a page screenshot
// can be visually aligned with the INTERACTIVE_ELEMENTS id list.
const MARKER_OVERLAY_ID = 'gemini-agent-marker-overlay';

function showMarkers() {
  hideMarkers();
  const overlay = document.createElement('div');
  overlay.id = MARKER_OVERLAY_ID;
  overlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;';

  document.querySelectorAll('[data-agent-id]').forEach((el) => {
    if (!isElementVisible(el)) return;
    const rect = el.getBoundingClientRect();
    // Skip elements scrolled out of the viewport — they won't be in the screenshot
    if (rect.bottom < 0 || rect.top > window.innerHeight) return;
    if (rect.right < 0 || rect.left > window.innerWidth) return;

    const badge = document.createElement('div');
    badge.textContent = el.getAttribute('data-agent-id');
    badge.style.cssText =
      'position:absolute;' +
      `top:${Math.max(rect.top - 8, 0)}px;` +
      `left:${Math.max(rect.left - 4, 0)}px;` +
      'background:#d93025;color:#ffffff;' +
      'font:bold 11px/1.4 Arial, sans-serif;' +
      'padding:0 4px;border-radius:3px;' +
      'box-shadow:0 0 0 1px #ffffff;';
    overlay.appendChild(badge);
  });

  document.body.appendChild(overlay);
  return { success: true, count: overlay.childElementCount };
}

function hideMarkers() {
  const existing = document.getElementById(MARKER_OVERLAY_ID);
  if (existing) existing.remove();
  return { success: true };
}
