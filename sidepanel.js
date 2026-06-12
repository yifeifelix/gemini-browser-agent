// UI Elements
const chatContainer = document.getElementById('chat-container');
const goalInput = document.getElementById('goal-input');
const sendBtn = document.getElementById('send-btn');
const sendIcon = document.getElementById('send-icon');
const stopIcon = document.getElementById('stop-icon');
const modelSelect = document.getElementById('model-select');
const newChatBtn = document.getElementById('new-chat-btn');

// Settings Elements
const settingsBtn = document.getElementById('settings-btn');
const settingsPanel = document.getElementById('settings-panel');
const proxyUrlInput = document.getElementById('proxy-url-input');
const apiKeyInput = document.getElementById('api-key-input');
const visionToggle = document.getElementById('vision-toggle');
const testConnectionBtn = document.getElementById('test-connection-btn');
const connectionStatus = document.getElementById('connection-status');

// Selection Elements
const selectionBadge = document.getElementById('selection-badge');
const selectionTextPreview = document.getElementById('selection-text-preview');
const clearSelectionBtn = document.getElementById('clear-selection-btn');

// Action Mode Dropdown Elements
const actionModeTrigger = document.getElementById('action-mode-trigger');
const actionModeIcon = document.getElementById('action-mode-icon');
const actionModeText = document.getElementById('action-mode-text');
const actionModeMenu = document.getElementById('action-mode-menu');

// Global state variables
let currentSelection = '';
let currentMode = 'ask'; // 'ask' or 'auto'
let currentAgentState = 'idle';

// Initialize Panel
document.addEventListener('DOMContentLoaded', async () => {
  // Load saved configurations from storage
  chrome.storage.local.get(['selectedModel', 'actionMode', 'proxyUrl', 'apiKey', 'visionMode'], (items) => {
    if (items.actionMode) {
      updateActionMode(items.actionMode);
    }
    if (items.proxyUrl) proxyUrlInput.value = items.proxyUrl;
    if (items.apiKey) apiKeyInput.value = items.apiKey;
    visionToggle.checked = items.visionMode !== false; // default on
  });

  // Sync UI state with background script
  chrome.runtime.sendMessage({ type: 'GET_STATE' }, (response) => {
    if (response) {
      currentAgentState = response.state;
      updateUIState(response.state);
      restoreLogsAsChat(response.logs);
      if (response.selection) {
        showSelectionBadge(response.selection);
      }
      if (response.pendingConfirmation) {
        renderConfirmationCard(response.pendingConfirmation);
      }
    }
  });

  // Start polling webpage selection
  setInterval(pollSelection, 1000);
});

// Settings panel toggle + persistence
settingsBtn.addEventListener('click', () => {
  settingsPanel.classList.toggle('hidden');
});

function saveSettings() {
  chrome.storage.local.set({
    proxyUrl: proxyUrlInput.value.trim(),
    apiKey: apiKeyInput.value.trim(),
    visionMode: visionToggle.checked
  });
}
proxyUrlInput.addEventListener('change', saveSettings);
apiKeyInput.addEventListener('change', saveSettings);
visionToggle.addEventListener('change', saveSettings);

// Model selection change
modelSelect.addEventListener('change', () => {
  chrome.storage.local.set({ selectedModel: modelSelect.value });
  appendLog(`[System] Model changed to: ${modelSelect.options[modelSelect.selectedIndex].text}`, 'system-log');
});

// Toggle Action Mode Dropdown Menu
actionModeTrigger.addEventListener('click', (e) => {
  e.stopPropagation();
  actionModeMenu.classList.toggle('hidden');
});

// Close Action Mode Menu when clicking outside
document.addEventListener('click', () => {
  actionModeMenu.classList.add('hidden');
});

// Action Mode Option Click
document.querySelectorAll('.action-mode-option').forEach(option => {
  option.addEventListener('click', (e) => {
    e.stopPropagation();
    const mode = option.getAttribute('data-mode');
    updateActionMode(mode);
    chrome.storage.local.set({ actionMode: mode });
    actionModeMenu.classList.add('hidden');
  });
});

function updateActionMode(mode) {
  currentMode = mode;
  if (mode === 'ask') {
    actionModeIcon.textContent = '✋';
    actionModeText.textContent = 'Ask before acting';
    appendLog('[System] Action Mode: Ask before acting.', 'system-log');
  } else {
    actionModeIcon.textContent = '🚀';
    actionModeText.textContent = 'Act without asking';
    appendLog('[System] Action Mode: Act without asking (Automatic).', 'system-log');
  }
}

