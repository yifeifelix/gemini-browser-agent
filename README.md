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
