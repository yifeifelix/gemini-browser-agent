# Gemini Browser Agent v2.0 实施计划（订阅通道 + 截图视觉）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把扩展从 AI Studio OAuth 切换到本地 CLIProxyAPI 代理（用 Google 订阅额度），增加动态模型列表、Set-of-Marks 截图视觉模式，并修复 token 消耗爆炸问题。

**Architecture:** Chrome MV3 扩展（无构建系统，原生 ES modules）。background.js 是 module 型 service worker，将新增 `lib/` 目录存放可在 Node 中单元测试的纯函数模块（API 客户端解析、历史压缩）。扩展通过 `X-Goog-Api-Key` 头调用 `http://127.0.0.1:8317/v1beta/...`（CLIProxyAPI 的 Gemini 兼容端点）。

**Tech Stack:** Chrome Extension MV3、原生 JavaScript（ES modules）、Node 内置 `node:test` 做单元测试、CLIProxyAPI（外部依赖，用户自装）。

**设计文档:** `docs/superpowers/specs/2026-06-12-subscription-proxy-vision-design.md`

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `package.json` | 新建 | `npm test` 入口（`node --test tests/`） |
| `lib/history.js` | 新建 | 纯函数：DOM 截断、历史压缩（构建 API contents） |
| `lib/api-client.js` | 新建 | CLIProxyAPI 客户端：URL 规范化、模型列表解析、错误文案、fetch 封装 |
| `tests/history.test.js` | 新建 | history.js 单元测试 |
| `tests/api-client.test.js` | 新建 | api-client.js 纯函数单元测试 |
| `manifest.json` | 修改 | 删 OAuth/identity，host_permissions 改为本地代理 |
| `background.js` | 修改 | 删 OAuth；改走代理客户端；历史压缩；截图采集；LIST_MODELS 处理器 |
| `content.js` | 修改 | 新增 SHOW_MARKERS / HIDE_MARKERS 编号角标 |
| `sidepanel.html` | 修改 | 设置面板（代理地址/Key/视觉开关/连接测试）；授权按钮 → 设置按钮 |
| `sidepanel.css` | 修改 | 设置面板样式 |
| `sidepanel.js` | 修改 | 设置读写、动态模型列表、连接测试；删 OAuth 检查 |
| `README.md` | 重写 | 面向家庭成员的 CLIProxyAPI 安装与配置指南 |

**注意（Windows 环境）:** 所有命令在 PowerShell 中运行，工作目录 `D:\Projects\gemini-browser-agent`。运行测试前确认 Node ≥ 20（`node --version`）。

---

### Task 1: 测试脚手架 + DOM 截断函数（lib/history.js 之一）

**Files:**
- Create: `package.json`
- Create: `lib/history.js`
- Test: `tests/history.test.js`

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "gemini-browser-agent",
  "version": "2.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test tests/"
  }
}
```

- [ ] **Step 2: 编写失败测试（truncateDom）**

创建 `tests/history.test.js`：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { truncateDom } from '../lib/history.js';

test('truncateDom returns short strings unchanged', () => {
  const dom = 'PAGE_TITLE: "x"\nINTERACTIVE_ELEMENTS:\n- Button ID="1"';
  assert.equal(truncateDom(dom), dom);
});

test('truncateDom cuts long DOM under budget, keeps header, appends note', () => {
  const header = 'PAGE_TITLE: "x"\nPAGE_URL: "https://e.com"\n\nINTERACTIVE_ELEMENTS:';
  const lines = Array.from({ length: 500 }, (_, i) => `- Link ID="${i}" Text="item ${i}" href="/a/${i}"`);
  const dom = [header, ...lines].join('\n');
  const result = truncateDom(dom, 2000);
  assert.ok(result.length <= 2000);
  assert.ok(result.startsWith('PAGE_TITLE'));
  assert.ok(result.endsWith('truncated to save tokens)'));
});

test('truncateDom handles non-string input', () => {
  assert.equal(truncateDom(null), '');
  assert.equal(truncateDom(undefined), '');
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npm test`
Expected: FAIL — `Cannot find module ... lib/history.js`

- [ ] **Step 4: 实现 truncateDom**

创建 `lib/history.js`：

```js
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
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npm test`
Expected: PASS（3 tests）

- [ ] **Step 6: Commit**

```powershell
git add package.json lib/history.js tests/history.test.js
git commit -m "feat: add truncateDom with character budget for DOM context"
```

