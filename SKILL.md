---
name: antigravity-session-archiver
description: Zero-AI fast session archiver, project-based session manager, transcript exporter, and 1-click restorer for Antigravity 2.0. Triggers on archive session, restore session, list sessions, project sessions, 会话归档, 恢复会话, 导出会话, 归档对话, 查看项目归档, 按项目查看会话.
---

# Antigravity 2.0 Session Archiver Skill (v2.6.0)

This skill provides zero-AI fast title/snippet extraction, project-first reverse session restoration, Worktree resolution, subagent context bundling, and embedded sidebar UI for Antigravity 2.0.

## Triggers
Activate this skill when the user asks to:
- "Archive session" / "Archive current conversation" / "会话归档" / "归档当前会话"
- "Restore session" / "Import archive" / "恢复会话" / "解包归档" / "取消归档"
- "List sessions by project" / "查看项目会话" / "按项目查看归档"
- "Export transcript to markdown" / "导出对话为Markdown"
- "Open session manager UI" / "打开归档面板"
- "Official update instructions" / "软件升级帮助"

---

## Instructions for Agent

### 1. 1-Click Electron Native Sidebar Injection (`inject.js`)
To inject the archiver into Antigravity 2.0's official sidebar with auto-daemon launch and auto-updater popup suppression:
```bash
node scripts/inject.js --install
```

To uninstall and restore official stock client (when receiving official Google software updates):
```bash
node scripts/inject.js --uninstall
```

### 2. Embedded Web UI Dashboard (`--ui`)
To open the zero-AI dark-mode Web UI Dashboard grouped by Project:
```bash
node scripts/session_archiver.js --ui
```

### 3. Listing Sessions Grouped by Project (`--list`)
To inspect all primary sessions from `~/.gemini/antigravity/brain/` organized by Project name without calling AI:
```bash
node scripts/session_archiver.js --list
```
