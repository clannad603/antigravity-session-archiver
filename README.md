# Antigravity Session Archiver (`antigravity-session-archiver`)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node Version](https://img.shields.io/badge/Node.js-22%2B-green.svg)](https://nodejs.org/)
[![Platform: Windows](https://img.shields.io/badge/Platform-Windows-blue.svg)](#)
[![Status: Active](https://img.shields.io/badge/Status-Active-brightgreen.svg)](#)

[中文说明](#中文说明) | [English Documentation](#english-documentation)

> ⚠️ **Disclaimer**: This is an unofficial, community-driven project. It is not affiliated with, endorsed by, or sponsored by Google. "Antigravity" is a trademark of Google LLC. Use at your own risk. The project only modifies the local Electron client and calls the official Language Server API — it does not distribute modified binaries, does not bypass any security control, and does not upload any user data.

---

<a name="中文说明"></a>
## 💡 中文说明

**Antigravity Session Archiver** 用于在 Google Antigravity 客户端中恢复已归档的会话。本工具通过调用客户端内置 Language Server 的 gRPC-Web API，将归档会话重新恢复至侧边栏活跃列表中。

### 功能特性

1. **侧边栏恢复**：调用 Language Server 的 `UpdateConversationAnnotations` API，更新 `archived` 状态，将会话恢复至侧边栏活跃列表。
2. **会话列表与元数据**：通过 `JetboxSubscribeToSummaries` 获取全量会话，支持查看创建时间、修改时间、步数、关联项目及 Git 分支等详情。
3. **子代理筛选**：自动识别子代理会话，默认在列表中隐藏，支持手动勾选显示。
4. **嵌入原生界面**：在客户端侧边栏添加 "📦 Archived Sessions" 入口，点击即可打开管理面板。
5. **动态端口探测**：自动探测 Language Server 的 HTTP 端口与 CSRF Token，适配不同版本端口分配。
6. **本地与安全**：纯本地运行，无第三方依赖，不上传任何数据；提供一键安装与卸载脚本。
7. **中英双语支持**：支持中英文界面一键切换。

---

### 工作原理

1. **读取 CDP 端口**：从 `~/AppData/Roaming/Antigravity/DevToolsActivePort` 中读取 Electron 启动时的端口配置。
2. **探测 LS 端口**：在 CDP 端口附近扫描候选端口，通过验证响应中是否包含 `csrfToken` 确定 Language Server 端口。
3. **获取 CSRF Token**：向 `GET https://127.0.0.1:<lsPort>/` 发送请求，提取 `window.__APP_CONFIG__.csrfToken`。
4. **获取会话列表**：调用 `/exa.language_server_pb.LanguageServerService/JetboxSubscribeToSummaries` 获取包含归档状态的全量会话列表。
5. **更新归档状态**：调用 `/exa.language_server_pb.LanguageServerService/UpdateConversationAnnotations`，将 `annotations.archived` 设为 `false`。

---

### 使用方法

```bash
# 1. 安装（注入脚本并添加侧边栏入口）
node scripts/inject.js --install

# 2. 重启 Antigravity 客户端

# 3. 使用：点击侧边栏 "📦 Archived Sessions" 入口，在弹出的面板中管理与恢复会话

# 4. 卸载（还原官方原版客户端）
node scripts/inject.js --uninstall
```

> **注意**：使用前请确保 Antigravity 客户端已启动（Language Server 在线）。

---

### 客户端升级处理

官方客户端更新可能会覆盖 `app.asar` 文件。更新版本时，请按以下步骤重置注入：

```bash
# 1. 还原官方客户端以正常接收更新
node scripts/inject.js --uninstall

# 2. 启动 Antigravity 并完成升级

# 3. 升级完成后重新注入
node scripts/inject.js --install
```

> 🛡️ **数据安全**：会话数据由 Language Server 存储于 `~/.gemini/antigravity/` 目录，注入与卸载操作均不会破坏本地会话数据。

---

### 常见问题与排查

| 现象 | 原因 | 解决办法 |
|---|---|---|
| 面板显示 "fetch failed" | LS 端口发生偏移 | 已内置动态端口探测，若仍失败请确认客户端已启动 |
| 恢复后列表短暂变空 | streaming RPC 响应延迟 | 已使用乐观更新机制，本地实时更新状态 |
| 重新打开弹窗显示旧数据 | iframe 未自动刷新 | 已加入强制重载机制 |
| 列表布局显示异常 | 容器高度计算受限 | 已调整 CSS flex 布局与高度定义 |
| 统计数量与侧栏不一致 | 包含了子代理会话 | 默认隐藏子代理，可勾选“含子代理会话”查看 |

---

<a name="english-documentation"></a>
## 🌍 English Documentation

**Antigravity Session Archiver** enables restoring archived sessions in the Google Antigravity client. By interacting with the internal Language Server gRPC-Web API, it restores archived sessions back into the active sidebar list.

### Key Features

1. **Sidebar Restoration**: Issues `UpdateConversationAnnotations` API requests to set `archived = false`, returning sessions to the active sidebar.
2. **Session Metadata Details**: Fetches complete session lists via `JetboxSubscribeToSummaries` with details like timestamps, step counts, project paths, and Git branches.
3. **Subagent Filtering**: Automatically identifies subagent sessions, hiding them by default with an option to toggle visibility.
4. **Native UI Integration**: Adds an "📦 Archived Sessions" item directly to the native client sidebar.
5. **Dynamic Port Probing**: Automatically scans and detects the Language Server HTTP port and CSRF token.
6. **Local & Secure**: Runs entirely locally with zero external npm dependencies and no data collection. Includes one-command install/uninstall scripts.
7. **Bilingual Support**: Toggle between English and Chinese UI.

---

### How It Works

1. **CDP Port Retrieval**: Reads startup port data from `~/AppData/Roaming/Antigravity/DevToolsActivePort`.
2. **LS Port Probing**: Scans candidate ports near CDP to locate the Language Server port using `csrfToken` responses.
3. **CSRF Token Extraction**: Extracts `window.__APP_CONFIG__.csrfToken` from `GET https://127.0.0.1:<lsPort>/`.
4. **Session Listing**: Queries `/exa.language_server_pb.LanguageServerService/JetboxSubscribeToSummaries` for all sessions.
5. **Archive State Update**: Invokes `/exa.language_server_pb.LanguageServerService/UpdateConversationAnnotations` with `annotations.archived = false`.

---

### Usage

```bash
# 1. Install (injects script and adds sidebar button)
node scripts/inject.js --install

# 2. Restart Antigravity client

# 3. Usage: Click "📦 Archived Sessions" in the sidebar to open the management panel

# 4. Uninstall (restores original client)
node scripts/inject.js --uninstall
```

> **Note**: Antigravity client must be running while using this tool.

---

### Handling Client Updates

When the client is updated, re-apply the injection:

```bash
# 1. Uninstall injection prior to updating
node scripts/inject.js --uninstall

# 2. Launch Antigravity to complete the official update

# 3. Re-install injection after update
node scripts/inject.js --install
```

> 🛡️ **Data Safety**: Session data is stored separately under `~/.gemini/antigravity/`. Installing or uninstalling will not modify your session history.

---

### Troubleshooting

| Symptom | Cause | Resolution |
|---|---|---|
| "fetch failed" error | LS port offset changed | Dynamic port scanning automatically detects offset shifts |
| Empty list after restore | Streaming RPC response delay | Optimistic update mutates local state immediately |
| Stale content on reopen | iframe caching | Forced reload handles iframe navigation |
| Layout formatting issue | CSS height calculation | Updated flex alignment and explicit height rules |
| Session count mismatch | Subagent sessions included | Subagents hidden by default; toggle option available |

---

## 🤝 Contributing

欢迎提交 Issue 和 Pull Request。 / Issues and Pull Requests are welcome.

---

## 📜 License
Released under the [MIT License](LICENSE).