---

### Task 2: 历史压缩（lib/history.js 之二）

**Files:**
- Modify: `lib/history.js`
- Test: `tests/history.test.js`

内部历史条目结构（background.js 将改用此结构，不再直接存 API contents）：

```
{ role: 'user', summary: string, fullText: string, image: { mimeType, data } | null }
{ role: 'model', text: string }
```

- [ ] **Step 1: 编写失败测试（buildApiContents）**

追加到 `tests/history.test.js`：

```js
import { buildApiContents, SNAPSHOT_OMITTED_NOTE } from '../lib/history.js';

test('buildApiContents keeps full text and image only on the last user item', () => {
  const history = [
    { role: 'user', summary: 'User Goal: "buy milk"', fullText: 'User Goal: "buy milk"\n\nDOM A', image: { mimeType: 'image/jpeg', data: 'AAA' } },
    { role: 'model', text: '{"action":"click"}' },
    { role: 'user', summary: 'Result of last action: Success.', fullText: 'Result of last action: Success.\n\nDOM B', image: { mimeType: 'image/jpeg', data: 'BBB' } }
  ];
  const contents = buildApiContents(history);

  assert.equal(contents.length, 3);
  // Older user message: collapsed to summary + note, no DOM text, no image part
  assert.equal(contents[0].role, 'user');
  assert.equal(contents[0].parts.length, 1);
  assert.ok(contents[0].parts[0].text.includes('User Goal: "buy milk"'));
  assert.ok(contents[0].parts[0].text.includes(SNAPSHOT_OMITTED_NOTE));
  assert.ok(!contents[0].parts[0].text.includes('DOM A'));
  // Model message: passthrough
  assert.deepEqual(contents[1], { role: 'model', parts: [{ text: '{"action":"click"}' }] });
  // Last user message: full DOM + image
  assert.equal(contents[2].parts[0].text, 'Result of last action: Success.\n\nDOM B');
  assert.deepEqual(contents[2].parts[1], { inlineData: { mimeType: 'image/jpeg', data: 'BBB' } });
});

test('buildApiContents omits image part when last user item has no image', () => {
  const history = [{ role: 'user', summary: 's', fullText: 'full', image: null }];
  const contents = buildApiContents(history);
  assert.equal(contents[0].parts.length, 1);
  assert.equal(contents[0].parts[0].text, 'full');
});

test('buildApiContents returns empty array for empty history', () => {
  assert.deepEqual(buildApiContents([]), []);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL — `buildApiContents is not a function`（或 named export 不存在）

- [ ] **Step 3: 实现 buildApiContents**

追加到 `lib/history.js`：

```js
// Builds Gemini API `contents` from internal history items.
// Only the LAST user item keeps its full DOM text and screenshot;
// earlier user items collapse to their one-line summary. This is the
// core fix for runaway token usage (previously every step re-sent
// every prior DOM).
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test`
Expected: PASS（6 tests）

- [ ] **Step 5: Commit**

```powershell
git add lib/history.js tests/history.test.js
git commit -m "feat: add buildApiContents history compaction (only last step keeps DOM/screenshot)"
```

---

### Task 3: 代理 API 客户端（lib/api-client.js）

**Files:**
- Create: `lib/api-client.js`
- Test: `tests/api-client.test.js`

- [ ] **Step 1: 编写失败测试（纯函数部分）**

创建 `tests/api-client.test.js`：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeBaseUrl,
  parseModelList,
  describeApiError,
  DEFAULT_PROXY_URL
} from '../lib/api-client.js';

test('normalizeBaseUrl strips trailing slashes and whitespace', () => {
  assert.equal(normalizeBaseUrl('http://127.0.0.1:8317/'), 'http://127.0.0.1:8317');
  assert.equal(normalizeBaseUrl('  http://localhost:9000  '), 'http://localhost:9000');
});

test('normalizeBaseUrl falls back to default for empty input', () => {
  assert.equal(normalizeBaseUrl(''), DEFAULT_PROXY_URL);
  assert.equal(normalizeBaseUrl(undefined), DEFAULT_PROXY_URL);
});

test('parseModelList maps models/ prefixed names to ids', () => {
  const json = {
    models: [
      { name: 'models/gemini-3.1-pro', displayName: 'Gemini 3.1 Pro' },
      { name: 'models/gemini-2.5-flash' },
      { bogus: true }
    ]
  };
  assert.deepEqual(parseModelList(json), [
    { id: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro' },
    { id: 'gemini-2.5-flash', label: 'gemini-2.5-flash' }
  ]);
});

test('parseModelList tolerates malformed payloads', () => {
  assert.deepEqual(parseModelList(null), []);
  assert.deepEqual(parseModelList({}), []);
  assert.deepEqual(parseModelList({ models: 'nope' }), []);
});

test('describeApiError gives actionable messages', () => {
  assert.match(describeApiError('network', 'http://127.0.0.1:8317'), /CLIProxyAPI is running/);
  assert.match(describeApiError(401, 'x'), /API Key/);
  assert.match(describeApiError(403, 'x'), /API Key/);
  assert.equal(describeApiError(500, 'x'), null);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL — `Cannot find module ... lib/api-client.js`

- [ ] **Step 3: 实现 api-client.js**

创建 `lib/api-client.js`：

```js
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test`
Expected: PASS（11 tests）

- [ ] **Step 5: Commit**

```powershell
git add lib/api-client.js tests/api-client.test.js
git commit -m "feat: add CLIProxyAPI client with model list parsing and friendly errors"
```

---

### Task 4: manifest 权限调整

**Files:**
- Modify: `manifest.json`

- [ ] **Step 1: 重写 manifest.json**

完整替换为：

```json
{
  "manifest_version": 3,
  "name": "Gemini Browser Agent",
  "version": "2.0.0",
  "description": "An agentic browser assistant powered by your Google subscription via a local CLIProxyAPI proxy.",
  "permissions": [
    "activeTab",
    "scripting",
    "storage",
    "sidePanel",
    "tabs",
    "contextMenus"
  ],
  "host_permissions": [
    "http://127.0.0.1/*",
    "http://localhost/*"
  ],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "side_panel": {
    "default_path": "sidepanel.html"
  },
  "action": {
    "default_title": "Open Gemini Browser Agent"
  }
}
```

变更点：删除 `identity` 权限、删除整个 `oauth2` 段、`host_permissions` 从 `generativelanguage.googleapis.com` 改为本地代理两个地址、版本号升到 2.0.0。

- [ ] **Step 2: JSON 语法校验**

Run: `node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('manifest OK')"`
Expected: `manifest OK`

