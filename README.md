# Antigravity 2.0 Session Archiver (`antigravity-session-archiver`)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python Version](https://img.shields.io/badge/Python-3.7%2B-blue.svg)](https://www.python.org/)

[中文文档](#中文说明) | [English Documentation](#english-documentation)

---

<a name="中文说明"></a>
## 💡 中文说明

**Antigravity 2.0 Session Archiver** 是专为 Google Antigravity 2.0 智能体打造的零依赖、轻量级会话归档与恢复插件/技能（Skill）。

### ✨ 核心功能
1. **📦 一键会话归档 (`--archive`)**：将包含对话日志 (`transcript.jsonl`)、生成产物 (`artifacts`)、子任务记录及 `.system_generated` 数据的会话目录完整打包压缩为 `.agarch` (ZIP) 便携文件。
2. **📂 会话恢复与解包 (`--restore`)**：可解包历史 `.agarch` 归档，并自动提取核心上下文生成 `RESTORED_SESSION_CONTEXT.md` 摘要笔记，方便在新的会话中快速重新加载上下文。
3. **📄 对话转 Markdown (`--export-md`)**：将 JSONL 格式的原始对话轨迹解析导出为格式规整、阅读体验佳的 Markdown / HTML 报告，方便离线审查或团队分享。
4. **🔍 归档检索清单 (`--list`)**：快速列出指定目录下的所有归档包，查看创建时间、初始 Prompt、对话步数及工具调用频次。

### 🚀 安装方式

将本仓库克隆至你的 Antigravity 配置目录或工作区 `.agents/skills/` 中即可自动触发：

```bash
# 方式一：安装至全局配置目录
git clone https://github.com/clannad603/antigravity-session-archiver.git ~/.gemini/config/plugins/antigravity-session-archiver

# 方式二：安装至项目工作区
git clone https://github.com/clannad603/antigravity-session-archiver.git .agents/skills/antigravity-session-archiver
```

### 🛠️ 命令行使用指南 (CLI Usage)

```bash
# 1. 归档当前/指定会话目录
python scripts/session_archiver.py --archive --session-dir <session_directory> --output my_archive.agarch --description "数据分析阶段一归档"

# 2. 恢复归档文件至目标目录
python scripts/session_archiver.py --restore --input my_archive.agarch --output ./restored_session

# 3. 将 JSONL 对话记录导出为 Markdown 报告
python scripts/session_archiver.py --export-md --input transcript.jsonl --output session_report.md

# 4. 查看当前目录下所有归档包
python scripts/session_archiver.py --list --dir .
```

---

<a name="english-documentation"></a>
## 🌍 English Documentation

**Antigravity 2.0 Session Archiver** is a zero-dependency plugin & skill designed for Antigravity 2.0 agents to effortlessly back up, archive, export, and restore conversation history, transcripts, and session artifacts.

### ✨ Key Features
- **📦 Complete Session Packaging (`--archive`)**: Compress session logs (`transcript.jsonl`), artifacts, and metadata into a portable `.agarch` (ZIP format) file.
- **📂 Archive Restoration (`--restore`)**: Unpack archived sessions and automatically generate a structured `RESTORED_SESSION_CONTEXT.md` for context re-injection.
- **📄 Transcript to Markdown Export (`--export-md`)**: Transform raw JSONL session logs into clean, readable Markdown reports with code highlighting and tool execution summaries.
- **🔍 Quick Archive Inspection (`--list`)**: Browse archives and view metadata including session IDs, step counts, tool calls, and initial prompts.

---

## 📜 License
Released under the [MIT License](LICENSE).
