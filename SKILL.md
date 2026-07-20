---
name: antigravity-session-archiver
description: Archive, backup, export, and restore Antigravity 2.0 sessions, conversation transcripts (jsonl to markdown), artifacts, and context files into portable .agarch bundles. Triggers on archive session, restore session,会话归档, 恢复会话, 导出会话, 归档对话.
---

# Antigravity 2.0 Session Archiver Skill

This skill provides an automated workflow to backup, compress, export, and restore conversation sessions, transcripts, and artifacts in Antigravity 2.0.

## Triggers
Activate this skill when the user asks to:
- "Archive session" / "Archive current conversation" / "会话归档" / "归档当前会话"
- "Restore session" / "Import archive" / "恢复会话" / "解包归档"
- "Export transcript to markdown" / "导出对话为Markdown"
- "List session archives" / "查看归档列表"

---

## Instructions for Agent

### 1. Archiving a Session (`--archive`)
When requested to archive a session, locate the session folder or transcript path:
```bash
python scripts/session_archiver.py --archive --session-dir <path_to_session_dir> --output <output_archive_name.agarch> --description "Optional session description"
```
The script will pack transcripts, logs, artifacts, and metadata into a portable `.agarch` ZIP bundle.

### 2. Restoring a Session (`--restore`)
When requested to restore an archive:
```bash
python scripts/session_archiver.py --restore --input <path_to_archive.agarch> --output <target_directory>
```
The script will unpack all files and generate a `RESTORED_SESSION_CONTEXT.md` summary ready for context re-injection into the active session.

### 3. Exporting Transcript to Markdown (`--export-md`)
To convert a raw `transcript.jsonl` log file into a clean human-readable Markdown report:
```bash
python scripts/session_archiver.py --export-md --input <path_to_transcript.jsonl> --output <path_to_report.md>
```

### 4. Listing Archives (`--list`)
To inspect all `.agarch` archive files in a folder:
```bash
python scripts/session_archiver.py --list --dir <directory_path>
```
