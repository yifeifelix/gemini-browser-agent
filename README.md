# Gemini Browser Agent

A Manifest V3 Chrome extension that turns Google Gemini into an agentic browser assistant — built to match the Claude in Chrome experience, using **your own Google AI Studio API key** (bring-your-own-key) with no proxy to run. It provides Set-of-Marks visual grounding and executes autonomous multi-step DOM automation with strict safety guardrails.

It supports:

- Bring-your-own-key: connects straight to the official Gemini API with your Google AI Studio key (default model `gemini-3.8-flash` with thinking level `low`)
- Set-of-Marks (SoM) visual grounding: draws numbered badges on interactive DOM elements and captures JPEG viewport screenshots so Gemini can visually inspect layout and spatial context
- Sliding-window context compression: caps DOM snapshots at an 8,000-character budget and collapses prior turns to one-line summaries to eliminate token budget explosion
- High-fidelity editor input: writes code directly into Monaco (e.g. LeetCode) and CodeMirror instances via page MAIN-world API injection and synthetic clipboard paste events, preserving indentation and bypassing event isolation
- Cookie & GDPR overlay management: automatically identifies and declines consent overlays ("Reject all" / "Decline") before proceeding with the user's task
- Comprehensive safety guardrails: prompt injection defense, automatic PII redaction (passwords, cards, tokens, emails), RFC1918 private network blocking, and mandatory approval for high-risk operations (payment, deletion, login)
- Zero-build architecture: pure Manifest V3 ES modules, native CSS, and Node native `node:test` suite with zero runtime npm dependencies

## Core advantages

| Advantage | Practical value |
|---|---|
| Bring-your-own-key | Calls the official Gemini API with your own AI Studio key. No proxy needed; free-tier daily quota exhaustion is detected and stops the task with a clear message instead of retrying. |
| Set-of-Marks visual + structural hybrid execution | Viewport screenshots with numbered badges give Gemini spatial awareness, while actions execute strictly against verified element IDs from the simplified DOM tree — eliminating fragile coordinate-based clicking. |
| Sliding-window context compression | Only the active step sends the full DOM snapshot and screenshot. Prior user turns collapse into single-line summaries, preventing context window bloat and runaway token consumption over 10+ step runs. |
| Editor-aware input engine | Bypasses browser isolated-world restrictions to invoke `window.monaco.editor` directly from the page MAIN world and fires synthetic paste events to prevent auto-indent mangling. |
| Self-healing response parsing | When model output is truncated by token limits or emits invalid JSON, the runtime intercepts the failure, reports the issue back into context, and prompts targeted self-healing rather than aborting. |
| Zero-build, zero-dependency stack | No Webpack, Vite, or external dependencies. Runs directly as native browser ES modules, testable offline with Node's built-in `node:test`. |

## What it changes

| Default browser agent behaviour | With Gemini Browser Agent |
|---|---|
| Re-sends full DOM tree and images on every step | Collapses prior DOM snapshots to summaries; only active step retains full DOM & image |
| Hardcodes a static model dropdown | Dynamically queries `/v1beta/models` on startup to surface account-specific models |
| Mangled code or ignored input in complex code editors | Uses page MAIN-world API injection (`window.monaco`) and clipboard paste dispatch |
| Blind coordinate clicking | Set-of-Marks numbered badges mapped to DOM element IDs |
| Stalls on GDPR/cookie popups | Dedicated prompt directive mandates immediate "Reject all" / "Decline" before executing user goals |
| Aborts run on JSON parsing error | Traps truncation or malformed JSON, retains minimal stub, and asks Gemini to correct its output |
| Allows internal intranet navigation | Blocks `localhost`, `127.0.0.1`, and private RFC1918 IPv4 ranges (10.x, 172.16-31.x, 192.168.x) |

## Architecture

```text
Extension Side Panel UI (sidepanel.js)
           │
           ▼
Service Worker (background.js) ──► ReAct Loop (max 15 steps)
     │            │
     │            ├─► Content Script (content.js)
     │            │    ├─ DOM simplification & PII redaction
     │            │    ├─ Set-of-Marks visual badges overlay
     │            │    └─ Native / MAIN-world action dispatch
     │            │
     ▼            └─► HTTP POST /v1beta/models/{model}:generateContent
Gemini API (generativelanguage.googleapis.com, your AI Studio key)
```

1. **Side Panel**: Collects user goals, handles settings, surfaces active DOM selection, and manages step-by-step human confirmation.
2. **Background Orchestrator**: Runs the ReAct agent loop (up to 15 steps per task), manages model conversation history, enforces safety filters, handles 429 backoff retries, and coordinates actions.
3. **Content Script**: Scans visible interactive elements, redacts sensitive PII, projects Set-of-Marks numbered badges for screenshots, and executes simulated DOM actions.
4. **Gemini API**: The official Google endpoint, authenticated with the API key you paste into the side panel.

