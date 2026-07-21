# Antigravity Session Archiver (`antigravity-session-archiver`)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node Version](https://img.shields.io/badge/Node.js-22%2B-green.svg)](https://nodejs.org/)
[![Platform: Windows](https://img.shields.io/badge/Platform-Windows-blue.svg)](#)
[![Status: Active](https://img.shields.io/badge/Status-Active-brightgreen.svg)](#)

> ⭐ 如果这个工具帮到了你，欢迎点个 Star 让更多 Antigravity 用户看到。

[中文说明](#中文说明) | [English Documentation](#english-documentation)

> ⚠️ **Disclaimer**: This is an unofficial, community-driven project. It is not affiliated with, endorsed by, or sponsored by Google. "Antigravity" is a trademark of Google LLC. Use at your own risk. The project only modifies the local Electron client and calls the official Language Server API — it does not distribute modified binaries, does not bypass any security control, and does not upload any user data.

---

<a name="中文说明"></a>
## 💡 中文说明

**Antigravity Session Archiver** 解决了 Google Antigravity 2.0 客户端的一个真实 UX 痛点：**会话归档后无法恢复**。

官方客户端虽然有"归档"按钮，但归档后会话从侧边栏消失，而恢复入口要么被数据源过滤掉、要么需要先打开已归档会话才能看到——形成了"鸡生蛋"的困境。本工具通过调用官方 Language Server 的 gRPC-Web API，将归档会话**真正恢复**至侧边栏活跃列表。

### ✨ 核心亮点

1. **🔄 真恢复至官方侧栏（非假恢复）**：
   - 直接调用官方 Language Server 的 `UpdateConversationAnnotations` API，将 `annotations.archived` 设为 `false`。
   - 会话真实重新出现在 Antigravity 侧边栏的活跃列表里，而非仅复制上下文到输入框。
   - 乐观更新策略：恢复成功后直接修改本地状态，避免 streaming RPC 时序问题导致的空列表。

2. **📡 官方 API 数据源，零猜测**：
   - 通过 `JetboxSubscribeToSummaries` 流式 API 获取全部会话（含已归档），字段完整：标题、项目、时间、步数、子代理标记等全部来自 LS 真实响应。

3. **🔍 会话详情面板**：
   - 每条会话可展开查看完整元数据：创建/修改/最后输入时间、步数、状态、分支、Git 仓库、项目路径、Trajectory 类型、父会话 ID、摘要等。
   - 用户大概率会遗忘某个归档会话做了什么，详情面板帮助快速识别。

4. **🤖 子代理会话区分**：
   - 自动识别子代理会话（通过 `trajectoryMetadata.subagentSpec` / `parentConversationId` 字段），默认隐藏，可通过复选框显示。
   - 避免子代理会话与主会话混杂在列表中干扰视线。

5. **🌐 中英双语界面**：
   - 一键切换中文/英文，所有 UI 文案、时间格式、错误提示均完整本地化。

6. **📦 嵌入官方侧边栏**：
   - 注入到 Antigravity 原生侧边栏，作为"📦 Archived Sessions"入口，点击弹出归档恢复面板。

7. **🔌 动态端口探测**：
   - 自动扫描 CDP 端口附近的 LS HTTP 端口（不再硬编码 `CDP+1`），适配不同 Antigravity 版本的端口分配策略。
   - 端口缓存 + 失效自动重试，保证跨重启稳定工作。

8. **🛡️ 安全合规**：
   - 使用与官方 UI 完全相同的请求方式（含 `x-codeium-csrf-token`），不绕过任何安全控制。
   - 所有数据读写仅在本机 127.0.0.1，不上传任何用户数据。
   - 提供一键卸载，完整还原官方原版客户端。

9. **⚡ 零依赖、低开销**：
   - 纯 Node.js 22+ 内置 `fetch`，无 npm 依赖。
   - 2 秒内存缓存，避免重复请求 LS。

---

### 🔧 工作原理

1. **获取 CDP 端口**：读取 `~/AppData/Roaming/Antigravity/DevToolsActivePort` 第一行（Electron 启动时写入）。
2. **动态探测 LS 端口**：LS HTTP 端口不再固定为 `CDP+1`（新版客户端可能为 `CDP+3` 或其他偏移）。在 CDP 附近扫描候选端口 `[+1, +3, +2, +4, +5, +6, +7, +8, +0]`，第一个返回 200 且包含 `"csrfToken"` 的端口即为 LS。成功后缓存，失效自动重试。
3. **获取 CSRF Token**：`GET https://127.0.0.1:<lsPort>/` 解析 `window.__APP_CONFIG__.csrfToken`（每次 LS 重启都会变，所以每次请求都实时获取）。
4. **列出会话**：`POST /exa.language_server_pb.LanguageServerService/JetboxSubscribeToSummaries`，body `{}`，读取第一个 gRPC-Web 帧即包含全部会话（含 `annotations.archived` 字段）。
5. **恢复会话**：`POST /exa.language_server_pb.LanguageServerService/UpdateConversationAnnotations`，body `{cascadeId, annotations:{archived:false}, mergeAnnotations:true}`。
6. **请求头**：`Content-Type: application/grpc-web+json` + `X-Grpc-Web: 1` + `x-codeium-csrf-token: <token>`（缺 CSRF token 时 LS 会静默丢弃请求）。
7. **TLS**：LS 使用自签证书服务 127.0.0.1，需禁用 TLS 校验（`NODE_TLS_REJECT_UNAUTHORIZED=0`）。

---

### 🚀 使用方法

```bash
# 1. 安装：随 Antigravity 客户端自动启动，侧边栏会出现 📦 Archived Sessions 入口
node scripts/inject.js --install

# 2. 重启 Antigravity 客户端（让 preload.js 注入生效）

# 3. 使用：打开 Antigravity，点击侧边栏的 📦 Archived Sessions
#    - "已归档" tab 列出所有被归档的会话
#    - 点击会话标题可展开详情面板
#    - 点击"↺ 恢复至侧栏"按钮，立即在本地标记为已恢复
#    - 刷新侧边栏（切换项目或重开窗口），会话重新出现在活跃列表
#    - 可勾选"含子代理会话"查看子代理，可切换中/英界面

# 4. 卸载：还原官方原版客户端
node scripts/inject.js --uninstall
```

> **前提**：使用本工具时 Antigravity 客户端必须处于运行状态（Language Server 需在线）。

---

### 🔄 官方软件更新流程

由于修改了 `app.asar`，自动更新检测会被暂时屏蔽。**当官方发布新版本时**：

```bash
# 1. 还原官方原版客户端（接收官方更新）
node scripts/inject.js --uninstall

# 2. 启动 Antigravity 完成官方升级

# 3. 升级完成后重新注入
node scripts/inject.js --install
```

> 🛡️ **数据安全**：会话数据由 Language Server 独立存储在 `~/.gemini/antigravity/`。注入、卸载、升级均不会影响你的会话历史与归档标记。

---

### 🐛 已知问题与解决

| 现象 | 原因 | 解决 |
|---|---|---|
| 进入面板显示 "fetch failed" | LS 端口偏移随版本变化 | 已改为动态端口探测，自动适配 |
| 恢复一个会话后列表变空 | streaming RPC 时序问题，立即重拉拿到不完整数据 | 已改为乐观更新，本地直接改 archived 字段 |
| 重新打开 modal 显示旧状态 | iframe 相同 src 不触发重载 | 已改为 `about:blank` → targetUrl 强制重载 |
| 列表全是条杠无内容 | iframe 内 `height: 100vh` 不生效 + flex 压缩 | 已改为 `height: 100%` + `flex-shrink: 0` |
| 数量与官方侧栏对不上 | 包含了子代理会话 | 默认隐藏子代理，可勾选显示 |

---

<a name="english-documentation"></a>
## 🌍 English Documentation

**Antigravity Session Archiver** solves a real UX pain point in Google Antigravity 2.0: **archived sessions cannot be restored** through the official UI. Although the official client has an Archive button, archived sessions vanish from the sidebar, and all restore entry points are either filtered out by the data source or require opening the archived session first — a chicken-and-egg trap. This tool calls the official Language Server gRPC-Web API to **truly restore** archived sessions back to the sidebar's active list.

### ✨ Key Highlights

1. **🔄 True Restoration (not fake)**: Calls the official `UpdateConversationAnnotations` API to set `annotations.archived = false`. Sessions genuinely reappear in the Antigravity sidebar — not just clipboard injection. Optimistic update avoids streaming-RPC timing issues.
2. **📡 Official API data source**: Fetches all sessions (including archived) via `JetboxSubscribeToSummaries` streaming API. Every field comes directly from the LS response.
3. **🔍 Detail panel**: Expand any session to see full metadata — created/modified/last-input time, step count, status, branch, Git repo, project path, trajectory type, parent session ID, summary, etc.
4. **🤖 Subagent filtering**: Auto-detects subagent sessions (`subagentSpec` / `parentConversationId`) and hides them by default; toggle via checkbox to avoid clutter.
5. **🌐 Bilingual UI (ZH/EN)**: One-click language switch with full localization of all UI text, time formats, and error messages.
6. **📦 Embedded in official sidebar**: Injects as a "📦 Archived Sessions" entry in Antigravity's native sidebar.
7. **🔌 Dynamic port probing**: Auto-scans around the CDP port to find the LS HTTP port — no more hardcoded `CDP+1`. Cached on success, auto-retries on failure.
8. **🛡️ Safe & compliant**: Uses the exact same request method as the official UI (including `x-codeium-csrf-token`), does not bypass any security control, does not upload user data. One-click uninstall restores the stock client.
9. **⚡ Zero dependencies**: Pure Node.js 22+ built-in `fetch`. 2-second in-memory cache.

---

### 🔧 How It Works

1. **CDP port**: read from `~/AppData/Roaming/Antigravity/DevToolsActivePort` (written by Electron on startup).
2. **Dynamic LS port probing**: The LS HTTP port is NOT a fixed offset from CDP — newer builds use `CDP+3` or other offsets. We probe candidates `[+1, +3, +2, +4, +5, +6, +7, +8, +0]` and return the first port whose HTTPS index page contains a `csrfToken`. Cached on success, auto-retried on failure.
3. **CSRF token**: `GET https://127.0.0.1:<lsPort>/` and parse `window.__APP_CONFIG__.csrfToken` (changes on every LS restart, fetched fresh per request).
4. **List sessions**: `POST /exa.language_server_pb.LanguageServerService/JetboxSubscribeToSummaries` with body `{}`; the first gRPC-Web frame contains all sessions with `annotations.archived` field.
5. **Restore session**: `POST /exa.language_server_pb.LanguageServerService/UpdateConversationAnnotations` with body `{cascadeId, annotations:{archived:false}, mergeAnnotations:true}`.
6. **Headers**: `Content-Type: application/grpc-web+json` + `X-Grpc-Web: 1` + `x-codeium-csrf-token: <token>` (without CSRF token, LS silently drops the request).
7. **TLS**: LS serves 127.0.0.1 with a self-signed cert; TLS verification is disabled (`NODE_TLS_REJECT_UNAUTHORIZED=0`).

---

### 🚀 Usage

```bash
# Install: auto-starts with Antigravity, adds 📦 Archived Sessions entry to sidebar
node scripts/inject.js --install

# Restart Antigravity client (so preload.js injection takes effect)

# Use: open Antigravity, click 📦 Archived Sessions in sidebar
#   - "Archived" tab lists all archived sessions
#   - Click session title to expand detail panel
#   - Click "↺ Restore to Sidebar" — instantly marked restored locally
#   - Refresh sidebar (switch project or reopen window), session reappears in active list
#   - Toggle "Include subagents" checkbox, switch ZH/EN interface

# Uninstall: restore stock client
node scripts/inject.js --uninstall
```

> **Prerequisite**: Antigravity client must be running (Language Server must be online) while using this tool.

---

### 🔄 Official Software Update Workflow

Modifying `app.asar` temporarily disables auto-update detection. **When an official update is released**:

```bash
# 1. Restore stock client (to receive official update)
node scripts/inject.js --uninstall

# 2. Launch Antigravity and complete the official update

# 3. Re-inject after update
node scripts/inject.js --install
```

> 🛡️ **Data Safety**: Session data is stored independently by Language Server under `~/.gemini/antigravity/`. Injection, uninstallation, and upgrades never affect your session history or archive flags.

---

### 🐛 Known Issues & Fixes

| Symptom | Cause | Fix |
|---|---|---|
| Panel shows "fetch failed" | LS port offset varies across versions | Dynamic port probing, auto-adapts |
| List goes empty after restoring one session | streaming-RPC timing returns incomplete data | Optimistic update, mutate local state directly |
| Reopening modal shows stale state | iframe same-src doesn't trigger reload | Force reload via `about:blank` → targetUrl |
| List shows only bars, no content | `height: 100vh` fails in iframe + flex compression | `height: 100%` + `flex-shrink: 0` |
| Count doesn't match sidebar | Subagent sessions included | Subagents hidden by default, toggle via checkbox |

---

## 🤝 Contributing

欢迎提 Issue 和 PR。如果你遇到了其他 Antigravity UX 痛点，也欢迎在 Issue 里讨论。

---

## 📜 License
Released under the [MIT License](LICENSE).
