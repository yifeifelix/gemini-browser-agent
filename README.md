# Gemini Browser Agent

A Manifest V3 Chrome extension that turns Google Gemini into an agentic browser assistant — built to match the Claude in Chrome experience while running directly on your **Google subscription quota (Google AI Pro, etc.)** without per-token API billing. It bridges subscription accounts via a local [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) proxy, provides Set-of-Marks visual grounding, and executes autonomous multi-step DOM automation with strict safety guardrails.

It supports:

- Running directly on Google One / Google AI Pro subscription quotas via local CLIProxyAPI, or switching to Google AI Studio API keys on the fly
- Set-of-Marks (SoM) visual grounding: draws numbered badges on interactive DOM elements and captures JPEG viewport screenshots so Gemini can visually inspect layout and spatial context
- Sliding-window context compression: caps DOM snapshots at an 8,000-character budget and collapses prior turns to one-line summaries to eliminate token budget explosion
- High-fidelity editor input: writes code directly into Monaco (e.g. LeetCode) and CodeMirror instances via page MAIN-world API injection and synthetic clipboard paste events, preserving indentation and bypassing event isolation
- Cookie & GDPR overlay management: automatically identifies and declines consent overlays ("Reject all" / "Decline") before proceeding with the user's task
- Comprehensive safety guardrails: prompt injection defense, automatic PII redaction (passwords, cards, tokens, emails), RFC1918 private network blocking, and mandatory approval for high-risk operations (payment, deletion, login)
- Zero-build architecture: pure Manifest V3 ES modules, native CSS, and Node native `node:test` suite with zero runtime npm dependencies

## Core advantages

| Advantage | Practical value |
|---|---|
| Subscription-first quota routing | Calls standard Gemini API endpoints via a local CLIProxyAPI instance, consuming existing Google AI Pro subscription quotas instead of metered AI Studio API billing or fragile free-tier limits. |
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
Local Proxy (CLIProxyAPI on 127.0.0.1:8317)  ◄── OR ──► Google AI Studio API
     │ (Gemini CLI OAuth Session)
     ▼
Google Subscription Quota (Google AI Pro, etc.)
```

1. **Side Panel**: Collects user goals, handles settings, surfaces active DOM selection, and manages step-by-step human confirmation.
2. **Background Orchestrator**: Runs the ReAct agent loop (up to 15 steps per task), manages model conversation history, enforces safety filters, handles 429 backoff retries, and coordinates actions.
3. **Content Script**: Scans visible interactive elements, redacts sensitive PII, projects Set-of-Marks numbered badges for screenshots, and executes simulated DOM actions.
4. **Local Proxy**: Translates standard Gemini API calls into authenticated requests using your Google subscription OAuth session.

## Install

### Step 1: Set up CLIProxyAPI (Once per machine)

1. Download the latest binary from [CLIProxyAPI Releases](https://github.com/router-for-me/CLIProxyAPI/releases/latest) (on Windows, choose `CLIProxyAPI_x.y.z_windows_amd64.zip`, or GUI tools like [ProxyPilot](https://github.com/Finesssee/ProxyPilot) / [EasyCLI](https://github.com/router-for-me/EasyCLI)).
2. Edit `config.yaml`: Add a custom key under `api-keys:` (e.g. `my-local-secret-key`), keeping the default port `8317`.
3. Start the proxy and complete the Google login prompt (`--login` flag or GUI button) using your Google subscription account.
4. Keep the proxy running in the background.

#### Alternative: Direct Google AI Studio API Key

If you prefer not to run a local proxy, you can connect directly to Google's official endpoints (note: this uses API tier quotas, not subscription quotas):

1. Obtain an API Key from [Google AI Studio](https://aistudio.google.com/apikey).
2. In the extension settings: set **Proxy URL** to `https://generativelanguage.googleapis.com` and paste your **API Key**.
3. Click **Test Connection** to fetch models directly.

### Step 2: Install the Chrome Extension

1. Open Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** in the top-right corner.
3. Click **Load unpacked** and select this repository folder.
4. Pin **Gemini Browser Agent** to your Chrome toolbar.

### Step 3: Connect & Test

1. Click the extension icon in your toolbar to open the side panel.
2. Click the ⚙️ **Settings** button in the top-right corner of the panel.
3. Confirm **Proxy URL** is set to `http://127.0.0.1:8317` and enter the key configured in `config.yaml`.
4. Click **Test Connection** — a green `Connected` badge confirms connectivity, and the model dropdown will populate with available models.

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
- **Local-only credential transport**: API credentials are stored in Chrome extension local storage and communicated exclusively to your configured local proxy address.

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
- **Proxy uptime dependency**: Running via subscription quota requires CLIProxyAPI to remain active on `http://127.0.0.1:8317`.
- **Restricted browser pages**: Chrome security policy prevents content script injection into `chrome://`, `chrome-extension://`, and the Chrome Web Store.
- **Interactive challenges**: CAPTCHAs, Cloudflare turnstiles, and biometric 2FA prompts require manual human completion.

## Contributors

Fei ([@yifeifelix](https://github.com/yifeifelix))

## Licence

[MIT](LICENSE)