// Polling text selection from current tab
async function pollSelection() {
  try {
    const tabs = await new Promise(resolve => chrome.tabs.query({ active: true, lastFocusedWindow: true }, resolve));
    if (tabs.length > 0 && tabs[0].id) {
      const tabId = tabs[0].id;
      chrome.tabs.sendMessage(tabId, { type: 'GET_SELECTION' }, (response) => {
        if (chrome.runtime.lastError || !response) {
          // Content script is likely not injected. Dynamically inject it.
          chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['content.js']
          }).catch(() => {
            // Ignore scripting restrictions on system URLs
          });
          return;
        }
        if (response.selection && response.selection.trim()) {
          showSelectionBadge(response.selection);
        }
      });
    }
  } catch (err) {
    // Ignore activeTab scripting constraint errors
  }
}

function showSelectionBadge(text) {
  currentSelection = text.trim();
  selectionTextPreview.textContent = `Selection attached (${currentSelection.length} chars): "${currentSelection.substring(0, 30)}..."`;
  selectionBadge.classList.remove('hidden');
}

clearSelectionBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  currentSelection = '';
  selectionBadge.classList.add('hidden');
  chrome.runtime.sendMessage({ type: 'CLEAR_SELECTION' });
  appendLog('[System] Page selection detached.', 'system-log');
});

// New Chat / Clear Screen
newChatBtn.addEventListener('click', () => {
  chatContainer.innerHTML = '';
  appendChatMessage('assistant', 'Hello! I am your Antigravity Gemini Browser Agent. Ask me a question about this page, or enter a goal for me to automate.');
  chrome.runtime.sendMessage({ type: 'CLEAR_LOGS' });
  appendLog('[System] Chat history cleared.', 'system-log');
});

// Textarea auto-height adjustment
goalInput.addEventListener('input', () => {
  goalInput.style.height = 'auto';
  goalInput.style.height = (goalInput.scrollHeight) + 'px';
});

// Handle enter key to send, shift+enter to newline
goalInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault(); // Prevent standard enter key behavior (newline)
    sendBtn.click(); // Trigger send button
  }
});

// Send/Stop Button Click
sendBtn.addEventListener('click', () => {
  if (currentAgentState === 'active' || currentAgentState === 'waiting') {
    // Stop Button Mode
    chrome.runtime.sendMessage({ type: 'STOP_AGENT' }, () => {
      appendLog('[System] Agent stopped by user.', 'system-log');
    });
  } else {
    // Send Button Mode
    const promptText = goalInput.value.trim();
    if (!promptText) return;
    
    // Add user message to UI
    let fullUserMsg = promptText;
    if (currentSelection) {
      fullUserMsg += `\n[Selected Context: "${currentSelection}"]`;
    }
    appendChatMessage('user', fullUserMsg);
    
    // Send execution trigger to background.js
    chrome.runtime.sendMessage({ 
      type: 'START_AGENT', 
      goal: promptText, 
      selection: currentSelection,
      model: modelSelect.value,
      mode: currentMode
    }, (response) => {
      if (response && response.error) {
        appendLog(`[System Error] ${response.error}`, 'error-log');
      }
    });

    // Reset inputs
    goalInput.value = '';
    goalInput.style.height = 'auto';
    currentSelection = '';
    selectionBadge.classList.add('hidden');
  }
});

// Listen to Messages from background.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'LOG_ADDED') {
    handleIncomingLog(message.text, message.logType);
  } else if (message.type === 'STATE_CHANGED') {
    currentAgentState = message.state;
    updateUIState(message.state);
  } else if (message.type === 'CONFIRMATION_REQUIRED') {
    renderConfirmationCard(message.decision);
  } else if (message.type === 'SELECTION_UPDATED') {
    showSelectionBadge(message.selection);
  }
});

// Parse background logs and render as clean Chat UI elements
function handleIncomingLog(text, type) {
  if (type === 'user-log') {
    // Already appended locally by user click
    return;
  }
  
  if (type === 'thought-log') {
    // Append thought card
    appendThoughtCard(text);
  } else if (type === 'success-log') {
    if (text.startsWith('[AI Final Answer]')) {
      const answer = text.replace('[AI Final Answer]', '').trim();
      appendChatMessage('assistant', answer);
    } else {
      appendSystemLog(text, 'success');
    }
  } else if (type === 'error-log') {
    appendSystemLog(text, 'error');
  } else if (type === 'action-log') {
    appendSystemLog(text, 'action');
  } else {
    appendSystemLog(text, 'system');
  }
}