- [ ] **Step 3: Commit**

```powershell
git add manifest.json
git commit -m "feat: replace AI Studio OAuth permissions with local proxy host permissions"
```

---

### Task 5: 设置面板 UI（HTML + CSS + 存储读写）

**Files:**
- Modify: `sidepanel.html`（header 按钮区 32-37 行附近；header 之后插入设置面板）
- Modify: `sidepanel.css`（末尾追加）
- Modify: `sidepanel.js`（顶部元素引用 + DOMContentLoaded + 新增事件）

- [ ] **Step 1: 替换授权按钮为设置按钮**

在 `sidepanel.html` 中，将整个 Authorize 按钮块（`<!-- Authorize Button -->` 到对应 `</button>`，约 31-37 行）替换为：

```html
        <!-- Settings Button -->
        <button id="settings-btn" class="header-icon-btn" title="Settings">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
          </svg>
        </button>
```

- [ ] **Step 2: 在 `</header>` 之后、`<main class="chat-area">` 之前插入设置面板**

```html
    <!-- Settings Panel (collapsible) -->
    <div id="settings-panel" class="settings-panel hidden">
      <label class="settings-label">Proxy URL
        <input id="proxy-url-input" type="text" placeholder="http://127.0.0.1:8317">
      </label>
      <label class="settings-label">API Key
        <input id="api-key-input" type="password" placeholder="CLIProxyAPI api-key">
      </label>
      <label class="settings-toggle">
        <input id="vision-toggle" type="checkbox" checked>
        Vision mode (send page screenshot)
      </label>
      <div class="settings-actions">
        <button id="test-connection-btn" class="test-connection-btn">Test Connection</button>
        <span id="connection-status" class="connection-status"></span>
      </div>
    </div>
```

- [ ] **Step 3: 在 `sidepanel.css` 末尾追加样式**

