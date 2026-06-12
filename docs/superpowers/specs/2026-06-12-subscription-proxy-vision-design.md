# 设计文档：订阅通道接入 + 截图视觉模式（v2.0）

日期：2026-06-12
状态：已确认（用户整体通过）

## 背景与问题

本扩展目标是对标 Claude in Chrome，供持有 Google 订阅（Google AI Pro）的家庭成员使用。当前实现存在两个根本问题：

1. **额度问题**：扩展通过 `chrome.identity` OAuth 调用 `generativelanguage.googleapis.com`（AI Studio / Generative Language API）。Google 订阅不包含该 API 的额度，实际消耗的是免费层配额，agent 循环每步发送完整 DOM + 全部历史，几轮测试即耗尽（429）。
2. **模型选择问题**：模型列表硬编码在 `sidepanel.html` 中（三个固定选项），无法选择账号实际可用的最新模型。

## 方案决策

- **订阅通道**：扩展对接本地代理 [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)（37k stars，活跃维护）。代理负责 Gemini CLI 订阅通道的 OAuth 登录、token 刷新与非官方接口适配；扩展只说标准 Gemini API 格式。
  - 已排除：扩展内直连 `cloudcode-pa.googleapis.com`（逆向接口维护成本落在自己头上）；GCP 付费 API（与「用订阅」初衷矛盾）。
- **本轮范围**：地基（订阅通道 + 动态模型列表 + token 优化）+ 截图视觉模式。多标签页、会话历史、坐标点击等留待后续阶段。

## 第 1 部分：架构调整 —— 接入本地代理

```
sidepanel ──→ background.js ──→ http://127.0.0.1:8317/v1beta/...（CLIProxyAPI）
                                        │
                                        └─→ Google 订阅通道（Gemini CLI OAuth，由代理维护）
```

- 移除 `chrome.identity` OAuth 全部逻辑；manifest 删除 `identity` 权限与 `oauth2` 段。
- `host_permissions` 改为 `http://127.0.0.1/*` 与 `http://localhost/*`，移除 `https://generativelanguage.googleapis.com/*`。
- sidepanel 新增设置区：
  - 代理地址，默认 `http://127.0.0.1:8317`
  - API Key（对应 CLIProxyAPI 配置 `api-keys` 中的值），以 `X-Goog-Api-Key` 请求头发送（已在 CLIProxyAPI 源码 `internal/access/config_access/provider.go` 中确认支持）
  - 均存入 `chrome.storage.local`
- 原「Authorize Google Account」按钮改为「连接测试」：调用一次模型列表接口验证连通性与 Key 有效性，结果显示在按钮状态上。
- README 重写为面向家庭成员的安装指南：安装 CLIProxyAPI（Windows 可选 ProxyPilot / EasyCLI 图形界面）→ 用自己的 Google 订阅账号完成一次登录 → 在代理配置中设置 API Key → 填入扩展设置。

## 第 2 部分：动态模型列表

- sidepanel 打开时调用 `GET {代理地址}/v1beta/models`，解析返回的模型清单填充下拉框。
- 记住用户上次选择（`chrome.storage.local`），若上次选择不在新列表中则回退为列表第一项。
- 拉取失败时回退到内置默认列表并在日志区显示警告，不阻塞使用。

## 第 3 部分：截图视觉模式（Set-of-Marks 混合方案）

- 每步执行前，`content.js` 为所有可交互元素绘制编号角标（编号与简化 DOM 列表中的 `targetId` 一致）。
- `chrome.tabs.captureVisibleTab` 截取带角标的可见区域截图（JPEG，质量约 65），作为 `inlineData` 图片 part，与精简 DOM 一起发给模型。
- 模型通过截图理解页面布局，但执行动作仍引用编号 `targetId`——不做坐标点击，避免脆弱性（browser-use 等项目验证过的标准做法）。
- 截图完成后立即移除角标，不残留视觉污染。
- 设置区提供「视觉模式」开关（默认开）；关闭时仅发送 DOM 文本，节省 token。
- 权限：`captureVisibleTab` 由现有 `activeTab` 授权覆盖，无需新增权限。

## 第 4 部分：Token 消耗优化

当前额度爆炸主因：`executionHistory` 中每步追加完整 DOM 且永不清理，循环后期每次请求携带全部历史 DOM。

- **历史压缩**：仅当前步保留完整 DOM 与截图；发送前将历史 user 消息中的 DOM 文本替换为 `[页面快照已省略]` 占位，移除历史图片 part，仅保留动作结果摘要与模型的 thought/action 响应。
- **DOM 字符预算**：简化 DOM 截断到固定上限（8000 字符），优先保留可交互元素列表，截断时在末尾注明。
- 保留现有 429 自动重试逻辑（读取 RetryInfo，默认 30 秒）。

## 第 5 部分：错误处理

- fetch 连接被拒（代理未运行）→ 显式提示「CLIProxyAPI 未运行，请先启动本地代理」。
- 401/403 → 提示检查扩展设置中的 API Key。
- 模型列表拉取失败 → 回退默认列表 + 日志警告，不中断。
- 其余 API 错误保持现有「显示状态码 + 响应文本」行为。

## 第 6 部分：测试

- 可测纯函数抽成独立模块（ES module，background.js 已是 `type: module`）：历史压缩、DOM 截断、URL 校验、模型列表解析。用 Node 原生 `node:test` 编写单元测试。
- 扩展集成行为使用手动验收清单：
  1. 未启动代理时启动 agent → 显示引导性错误
  2. 连接测试按钮 → 成功/失败状态正确
  3. 模型下拉框显示账号实际可用模型
  4. 在真实页面完成一个多步任务（搜索 + 阅读）
  5. 视觉模式开启时截图含编号角标且动作执行正确
  6. 长任务（10+ 步）期间请求体不随步数线性膨胀（通过日志观察）
  7. 429 触发时自动等待重试

## 不做的事（YAGNI）

- 不保留 AI Studio OAuth 后备通道。
- 不做多标签页管理、会话历史持久化、纯坐标点击。
- 不做代理的自动安装/启动（由 README 指南覆盖）。

## 安全性影响

- 原有安全机制全部保留：prompt injection 防护、PII 脱敏、高危动作强制确认、navigate 域名校验。
- 注意区分：`validateAndSanitizeAction` 中对 localhost 的拦截针对的是页面导航动作，与扩展自身调用本地代理 API 无关，二者互不影响。
- API Key 存于 `chrome.storage.local`，仅发送至用户自己配置的本地代理地址。