function restoreLogsAsChat(logs) {
  chatContainer.innerHTML = '';
  // Initial Greeting
  appendChatMessage('assistant', 'Hello! I am your Antigravity Gemini Browser Agent. Ask me a question about this page, or enter a goal for me to automate.');
  
  logs.forEach(log => {
    if (log.type === 'user-log') {
      const uMsg = log.text.replace('[User Goal]', '').trim();
      appendChatMessage('user', uMsg);
    } else {
      handleIncomingLog(log.text, log.type);
    }
  });
}

// Chat UI Appenders
function appendChatMessage(sender, text) {
  const msgDiv = document.createElement('div');
  msgDiv.className = `chat-message ${sender}`;
  
  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';
  
  const p = document.createElement('p');
  p.textContent = text;
  
  contentDiv.appendChild(p);
  msgDiv.appendChild(contentDiv);
  chatContainer.appendChild(msgDiv);
  scrollChatToBottom();
}

function appendThoughtCard(text) {
  const card = document.createElement('div');
  card.className = 'thought-card';
  
  const header = document.createElement('div');
  header.className = 'thought-header';
  header.textContent = 'Thought Process';
  
  const body = document.createElement('div');
  body.className = 'thought-body';
  body.textContent = text;
  
  card.appendChild(header);
  card.appendChild(body);
  chatContainer.appendChild(card);
  scrollChatToBottom();
}

function appendSystemLog(text, category) {
  const logDiv = document.createElement('div');
  logDiv.className = `log-line ${category}`;
  logDiv.style.fontFamily = "Consolas, monospace";
  logDiv.style.fontSize = "0.7rem";
  logDiv.style.margin = "2px 0 2px 10px";
  logDiv.textContent = text;
  
  chatContainer.appendChild(logDiv);
  scrollChatToBottom();
}

function appendLog(text, type = 'system-log') {
  handleIncomingLog(text, type);
}

function scrollChatToBottom() {
  const chatArea = document.querySelector('.chat-area');
  chatArea.scrollTop = chatArea.scrollHeight;
}

// Sidepanel states updates
function updateUIState(state) {
  if (state === 'idle') {
    sendIcon.classList.remove('hidden');
    stopIcon.classList.add('hidden');
    sendBtn.disabled = false;
  } else {
    sendIcon.classList.add('hidden');
    stopIcon.classList.remove('hidden');
    sendBtn.disabled = false; // Always allow stop click
  }
}

// Confirmation Card
function renderConfirmationCard(decision) {
  if (document.querySelector('.confirmation-card:not(.approved):not(.rejected)')) {
    return;
  }

  const card = document.createElement('div');
  card.className = 'log-line confirmation-card';
  
  const msg = document.createElement('div');
  msg.className = 'confirm-msg';
  
  let actionText = '';
  if (decision.action === 'click') {
    actionText = `Click element ID="${decision.targetId}"`;
  } else if (decision.action === 'input') {
    actionText = `Type "${decision.value}" into element ID="${decision.targetId}"`;
  } else if (decision.action === 'pressEnter') {
    actionText = `Press Enter on element ID="${decision.targetId}"`;
  } else if (decision.action === 'select') {
    actionText = `Select "${decision.value}" on element ID="${decision.targetId}"`;
  } else if (decision.action === 'navigate') {
    actionText = `Navigate to URL: "${decision.value}"`;
  }
  
  msg.textContent = `🚨 Safety Confirmation:\nAI wants to: ${actionText}`;
  card.appendChild(msg);
  
  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'confirm-actions';
  
  const approveBtn = document.createElement('button');
  approveBtn.className = 'confirm-btn confirm-approve';
  approveBtn.textContent = 'Approve';
  
  const rejectBtn = document.createElement('button');
  rejectBtn.className = 'confirm-btn confirm-reject';
  rejectBtn.textContent = 'Reject';
  
  actionsDiv.appendChild(approveBtn);
  actionsDiv.appendChild(rejectBtn);
  card.appendChild(actionsDiv);
  
  approveBtn.addEventListener('click', () => {
    approveBtn.disabled = true;
    rejectBtn.disabled = true;
    card.classList.add('approved');
    msg.textContent = `✅ Approved: ${actionText}`;
    actionsDiv.remove();
    chrome.runtime.sendMessage({ type: 'CONFIRM_RESPONSE', approved: true });
  });
  
  rejectBtn.addEventListener('click', () => {
    approveBtn.disabled = true;
    rejectBtn.disabled = true;
    card.classList.add('rejected');
    msg.textContent = `❌ Rejected: ${actionText}`;
    actionsDiv.remove();
    chrome.runtime.sendMessage({ type: 'CONFIRM_RESPONSE', approved: false });
  });
  
  chatContainer.appendChild(card);
  scrollChatToBottom();
}