```css
/* ===== Settings Panel ===== */
.settings-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid rgba(128, 128, 128, 0.25);
  background: rgba(128, 128, 128, 0.06);
  font-size: 0.78rem;
}
.settings-panel.hidden { display: none; }
.settings-label { display: flex; flex-direction: column; gap: 3px; }
.settings-label input {
  padding: 5px 8px;
  border: 1px solid rgba(128, 128, 128, 0.4);
  border-radius: 6px;
  font-size: 0.78rem;
  background: inherit;
  color: inherit;
}
.settings-toggle { display: flex; align-items: center; gap: 6px; cursor: pointer; }
.settings-actions { display: flex; align-items: center; gap: 8px; }
.test-connection-btn {
  padding: 5px 12px;
  border: none;
  border-radius: 6px;
  background: #1a73e8;
  color: #fff;
  cursor: pointer;
  font-size: 0.78rem;
}
.test-connection-btn:hover { background: #1765c8; }
.connection-status { font-size: 0.72rem; }
.connection-status.ok { color: #188038; }
.connection-status.fail { color: #d93025; }
```

- [ ] **Step 4: sidepanel.js 接线**

(a) 删除第 9 行 `const authBtn = document.getElementById('auth-btn');`，替换为：

```js
// Settings Elements
const settingsBtn = document.getElementById('settings-btn');
const settingsPanel = document.getElementById('settings-panel');
const proxyUrlInput = document.getElementById('proxy-url-input');
const apiKeyInput = document.getElementById('api-key-input');
const visionToggle = document.getElementById('vision-toggle');
const testConnectionBtn = document.getElementById('test-connection-btn');
const connectionStatus = document.getElementById('connection-status');
```

(b) 删除原 155-158 行的 Authorization Button 监听（`authBtn.addEventListener` 块）和原 338-351 行的整个 `checkOAuthStatus` 函数；删除 DOMContentLoaded 中的 `checkOAuthStatus(false); // Silent check` 一行。

(c) 在 DOMContentLoaded 的 `chrome.storage.local.get` 调用中，把键数组改为 `['selectedModel', 'actionMode', 'proxyUrl', 'apiKey', 'visionMode']`，并在回调内追加：

```js
    if (items.proxyUrl) proxyUrlInput.value = items.proxyUrl;
    if (items.apiKey) apiKeyInput.value = items.apiKey;
    visionToggle.checked = items.visionMode !== false; // default on
```

(d) 在 `updateActionMode` 函数之前添加设置事件：

```js
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
```

（连接测试按钮的逻辑在 Task 7 接线，本任务先放占位空监听不需要——什么都不加。）

- [ ] **Step 5: 手动验证**

在 `chrome://extensions/` 点击扩展卡片的重新加载，打开侧边栏：
1. 齿轮按钮可展开/收起设置面板
2. 填写 Proxy URL / API Key 后关闭再打开侧边栏，值保留
3. DevTools（侧边栏右键 → 检查）Console 无报错

- [ ] **Step 6: Commit**

```powershell
git add sidepanel.html sidepanel.css sidepanel.js
git commit -m "feat: add settings panel (proxy URL, API key, vision toggle) replacing OAuth button"
```

---

### Task 6: background.js 切换到代理通道 + 历史压缩

**Files:**
- Modify: `background.js`

- [ ] **Step 1: 顶部加 import，删除 OAuth 函数**

文件第 1 行之前添加：

```js
import { listModels, generateContent, describeApiError, normalizeBaseUrl, DEFAULT_PROXY_URL } from './lib/api-client.js';
import { truncateDom, buildApiContents } from './lib/history.js';
```

删除原 151-162 行的整个 `getAuthToken` 函数，替换为：

```js
// Loads proxy connection settings saved by the sidepanel
function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['proxyUrl', 'apiKey', 'visionMode'], (items) => {
      resolve({
        proxyUrl: normalizeBaseUrl(items.proxyUrl || DEFAULT_PROXY_URL),
        apiKey: items.apiKey || '',
        visionMode: items.visionMode !== false
      });
    });
  });
}
```

- [ ] **Step 2: 替换消息处理器中的 CHECK_AUTH**

将 `chrome.runtime.onMessage` 监听器中的 `CHECK_AUTH` 分支（原 180-184 行）替换为：

```js
  } else if (request.type === 'LIST_MODELS') {
    getSettings()
      .then((settings) => listModels(settings.proxyUrl, settings.apiKey))
      .then((models) => sendResponse({ success: true, models }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true; // async response
```

- [ ] **Step 3: 改造 startAgentLoop 开头**

将原 227-230 行的 token 获取：

```js
    const token = await getAuthToken(false).catch(() => {
      throw new Error("Google account not authorized. Please click 'Authorize Google Account' first.");
    });
```

