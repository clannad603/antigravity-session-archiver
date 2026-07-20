#!/usr/bin/env python3
"""
Antigravity 2.0 Session Archiver (`session_archiver.py`)

A lightweight CLI tool for backing up, archiving, restoring, and exporting
Antigravity 2.0 agent sessions, transcripts, and artifacts.
"""

import os
import sys
import json
import zipfile
import argparse
from datetime import datetime
from pathlib import Path

# Ensure stdout and stderr handle UTF-8 encoding on Windows
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

VERSION = "1.0.0"

def parse_transcript(jsonl_path):
    """Parse a transcript.jsonl file into structured conversation turns."""
    steps = []
    user_inputs = []
    tool_calls_count = 0
    
    if not os.path.exists(jsonl_path):
        return {"steps": [], "user_inputs": [], "tool_calls_count": 0}
        
    with open(jsonl_path, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                data = json.loads(line)
                steps.append(data)
                step_type = data.get("type", "")
                if step_type == "USER_INPUT":
                    content = data.get("content", "")
                    if content:
                        user_inputs.append(content)
                if "tool_calls" in data and data["tool_calls"]:
                    tool_calls_count += len(data["tool_calls"])
            except Exception:
                pass
                
    return {
        "total_steps": len(steps),
        "user_inputs": user_inputs,
        "tool_calls_count": tool_calls_count,
        "steps": steps
    }

def archive_session(session_dir, output_path=None, description=""):
    """Archive a session folder into a portable .agarch (ZIP) bundle."""
    session_path = Path(session_dir).resolve()
    if not session_path.exists():
        print(f"[Error] Session directory not found: {session_dir}")
        sys.exit(1)

    session_id = session_path.name
    logs_dir = session_path / ".system_generated" / "logs"
    transcript_file = logs_dir / "transcript.jsonl" if logs_dir.exists() else session_path / "transcript.jsonl"
    
    # Parse metadata
    meta_info = parse_transcript(transcript_file) if transcript_file.exists() else {"total_steps": 0, "user_inputs": [], "tool_calls_count": 0}
    
    manifest = {
        "antigravity_archiver_version": VERSION,
        "session_id": session_id,
        "archived_at": datetime.now().isoformat(),
        "description": description or f"Archive of Antigravity Session {session_id}",
        "total_steps": meta_info["total_steps"],
        "user_input_count": len(meta_info["user_inputs"]),
        "tool_calls_count": meta_info["tool_calls_count"],
        "initial_prompt": meta_info["user_inputs"][0] if meta_info["user_inputs"] else "N/A"
    }

    if not output_path:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_path = f"session_{session_id}_{timestamp}.agarch"
        
    output_zip = Path(output_path).resolve()
    output_zip.parent.mkdir(parents=True, exist_ok=True)

    print(f"📦 Archiving session: {session_id} ...")
    with zipfile.ZipFile(output_zip, "w", zipfile.ZIP_DEFLATED) as zipf:
        # Write manifest.json
        zipf.writestr("manifest.json", json.dumps(manifest, indent=2, ensure_ascii=False))
        
        # Walk and add session directory files
        for root, dirs, files in os.walk(session_path):
            for file in files:
                full_path = Path(root) / file
                rel_path = full_path.relative_to(session_path)
                zipf.write(full_path, arcname=Path("data") / rel_path)

    print(f"✅ Session successfully archived to: {output_zip}")
    print(f"   - Total Steps: {manifest['total_steps']}")
    print(f"   - User Inputs: {manifest['user_input_count']}")
    print(f"   - Tool Calls: {manifest['tool_calls_count']}")
    return str(output_zip)

def restore_session(archive_path, target_dir):
    """Restore an .agarch bundle into target directory."""
    archive_file = Path(archive_path).resolve()
    if not archive_file.exists():
        print(f"[Error] Archive file not found: {archive_path}")
        sys.exit(1)

    target_path = Path(target_dir).resolve()
    target_path.mkdir(parents=True, exist_ok=True)

    print(f"📂 Restoring session from archive: {archive_file} ...")
    with zipfile.ZipFile(archive_file, "r") as zipf:
        manifest = {}
        if "manifest.json" in zipf.namelist():
            manifest = json.loads(zipf.read("manifest.json").decode("utf-8"))
            
        for member in zipf.infolist():
            if member.filename.startswith("data/"):
                rel_path = member.filename[len("data/"):]
                if not rel_path:
                    continue
                dest_path = target_path / rel_path
                if member.is_dir():
                    dest_path.mkdir(parents=True, exist_ok=True)
                else:
                    dest_path.parent.mkdir(parents=True, exist_ok=True)
                    with zipf.open(member) as source, open(dest_path, "wb") as target:
                        target.write(source.read())

    # Generate a context summary file for restoring into active sessions
    context_md = target_path / "RESTORED_SESSION_CONTEXT.md"
    summary_content = [
        f"# Restored Session Context",
        f"- **Session ID**: `{manifest.get('session_id', 'Unknown')}`",
        f"- **Archived At**: `{manifest.get('archived_at', 'Unknown')}`",
        f"- **Initial User Prompt**: {manifest.get('initial_prompt', 'N/A')}",
        f"- **Total Steps**: {manifest.get('total_steps', 0)}",
        f"- **Tool Calls**: {manifest.get('tool_calls_count', 0)}",
        "\n> [!NOTE]\n> This context was restored by Antigravity Session Archiver.\n"
    ]
    context_md.write_text("\n".join(summary_content), encoding="utf-8")

    print(f"✅ Session restored to: {target_path}")
    print(f"📄 Summary context note created: {context_md}")
    return str(target_path)

def export_markdown(transcript_path, output_md_path):
    """Convert a transcript.jsonl file into a readable Markdown report."""
    input_file = Path(transcript_path).resolve()
    if not input_file.exists():
        print(f"[Error] Transcript file not found: {transcript_path}")
        sys.exit(1)

    parsed = parse_transcript(input_file)
    output_file = Path(output_md_path).resolve()
    output_file.parent.mkdir(parents=True, exist_ok=True)

    md_lines = [
        f"# Antigravity Session Transcript Report",
        f"- **File**: `{input_file.name}`",
        f"- **Total Steps**: {parsed['total_steps']}",
        f"- **User Prompts**: {len(parsed['user_inputs'])}",
        f"- **Tool Executions**: {parsed['tool_calls_count']}",
        "\n---\n"
    ]

    for idx, step in enumerate(parsed["steps"], start=1):
        step_type = step.get("type", "UNKNOWN")
        source = step.get("source", "")
        content = step.get("content", "")
        tool_calls = step.get("tool_calls", [])

        md_lines.append(f"### Step {idx}: [{step_type}] (Source: {source})")
        if content:
            md_lines.append(f"\n{content}\n")
            
        if tool_calls:
            md_lines.append("**Tool Calls Executed:**")
            for tc in tool_calls:
                t_name = tc.get("name", tc.get("function", {}).get("name", "tool"))
                t_args = tc.get("args", tc.get("arguments", {}))
                args_str = json.dumps(t_args, ensure_ascii=False, indent=2)
                md_lines.append(f"```json\n// Call: {t_name}\n{args_str}\n```")
        md_lines.append("\n---\n")

    output_file.write_text("\n".join(md_lines), encoding="utf-8")
    print(f"📄 Exported transcript report to: {output_file}")
    return str(output_file)

def list_archives(dir_path):
    """List all .agarch files in a given directory."""
    folder = Path(dir_path).resolve()
    if not folder.exists():
        print(f"[Error] Directory not found: {dir_path}")
        sys.exit(1)

    archives = list(folder.glob("*.agarch")) + list(folder.glob("*.zip"))
    print(f"🔍 Found {len(archives)} archive(s) in `{folder}`:\n")
    for arc in archives:
        try:
            with zipfile.ZipFile(arc, "r") as zipf:
                if "manifest.json" in zipf.namelist():
                    manifest = json.loads(zipf.read("manifest.json").decode("utf-8"))
                    print(f"📦 Archive: {arc.name}")
                    print(f"   ├─ Session ID: {manifest.get('session_id')}")
                    print(f"   ├─ Archived At: {manifest.get('archived_at')}")
                    print(f"   ├─ Initial Prompt: {manifest.get('initial_prompt')[:60]}...")
                    print(f"   └─ Steps: {manifest.get('total_steps')} | Tool Calls: {manifest.get('tool_calls_count')}\n")
                else:
                    print(f"📦 File: {arc.name} (Legacy or unmanifested ZIP archive)\n")
        except Exception as e:
            print(f"📦 File: {arc.name} (Error reading zip: {e})\n")

def main():
    parser = argparse.ArgumentParser(description="Antigravity 2.0 Session Archiver Tool")
    parser.add_argument("--archive", action="store_true", help="Archive a session folder")
    parser.add_argument("--restore", action="store_true", help="Restore an .agarch archive")
    parser.add_argument("--export-md", action="store_true", help="Export transcript.jsonl to readable Markdown")
    parser.add_argument("--list", action="store_true", help="List archives in a directory")
    
    parser.add_argument("--session-dir", type=str, help="Path to session directory to archive")
    parser.add_argument("--input", type=str, help="Input archive file (.agarch) or transcript file (.jsonl)")
    parser.add_argument("--output", type=str, help="Output destination path")
    parser.add_argument("--dir", type=str, default=".", help="Directory path to scan for archives")
    parser.add_argument("--description", type=str, default="", help="Optional description for archive manifest")

    args = parser.parse_args()

    if args.archive:
        if not args.session_dir:
            print("[Error] --session-dir is required for --archive")
            sys.exit(1)
        archive_session(args.session_dir, args.output, args.description)
    elif args.restore:
        if not args.input or not args.output:
            print("[Error] Both --input (.agarch) and --output (target dir) are required for --restore")
            sys.exit(1)
        restore_session(args.input, args.output)
    elif args.export_md:
        if not args.input or not args.output:
            print("[Error] Both --input (transcript.jsonl) and --output (report.md) are required for --export-md")
            sys.exit(1)
        export_markdown(args.input, args.output)
    elif args.list:
        list_archives(args.dir)
    else:
        parser.print_help()

if __name__ == "__main__":
    main()