## Install

### Step 1: Get a Google AI Studio API key

1. Open [Google AI Studio](https://aistudio.google.com/apikey) and sign in.
2. Click **Create API key** and copy it.

Quota and billing depend on the settings of the Google project the key belongs to; a project without billing enabled only uses the free tier.

**Data sent to Google:** each task sends your task description, any selected text, the current page's DOM content and, when Vision mode is on, a screenshot of the page to the Google Gemini API. On the free tier, Google may use this data to improve its products.

### Step 2: Install the Chrome Extension

1. Open Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** in the top-right corner.
3. Click **Load unpacked** and select this repository folder.
4. Pin **Gemini Browser Agent** to your Chrome toolbar.

### Step 3: Connect & Test

1. Click the extension icon in your toolbar to open the side panel.
2. On first run a setup card appears: click **Open Google AI Studio** if you still need a key, paste it, and click **Connect**. The key is checked immediately by fetching the model list.
3. The model dropdown fills from the API and defaults to `gemini-3.8-flash`. You can change the key later under ⚙️ **Settings** and re-check it with **Test Connection**.

## Use

1. Navigate to any webpage you want to automate (excluding restricted `chrome://` internal pages and the Chrome Web Store).
2. Enter your goal in the side panel (e.g. *"Search GitHub for fast text extractors and summarize the top three results"*).
3. Watch the agent think, execute actions, and stream responses. You can click **Stop** at any point.

### Modes & Controls

- **Vision Mode** (enabled by default in Settings): Takes a viewport screenshot with Set-of-Marks numbered badges on each step. Enables spatial layout understanding for visual interfaces.
- **Action Mode**:
  - `Ask before acting`: Prompts for user confirmation before executing any click, input, or navigation step.
  - `Act without asking`: Executes autonomously until completion or failure. High-risk operations still force manual confirmation.
- **Selection Context**: Highlight any text on the page and right-click to select **"Send selection to Gemini Agent"** to attach the text directly into the agent's context.

## Safety & security

- **Prompt injection defense**: Webpage DOM elements and text are strictly treated as untrusted data. The system prompt forbids executing instructions embedded in webpage content.
- **Automatic PII redaction**: Passwords, authentication tokens, API keys, credit cards, emails, phone numbers, and SSNs are masked with `[REDACTED_PII]` before sending DOM trees to the model.
- **High-risk action guardrails**: Operations matching destructive or transactional keywords (`pay`, `buy`, `delete`, `remove`, `login`, `signin`, `transfer`, `checkout`) force manual approval, even in autonomous mode.
- **Navigation sanitization**: Enforces HTTPS for external navigation and blocks navigation to `localhost`, loopbacks (`127.0.0.1`), and RFC1918 private subnets (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`).
- **Credential handling**: API credentials are stored in Chrome extension local storage and sent only to Google's Gemini API (`generativelanguage.googleapis.com`).

## Development

Run unit tests using Node's built-in test runner (Node >= 20):

```bash
npm test
```

## Repository layout

```text
manifest.json                   Manifest V3 extension configuration
background.js                   Service worker orchestrating the ReAct agent loop
content.js                      Injected script for DOM simplification, SoM badges & action dispatch
sidepanel.html                  Side panel markup and settings view
sidepanel.js                    Side panel controller, state synchronization & UI events
sidepanel.css                   Styles for chat thread, badges, settings, and confirmation cards
lib/api-client.js               Gemini REST client, model list parser & connection error handler
lib/history.js                  Sliding-window history compression & DOM character truncation
lib/markdown.js                 Sanitized, escape-first Markdown renderer for assistant answers
tests/api-client.test.js        Unit tests for API endpoint normalization and error handling
tests/history.test.js           Unit tests for DOM truncation and history compaction
tests/markdown.test.js          Unit tests for Markdown parsing and XSS prevention
docs/superpowers/               Detailed architecture specifications and implementation plans
package.json                    Test script runner definition
LICENSE                         MIT License
```

## Limits

- **Single active tab scope**: Automation operates strictly on the active tab of the current window. Cross-tab workflows are not supported.
- **Viewport-bounded Set-of-Marks**: Badges are generated only for interactive elements visible within the current viewport; elements requiring scrolling are tagged once scrolled into view.
- **Free-tier quota**: Requests are limited per minute and per day. Per-minute limits are retried automatically; when the daily quota is used up the task stops, and it resets at midnight Pacific Time.
- **Restricted browser pages**: Chrome security policy prevents content script injection into `chrome://`, `chrome-extension://`, and the Chrome Web Store.
- **Interactive challenges**: CAPTCHAs, Cloudflare turnstiles, and biometric 2FA prompts require manual human completion.

## Contributors

Fei ([@yifeifelix](https://github.com/yifeifelix))

## Licence

[MIT](LICENSE)