替换为：

```js
    const settings = await getSettings();
    if (!settings.apiKey) {
      addLog('[System Warning] No API key configured. If your CLIProxyAPI requires api-keys, open Settings and set one.', 'system-log');
    }
```

- [ ] **Step 4: 改造历史写入（原 256-273 行）**

将 prompt 构造与 `executionHistory.push({ role: "user", parts: ... })` 整段替换为：

```js
      // 3. Build internal history entry (full DOM only for current step)
      const trimmedDom = truncateDom(domContext);
      let selectionContext = '';
      if (activeSelection && currentStep === 1) {
        selectionContext = `[Webpage Selected Text Context]\n"${activeSelection}"\n\n`;
      }

      const summary = currentStep === 1
        ? `User Goal: "${userGoal}"`
        : `Result of last action: ${lastActionResult}`;
      const fullText = currentStep === 1
        ? `${selectionContext}User Goal: "${userGoal}"\n\nInitial Web Page DOM:\n${trimmedDom}`
        : `Result of last action: ${lastActionResult}\n\nCurrent Web Page DOM:\n${trimmedDom}`;

      executionHistory.push({ role: 'user', summary, fullText, image: null });
```

（`image: null` 在 Task 9 接入截图后被实际值替换。）

- [ ] **Step 5: 改造 API 调用（原 277-340 行的 fetch 重试循环）**

将 `while (retries < maxRetries ...)` 循环内的 `response = await fetch(...)` 整个调用替换为：

```js
        response = await generateContent(settings.proxyUrl, settings.apiKey, activeModel, {
          contents: buildApiContents(executionHistory),
          generationConfig: {
            responseMimeType: "application/json",
            maxOutputTokens: 1024,
            responseSchema: {
              type: "OBJECT",
              properties: {
                thought: { type: "STRING" },
                action: {
                  type: "STRING",
                  enum: ["click", "input", "pressEnter", "select", "navigate", "done", "fail"]
                },
                targetId: { type: "STRING", nullable: true },
                value: { type: "STRING", nullable: true },
                finalAnswer: { type: "STRING", nullable: true }
              },
              required: ["thought", "action", "targetId", "value", "finalAnswer"]
            }
          },
          systemInstruction: {
            parts: [{ text: SYSTEM_INSTRUCTIONS }]
          }
        });
```

429 重试逻辑（`if (response.status === 429) {...}`）保持原样不动。

将 `if (!response.ok)` 块（原 342-345 行）替换为：

```js
      if (!response.ok) {
        const friendly = describeApiError(response.status, settings.proxyUrl);
        const errorText = await response.text();
        throw new Error(friendly || `Gemini API Error (${response.status}): ${errorText}`);
      }
```

- [ ] **Step 6: 改造模型响应写入（原 350-354 行）**

将 `executionHistory.push({ role: "model", parts: [{ text: responseText }] });` 替换为：

```js
      executionHistory.push({ role: 'model', text: responseText });
```

- [ ] **Step 7: 运行单元测试（防回归）**

Run: `npm test`
Expected: PASS（11 tests，lib 模块未被破坏）

- [ ] **Step 8: 手动验证**

重新加载扩展。**不启动** CLIProxyAPI 的情况下：
1. 侧边栏发送任意目标 → 日志应显示 `Cannot reach the local proxy at http://127.0.0.1:8317. Make sure CLIProxyAPI is running.`（而非裸 fetch 错误）
2. `chrome://extensions/` 中扩展无 service worker 报错（点击「service worker」链接查看 Console）

若已有 CLIProxyAPI 可用：启动代理、配置 API Key 后发送一个简单目标（如「打开 youtube」），确认 agent 正常响应。

- [ ] **Step 9: Commit**

```powershell
git add background.js
git commit -m "feat: route agent loop through local CLIProxyAPI with compacted history"
```

---

### Task 7: 动态模型列表 + 连接测试（sidepanel.js）

**Files:**
- Modify: `sidepanel.js`
- Modify: `sidepanel.html`（model-select 默认选项）

- [ ] **Step 1: 更新 sidepanel.html 默认模型选项**

将 `<select id="model-select">` 内三个 option 替换为（作为离线回退项）：

```html
            <option value="gemini-2.5-flash" selected>Gemini 2.5 Flash (offline default)</option>
            <option value="gemini-2.5-pro">Gemini 2.5 Pro (offline default)</option>
```

