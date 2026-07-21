#!/usr/bin/env python3
"""
Antigravity 2.0 Session Archiver (`session_archiver.py`)

Multi-Tier Deep Project Clustering & Session Restoration Engine.
"""

import os
import sys
import re
import json
import zipfile
import argparse
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse
from datetime import datetime
from pathlib import Path

# Ensure stdout and stderr handle UTF-8 encoding on Windows
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

VERSION = "2.0.0"

def get_brain_dir():
    """Get Gemini Antigravity Brain Directory."""
    home = os.environ.get("USERPROFILE") or os.environ.get("HOME") or "C:\\Users\\Default"
    return Path(home) / ".gemini" / "antigravity" / "brain"

def clean_user_text(text):
    """Clean XML tags without AI."""
    if not text:
        return ""
    text = re.sub(r'<USER_REQUEST>([\s\S]*?)</USER_REQUEST>', r'\1', text)
    text = re.sub(r'<ADDITIONAL_METADATA>[\s\S]*?</ADDITIONAL_METADATA>', '', text)
    text = re.sub(r'<USER_SETTINGS_CHANGE>[\s\S]*?</USER_SETTINGS_CHANGE>', '', text)
    text = re.sub(r'<[^>]+>', '', text)
    return text.strip()

def parse_transcript(jsonl_path):
    """Parse transcript.jsonl file."""
    steps = []
    user_inputs = []
    tool_calls_count = 0
    
    if not os.path.exists(jsonl_path):
        return {"total_steps": 0, "user_inputs": [], "tool_calls_count": 0, "steps": []}
        
    with open(jsonl_path, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                data = json.loads(line)
                steps.append(data)
                if data.get("type") == "USER_INPUT" and data.get("content"):
                    user_inputs.append(data.get("content"))
                if "tool_calls" in data and isinstance(data["tool_calls"], list):
                    tool_calls_count += len(data["tool_calls"])
            except Exception:
                pass
                
    return {
        "total_steps": len(steps),
        "user_inputs": user_inputs,
        "tool_calls_count": tool_calls_count,
        "steps": steps
    }

def extract_project_info(parsed, session_path):
    """Deep Multi-Tier Project Extraction without AI."""
    transcript_path = Path(session_path) / ".system_generated" / "logs" / "transcript.jsonl"
    content = ""
    if transcript_path.exists():
        try:
            with open(transcript_path, "r", encoding="utf-8", errors="replace") as f:
                content = f.read()
        except Exception:
            pass

    if not content:
        return {"projectName": "全局 / 未分类项目", "projectPath": "N/A"}

    # Tier 1: User workspace metadata block in prompt [URI] -> [...]
    uri_match = re.search(r'\[URI\]\s*->\s*\[(.*?)\]', content)
    if uri_match and uri_match.group(1):
        p = uri_match.group(1).replace("\\", "/").strip()
        parts = [pt for pt in p.split("/") if pt]
        if parts:
            return {"projectName": parts[-1], "projectPath": p}

    # Tier 2: Search for workspace path patterns e.g. workspaces/NAME, worktrees/NAME, projects/NAME
    ws_match = re.search(r'(?:workspaces|projects|repos|code|workspace|github|worktrees)[\\/]([a-zA-Z0-9_\-\.]+)', content, re.IGNORECASE)
    if ws_match and ws_match.group(1):
        name = ws_match.group(1).strip()
        if name.lower() not in ['brain', '.system_generated', 'logs', 'scratch']:
            return {"projectName": name, "projectPath": f"workspaces/{name}"}

    # Tier 3: Search for drive workspace paths
    drive_match = re.search(r'([a-zA-Z]:[\\/](?:[^\s"',\\/]+[\\/])*(?:workspaces|projects)[\\/][a-zA-Z0-9_\-\.]+)', content, re.IGNORECASE)
    if drive_match and drive_match.group(1):
        full_p = drive_match.group(1).replace("\\", "/")
        parts = [pt for pt in full_p.split("/") if pt]
        return {"projectName": parts[-1], "projectPath": full_p}

    # Tier 4: Keywords fallback
    if "obsidian" in content.lower():
        return {"projectName": "Obsidian / 笔记库", "projectPath": "N/A"}
    if "leetcode" in content.lower():
        return {"projectName": "LeetCode", "projectPath": "N/A"}
    if "academic-paper" in content.lower() or "nature-reviewer" in content.lower():
        return {"projectName": "学术科研论文", "projectPath": "N/A"}

    return {"projectName": "全局 / 未分类项目", "projectPath": "N/A"}

