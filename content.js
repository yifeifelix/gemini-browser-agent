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
  }
  return true; // Keep message channel open for async response
});

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
  let output = `PAGE_TITLE: "${document.title}"\nPAGE_URL: "${window.location.href}"\n\nINTERACTIVE_ELEMENTS:\n`;
  
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
    const textContent = (el.textContent || '').trim().replace(/\s+/g, ' ').substring(0, 80);
    const role = el.getAttribute('role') || '';
    const title = el.getAttribute('title') || '';
    
    // Build descriptive line
    let desc = `- `;
    if (tagName === 'input') {
      desc += `Input[type="${type}"] ID="${agentId}" Name="${name}"`;
      if (placeholder) desc += ` Placeholder="${placeholder}"`;
      if (value) desc += ` Value="${value}"`;
    } else if (tagName === 'textarea') {
      desc += `Textarea ID="${agentId}" Name="${name}"`;
      if (placeholder) desc += ` Placeholder="${placeholder}"`;
      if (value) desc += ` Value="${value}"`;
    } else if (tagName === 'select') {
      desc += `Select ID="${agentId}" Name="${name}" Value="${value}" Options:`;
      const options = Array.from(el.options).map(opt => `"${opt.value || opt.text}"`).slice(0, 5).join(', ');
      desc += ` [${options}]`;
    } else if (tagName === 'a') {
      desc += `Link ID="${agentId}" Text="${textContent}" href="${el.getAttribute('href') || ''}"`;
    } else if (tagName === 'button' || role === 'button') {
      desc += `Button ID="${agentId}" Text="${textContent}"`;
    } else {
      desc += `Element[${tagName}] ID="${agentId}" Text="${textContent}"`;
    }
    
    if (title) desc += ` Title="${title}"`;
    
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
      el.value = value;
      // Dispatch standard input/change events for JS frameworks
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { success: true, message: `Typed "${value}" into element ID="${targetId}"` };
      
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