- [ ] **Step 2: sidepanel.js 添加模型列表逻辑**

在 `saveSettings` 函数之后添加：

```js
// Fallback used when the proxy is unreachable at panel-open time
const DEFAULT_MODELS = [
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (offline default)' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (offline default)' }
];

function setConnectionStatus(text, ok) {
  connectionStatus.textContent = text;
  connectionStatus.className = `connection-status ${ok ? 'ok' : 'fail'}`;
}

function populateModelSelect(models, savedModel) {
  modelSelect.innerHTML = '';
  models.forEach((m) => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.label;
    modelSelect.appendChild(opt);
  });
  if (savedModel && models.some((m) => m.id === savedModel)) {
    modelSelect.value = savedModel;
  } else {
    chrome.storage.local.set({ selectedModel: modelSelect.value });
  }
}

function refreshModelList(showStatus) {
  chrome.runtime.sendMessage({ type: 'LIST_MODELS' }, (response) => {
    chrome.storage.local.get(['selectedModel'], (items) => {
      if (response && response.success && response.models.length > 0) {
        populateModelSelect(response.models, items.selectedModel);
        if (showStatus) setConnectionStatus(`Connected — ${response.models.length} models available`, true);
      } else {
        populateModelSelect(DEFAULT_MODELS, items.selectedModel);
        const error = (response && response.error) || 'Empty model list from proxy.';
        appendLog(`[System Warning] Could not load model list (${error}). Using offline defaults.`, 'error-log');
        if (showStatus) setConnectionStatus(error, false);
      }
    });
  });
}

testConnectionBtn.addEventListener('click', () => {
  saveSettings();
  setConnectionStatus('Testing…', true);
  refreshModelList(true);
});
```

- [ ] **Step 3: DOMContentLoaded 调用刷新**

在 DOMContentLoaded 内删除原 31-39 行的 `selectedModel` option-exists 检查块（`populateModelSelect` 已处理保存的选择），在 `chrome.storage.local.get` 回调末尾追加一行：

```js
    refreshModelList(false);
```

- [ ] **Step 4: 手动验证**

重新加载扩展：
1. 代理未运行：下拉框显示 2 个 offline default 项，聊天区出现黄色/红色警告日志
2. 「Test Connection」按钮 → 状态文本变红显示连接错误
3. 代理运行 + Key 正确（若可用）：「Test Connection」→ 绿色 `Connected — N models available`，下拉框列出真实模型
4. 选择一个模型，关闭重开侧边栏 → 选择保留

- [ ] **Step 5: Commit**

```powershell
git add sidepanel.js sidepanel.html
git commit -m "feat: dynamic model list from proxy with offline fallback and connection test"
```

---

### Task 8: Set-of-Marks 编号角标（content.js）

**Files:**
- Modify: `content.js`

- [ ] **Step 1: 添加消息分支**

在 `chrome.runtime.onMessage` 监听器（原 5-17 行）中追加两个分支：

```js
  } else if (request.type === 'SHOW_MARKERS') {
    sendResponse(showMarkers());
  } else if (request.type === 'HIDE_MARKERS') {
    sendResponse(hideMarkers());
```

- [ ] **Step 2: 实现 showMarkers / hideMarkers**

在文件末尾追加：

```js
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
```

- [ ] **Step 3: 手动验证**

重新加载扩展，打开任意普通网页（如 Wikipedia），先用侧边栏跑一次任务（让 content.js 注入并分配 data-agent-id）并停止。在页面 DevTools Console 确认元素已编号：

```js
document.querySelectorAll('[data-agent-id]').length  // 应 > 0
```

然后在扩展 service worker 的 DevTools Console（chrome://extensions → 该扩展 → 「service worker」链接）执行：

```js
const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
await chrome.tabs.sendMessage(tab.id, { type: 'SHOW_MARKERS' });  // 页面出现红色编号角标
await chrome.tabs.sendMessage(tab.id, { type: 'HIDE_MARKERS' });  // 角标消失
```

- [ ] **Step 4: Commit**

```powershell
git add content.js
git commit -m "feat: add set-of-marks numbered badges for screenshot vision mode"
```

---

### Task 9: 截图采集接入（background.js 视觉模式）

**Files:**
- Modify: `background.js`

- [ ] **Step 1: 更新系统提示词**

在 `SYSTEM_INSTRUCTIONS` 模板字符串的 `SECURITY DIRECTIVE` 段之前插入：