def generate_zero_ai_summary(session_path, parsed):
    """Generate title, snippet, tool breakdown without AI."""
    first_input = parsed["user_inputs"][0] if parsed["user_inputs"] else ""
    cleaned_input = clean_user_text(first_input)
    
    lines = [l.strip() for l in cleaned_input.split("\n") if l.strip()]
    title = lines[0] if lines else f"会话 {Path(session_path).name}"
    if len(title) > 55:
        title = title[:55] + "..."
        
    snippet = re.sub(r'\s+', ' ', cleaned_input)
    if len(snippet) > 130:
        snippet = snippet[:130] + "..."
        
    tool_stats = {}
    for s in parsed["steps"]:
        if "tool_calls" in s and isinstance(s["tool_calls"], list):
            for tc in s["tool_calls"]:
                name = tc.get("name") or (tc.get("function", {}).get("name")) or "tool"
                tool_stats[name] = tool_stats.get(name, 0) + 1
                
    artifacts_count = 0
    artifact_names = []
    if os.path.exists(session_path):
        try:
            for f in os.listdir(session_path):
                if not f.startswith(".") and f != ".system_generated":
                    artifacts_count += 1
                    if len(artifact_names) < 4:
                        artifact_names.append(f)
        except Exception:
            pass

    return {
        "title": title,
        "snippet": snippet,
        "toolStats": tool_stats,
        "artifactsCount": artifacts_count,
        "artifactNames": artifact_names
    }

def scan_all_sessions(custom_brain_dir=None):
    """Scan all sessions from ~/.gemini/antigravity/brain/."""
    brain_dir = Path(custom_brain_dir) if custom_brain_dir else get_brain_dir()
    if not brain_dir.exists():
        return {"projects": {}, "sessions": []}

    sessions = []
    projects_map = {}

    for entry in brain_dir.iterdir():
        if not entry.is_dir():
            continue

        sessionId = entry.name
        transcript_path = entry / ".system_generated" / "logs" / "transcript.jsonl"
        parsed = parse_transcript(transcript_path)
        proj_info = extract_project_info(parsed, str(entry))
        zero_ai = generate_zero_ai_summary(str(entry), parsed)

        stat = entry.stat()
        mtime = datetime.fromtimestamp(stat.st_mtime).isoformat()
        ctime = datetime.fromtimestamp(stat.st_ctime).isoformat() if hasattr(stat, 'st_ctime') else mtime
        is_archived = (entry / ".archived").exists() or (entry / "ARCHIVED").exists()

        sess_obj = {
            "id": sessionId,
            "path": str(entry),
            "projectName": proj_info["projectName"],
            "projectPath": proj_info["projectPath"],
            "title": zero_ai["title"],
            "snippet": zero_ai["snippet"],
            "total_steps": parsed["total_steps"],
            "tool_calls_count": parsed["tool_calls_count"],
            "toolStats": zero_ai["toolStats"],
            "artifactsCount": zero_ai["artifactsCount"],
            "artifactNames": zero_ai["artifactNames"],
            "created_at": ctime,
            "updated_at": mtime,
            "isArchived": is_archived
        }

        sessions.push(sess_obj) if hasattr(sessions, 'push') else sessions.append(sess_obj)
        proj_name = sess_obj["projectName"]
        if proj_name not in projects_map:
            projects_map[proj_name] = {
                "name": proj_name,
                "path": sess_obj["projectPath"],
                "count": 0,
                "archivedCount": 0
            }
        projects_map[proj_name]["count"] += 1
        if is_archived:
            projects_map[proj_name]["archivedCount"] += 1

    sessions.sort(key=lambda s: s["updated_at"], reverse=True)
    return {"projects": projects_map, "sessions": sessions}

def main():
    parser = argparse.ArgumentParser(description="Antigravity 2.0 Session Archiver Engine")
    parser.add_argument("--list", action="store_true", help="List all sessions grouped by project")
    args = parser.parse_args()

    if args.list:
        data = scan_all_sessions()
        print(f"FOUND {len(data['sessions'])} SESSIONS ACROSS {len(data['projects'])} PROJECTS:")
        for s in data["sessions"]:
            print(f"- [{s['projectName']}] ID: {s['id']} | {s['title']} ({s['total_steps']} steps)")
    else:
        print("Antigravity 2.0 Session Archiver (Python Engine v2.0.0)")

if __name__ == "__main__":
    main()