```
VISION:
You may receive a screenshot of the current page along with the DOM. In the screenshot, interactive elements are tagged with small red numbered badges. Badge numbers match the ID values in the INTERACTIVE_ELEMENTS list. Use the screenshot to understand page layout, visual state, and content, but always act through element IDs from INTERACTIVE_ELEMENTS — never invent IDs that are not in the list.
```

- [ ] **Step 2: 添加截图函数**

在 `getPageDOM` 函数之后添加：

```js
// Captures a JPEG screenshot of the visible tab with numbered markers drawn.
// Returns { mimeType, data } (base64 without the data: prefix) or null on failure.
async function captureScreenshot(tabId, windowId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'SHOW_MARKERS' });
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 65 });
    return { mimeType: 'image/jpeg', data: dataUrl.split(',')[1] };
  } catch (err) {
    addLog(`[System Warning] Screenshot failed (${err.message}). Continuing with DOM only.`, 'system-log');
    return null;
  } finally {
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'HIDE_MARKERS' });
    } catch (e) {
      // Content script gone (navigation) — markers are gone with the page
    }
  }
}
```

- [ ] **Step 3: 在循环中采集截图**

在 `startAgentLoop` 中，DOM 获取的 try/catch 块需要一个可达性标记。将：

```js
      let domContext = "";
      try {
        domContext = await getPageDOM(activeTab.id);
      } catch (err) {
```

改为：

```js
      let domContext = "";
      let domAccessible = true;
      try {
        domContext = await getPageDOM(activeTab.id);
      } catch (err) {
        domAccessible = false;
```

（catch 块其余内容不变。）

然后将 Task 6 写入的 `executionHistory.push({ role: 'user', summary, fullText, image: null });` 替换为：

```js
      let screenshot = null;
      if (settings.visionMode && domAccessible) {
        screenshot = await captureScreenshot(activeTab.id, activeTab.windowId);
      }

      executionHistory.push({ role: 'user', summary, fullText, image: screenshot });
```

- [ ] **Step 4: 运行单元测试（防回归）**

Run: `npm test`
Expected: PASS（11 tests）

- [ ] **Step 5: 手动验证**

重新加载扩展（需要 CLIProxyAPI 运行）：
1. 设置中开启 Vision mode，在内容页（如 Wikipedia）下达目标「描述这个页面的布局」→ 模型回答应体现视觉信息
2. 任务执行瞬间页面短暂闪现红色编号角标随即消失
3. 关闭 Vision mode → 正常纯 DOM 流程，无截图日志

- [ ] **Step 6: Commit**

```powershell
git add background.js
git commit -m "feat: capture set-of-marks screenshots in vision mode"
```

---

### Task 10: README 重写

**Files:**
- Modify: `README.md`（完整替换）

- [ ] **Step 1: 完整替换 README.md**

```markdown
# Gemini Browser Agent（订阅版）

把 Google Gemini 变成浏览器自动化助手的 Chrome 扩展，对标 Claude in Chrome 的体验。
**直接使用你的 Google 订阅（Google AI Pro 等）额度**，无需 API Key 计费——通过本地
[CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) 代理将订阅通道转换为标准 Gemini API。

## 工作原理

```
扩展侧边栏 → background.js → http://127.0.0.1:8317（CLIProxyAPI）→ Google 订阅通道
```

扩展只和本机代理通信；登录 Google、刷新凭证、订阅额度调度全部由 CLIProxyAPI 处理。

## 安装步骤

### 第 1 步：安装并配置 CLIProxyAPI（每台电脑一次）

1. 从 [CLIProxyAPI Releases](https://github.com/router-for-me/CLIProxyAPI/releases) 下载对应系统版本并解压。
   - Windows 用户也可选择带图形界面的 [ProxyPilot](https://github.com/Finesssee/ProxyPilot) 或 [EasyCLI](https://github.com/router-for-me/EasyCLI)。
2. 编辑 `config.yaml`：在 `api-keys:` 下添加一个自定义密钥（例如 `my-family-key-2026`），其余保持默认（端口 8317）。
3. 启动代理，按提示用 **Gemini 登录**（`--login` 参数或 GUI 内登录），用你自己的 Google 订阅账号完成 OAuth。
4. 保持代理在后台运行（可配置开机自启）。

### 第 2 步：安装扩展

1. Chrome 打开 `chrome://extensions/`，开启右上角「开发者模式」。
2. 点击「加载已解压的扩展程序」，选择本项目文件夹。
3. 把扩展固定到工具栏。

### 第 3 步：连接

1. 点击扩展图标打开侧边栏，点击右上角 ⚙️ 设置按钮。
2. Proxy URL 保持 `http://127.0.0.1:8317`，API Key 填第 1 步在 `config.yaml` 里设置的值。
3. 点击 **Test Connection**——显示绿色 `Connected` 即成功，顶部模型下拉框会列出你账号实际可用的模型。

## 使用

1. 打开要操作的网页（`chrome://` 内部页面和应用商店除外）。
2. 在侧边栏输入目标，例如「搜索 DeepMind 并告诉我第一段内容」。
3. 观察 agent 思考 → 行动 → 汇报。随时可点停止。

- **Vision mode**（设置中，默认开）：每步附带页面截图（带红色编号角标），模型能「看见」页面布局。token 消耗更高但理解力更强。
- **Action Mode**：`Ask before acting` 每步确认 / `Act without asking` 自动执行（高危操作仍会强制确认）。

## 安全机制

- **最小权限**：使用 `activeTab`，仅在你主动使用扩展时访问当前标签页。
- **Prompt 注入防护**：网页内容被严格视为数据；系统提示词明确禁止执行页面中嵌入的指令。
- **PII 脱敏**：密码、卡号、邮箱等敏感字段值在发送前替换为 `[REDACTED_PII]`。
- **高危操作拦截**：支付/删除/登录/提交类按钮即使在自动模式下也强制人工确认；所有页面跳转需确认，禁止访问内网地址。
- **本地通信**：API Key 仅发送到你自己配置的本机代理，不经过任何第三方服务器。

## 开发

```powershell
npm test   # 运行 lib/ 纯函数单元测试（Node >= 20）
```

## 故障排查

| 现象 | 处理 |
|------|------|
| `Cannot reach the local proxy` | 确认 CLIProxyAPI 正在运行、端口 8317 未被占用 |
| `HTTP 401/403` | 扩展设置中的 API Key 与代理 `config.yaml` 的 `api-keys` 不一致 |
| 模型列表只有 offline default | 点 Test Connection 重试；检查代理是否完成 Google 登录 |
| 429 限流 | 扩展会自动等待重试；频繁出现说明订阅额度耗尽，等待额度窗口刷新 |
```

- [ ] **Step 2: Commit**

```powershell
git add README.md
git commit -m "docs: rewrite README for CLIProxyAPI subscription setup"
```

---

### Task 11: 最终验证（单元测试 + 手动验收清单）

**Files:** 无新文件

- [ ] **Step 1: 全量单元测试**

Run: `npm test`
Expected: PASS（11 tests, 0 failures）

- [ ] **Step 2: 静态完整性检查**

Run: `node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('OK')"`
Expected: `OK`

确认无 OAuth 残留：

Run（PowerShell）: `Select-String -Path background.js,sidepanel.js,manifest.json -Pattern 'getAuthToken|identity|oauth2|CHECK_AUTH|generativelanguage'`
Expected: 无输出（零匹配）

- [ ] **Step 3: 手动验收清单（对应设计文档第 6 部分）**

在 Chrome 中重新加载扩展后逐项执行，全部通过才算完成：

1. [ ] 未启动代理时启动 agent → 日志显示「Cannot reach the local proxy…」引导性错误
2. [ ] Test Connection 按钮：代理未运行 → 红色错误；运行且 Key 正确 → 绿色 Connected
3. [ ] 模型下拉框显示账号实际可用模型（非硬编码三项）
4. [ ] 在真实页面完成一个多步任务（如 Wikipedia 搜索 + 阅读首段）
5. [ ] Vision mode 开启时任务执行中页面闪现编号角标，模型表现出视觉理解
6. [ ] 跑一个 10+ 步任务，打开 service worker DevTools → Network，确认请求体大小不随步数线性膨胀
7. [ ] 触发 429 时日志显示自动等待重试（订阅额度内不易触发，可跳过并注明）

- [ ] **Step 4: 最终提交**

```powershell
git add -A
git commit -m "chore: v2.0 final verification pass"
```

---

## 验收标准汇总

- `npm test` 全绿（11 个单元测试）
- 扩展不再包含任何 `chrome.identity` / `oauth2` / `generativelanguage.googleapis.com` 引用
- 手动验收清单 7 项全部通过（429 项可注明跳过）
