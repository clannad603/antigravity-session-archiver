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
import webbrowser
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
        return False, f"Session directory not found: {session_dir}"

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
    return True, str(output_zip)

def restore_session(archive_path, target_dir):
    """Restore an .agarch bundle into target directory."""
    archive_file = Path(archive_path).resolve()
    if not archive_file.exists():
        print(f"[Error] Archive file not found: {archive_path}")
        return False, f"Archive file not found: {archive_path}"

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
    return True, str(target_path)

def export_markdown(transcript_path, output_md_path):
    """Convert a transcript.jsonl file into a readable Markdown report."""
    input_file = Path(transcript_path).resolve()
    if not input_file.exists():
        print(f"[Error] Transcript file not found: {transcript_path}")
        return False, f"Transcript file not found: {transcript_path}"

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
    return True, str(output_file)

def get_archives_list(dir_path):
    """Get list of archives as structured JSON dict."""
    folder = Path(dir_path).resolve()
    if not folder.exists():
        return []

    archives = list(folder.glob("*.agarch")) + list(folder.glob("*.zip"))
    results = []
    for arc in archives:
        info = {
            "filename": arc.name,
            "filepath": str(arc),
            "size_bytes": arc.stat().st_size,
            "size_mb": round(arc.stat().st_size / (1024 * 1024), 2)
        }
        try:
            with zipfile.ZipFile(arc, "r") as zipf:
                if "manifest.json" in zipf.namelist():
                    manifest = json.loads(zipf.read("manifest.json").decode("utf-8"))
                    info.update(manifest)
                else:
                    info["session_id"] = arc.stem
                    info["archived_at"] = datetime.fromtimestamp(arc.stat().st_mtime).isoformat()
                    info["initial_prompt"] = "Legacy / Unmanifested ZIP Archive"
        except Exception as e:
            info["error"] = str(e)
        results.append(info)
    return results

def list_archives(dir_path):
    """List all .agarch files in a given directory via CLI."""
    archives = get_archives_list(dir_path)
    print(f"🔍 Found {len(archives)} archive(s) in `{Path(dir_path).resolve()}`:\n")
    for arc in archives:
        print(f"📦 Archive: {arc['filename']}")
        print(f"   ├─ Session ID: {arc.get('session_id', 'Unknown')}")
        print(f"   ├─ Archived At: {arc.get('archived_at', 'Unknown')}")
        print(f"   ├─ Initial Prompt: {str(arc.get('initial_prompt', ''))[:60]}...")
        print(f"   └─ Steps: {arc.get('total_steps', 0)} | Tool Calls: {arc.get('tool_calls_count', 0)}\n")

# Built-in Single Page Application HTML Dashboard
HTML_DASHBOARD = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Antigravity 2.0 会话归档管理面板</title>
    <style>
        :root {
            --bg-color: #0f172a;
            --card-bg: #1e293b;
            --text-main: #f8fafc;
            --text-sub: #94a3b8;
            --accent-color: #38bdf8;
            --accent-hover: #0284c7;
            --border-color: #334155;
            --success-color: #4ade80;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: system-ui, -apple-system, sans-serif; }
        body { background: var(--bg-color); color: var(--text-main); padding: 24px; }
        .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid var(--border-color); }
        .title { font-size: 24px; font-weight: 700; background: linear-gradient(135deg, #38bdf8, #818cf8); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .btn { background: var(--accent-color); color: #000; border: none; padding: 10px 18px; border-radius: 8px; font-weight: 600; cursor: pointer; transition: all 0.2s; }
        .btn:hover { background: var(--accent-hover); color: #fff; }
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 20px; }
        .card { background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 12px; padding: 20px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); transition: transform 0.2s; }
        .card:hover { transform: translateY(-3px); border-color: var(--accent-color); }
        .card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
        .session-id { font-size: 16px; font-weight: 600; color: var(--accent-color); }
        .badge { background: rgba(56, 189, 248, 0.15); color: var(--accent-color); font-size: 12px; padding: 4px 8px; border-radius: 6px; }
        .prompt-text { font-size: 14px; color: var(--text-sub); margin-bottom: 16px; height: 42px; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
        .stats-row { display: flex; gap: 16px; font-size: 13px; color: var(--text-sub); margin-bottom: 16px; }
        .stats-item span { color: var(--text-main); font-weight: 600; }
        .card-actions { display: flex; gap: 10px; }
        .btn-outline { background: transparent; border: 1px solid var(--border-color); color: var(--text-main); padding: 8px 12px; border-radius: 6px; font-size: 13px; cursor: pointer; flex: 1; text-align: center; }
        .btn-outline:hover { border-color: var(--accent-color); color: var(--accent-color); }
        .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); align-items: center; justify-content: center; }
        .modal-content { background: var(--card-bg); border-radius: 12px; padding: 24px; width: 480px; border: 1px solid var(--border-color); }
        .form-group { margin-bottom: 16px; }
        .form-group label { display: block; margin-bottom: 6px; font-size: 14px; color: var(--text-sub); }
        .form-group input { width: 100%; padding: 10px; background: var(--bg-color); border: 1px solid var(--border-color); color: #fff; border-radius: 6px; }
    </style>
</head>
<body>
    <div class="header">
        <div>
            <div class="title">Antigravity 2.0 会话归档管理面板</div>
            <div style="font-size: 13px; color: var(--text-sub); margin-top: 4px;">可视化浏览、一键解包恢复与历史对话导出的调试中心</div>
        </div>
        <div>
            <button class="btn" onclick="openArchiveModal()">+ 新建归档打包</button>
        </div>
    </div>

    <div class="grid" id="archives-grid">
        <div style="color: var(--text-sub)">加载归档列表中...</div>
    </div>

    <div class="modal" id="archiveModal">
        <div class="modal-content">
            <h3 style="margin-bottom: 16px;">打包归档指定会话</h3>
            <div class="form-group">
                <label>会话目录路径 (Session Directory)</label>
                <input type="text" id="sessionDirInput" placeholder="例如: C:\\Users\\...\\.gemini\\antigravity\\brain\\xxx">
            </div>
            <div class="form-group">
                <label>输出文件名 (.agarch)</label>
                <input type="text" id="outputFileInput" placeholder="my_session.agarch (可选)">
            </div>
            <div style="display: flex; gap: 12px; justify-content: flex-end; margin-top: 24px;">
                <button class="btn-outline" onclick="closeArchiveModal()">取消</button>
                <button class="btn" onclick="submitArchive()">确定归档</button>
            </div>
        </div>
    </div>

    <script>
        async function fetchArchives() {
            const res = await fetch('/api/archives');
            const data = await res.json();
            const grid = document.getElementById('archives-grid');
            if (data.length === 0) {
                grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 48px; color: var(--text-sub);">暂无归档文件。点击右上方按键添加归档。</div>';
                return;
            }
            grid.innerHTML = data.map(arc => `
                <div class="card">
                    <div class="card-header">
                        <div class="session-id">${arc.session_id || arc.filename}</div>
                        <div class="badge">${arc.size_mb} MB</div>
                    </div>
                    <div class="prompt-text">${arc.initial_prompt || '无提示词记录'}</div>
                    <div class="stats-row">
                        <div class="stats-item">对话步数: <span>${arc.total_steps || 0}</span></div>
                        <div class="stats-item">工具调用: <span>${arc.tool_calls_count || 0}</span></div>
                    </div>
                    <div class="card-actions">
                        <button class="btn-outline" onclick="restoreArchive('${arc.filename}')">📂 恢复解包</button>
                    </div>
                </div>
            `).join('');
        }

        function openArchiveModal() { document.getElementById('archiveModal').style.display = 'flex'; }
        function closeArchiveModal() { document.getElementById('archiveModal').style.display = 'none'; }

        async function submitArchive() {
            const sessionDir = document.getElementById('sessionDirInput').value;
            const output = document.getElementById('outputFileInput').value;
            if(!sessionDir) return alert('请输入会话目录路径');
            const res = await fetch('/api/archive', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ session_dir: sessionDir, output: output })
            });
            const result = await res.json();
            if(result.success) {
                alert('打包归档成功！');
                closeArchiveModal();
                fetchArchives();
            } else {
                alert('错误: ' + result.message);
            }
        }

        async function restoreArchive(filename) {
            const targetDir = prompt('请输入提取解包的目标目录:', './restored_' + filename.replace('.agarch',''));
            if(!targetDir) return;
            const res = await fetch('/api/restore', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ input: filename, output: targetDir })
            });
            const result = await res.json();
            if(result.success) {
                alert('解包恢复成功！已创建 RESTORED_SESSION_CONTEXT.md 上下文笔记');
            } else {
                alert('恢复失败: ' + result.message);
            }
        }

        fetchArchives();
    </script>
</body>
</html>"""

class WebUIHandler(BaseHTTPRequestHandler):
    """HTTP Request Handler for built-in Web GUI."""
    dir_path = "."

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path in ["/", "/index.html"]:
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(HTML_DASHBOARD.encode("utf-8"))
        elif parsed.path == "/api/archives":
            archives = get_archives_list(self.dir_path)
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(json.dumps(archives, ensure_ascii=False).encode("utf-8"))
        else:
            self.send_error(404, "Not Found")

    def do_POST(self):
        parsed = urlparse(self.path)
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length).decode("utf-8") if content_length > 0 else "{}"
        data = json.loads(body)

        if parsed.path == "/api/archive":
            success, msg = archive_session(data.get("session_dir"), data.get("output"), data.get("description", ""))
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(json.dumps({"success": success, "message": msg}).encode("utf-8"))
        elif parsed.path == "/api/restore":
            success, msg = restore_session(data.get("input"), data.get("output"))
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(json.dumps({"success": success, "message": msg}).encode("utf-8"))
        else:
            self.send_error(404, "Not Found")

def start_web_ui(dir_path=".", port=8080):
    """Launch built-in local web server and open browser."""
    WebUIHandler.dir_path = dir_path
    server = HTTPServer(("127.0.0.1", port), WebUIHandler)
    url = f"http://127.0.0.1:{port}"
    print(f"🚀 Launching Antigravity Session Archiver Web UI at: {url}")
    webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n🛑 Web UI Server stopped.")

def main():
    parser = argparse.ArgumentParser(description="Antigravity 2.0 Session Archiver Tool")
    parser.add_argument("--archive", action="store_true", help="Archive a session folder")
    parser.add_argument("--restore", action="store_true", help="Restore an .agarch archive")
    parser.add_argument("--export-md", action="store_true", help="Export transcript.jsonl to readable Markdown")
    parser.add_argument("--list", action="store_true", help="List archives in a directory")
    parser.add_argument("--ui", action="store_true", help="Launch local Web GUI Dashboard in browser")
    
    parser.add_argument("--session-dir", type=str, help="Path to session directory to archive")
    parser.add_argument("--input", type=str, help="Input archive file (.agarch) or transcript file (.jsonl)")
    parser.add_argument("--output", type=str, help="Output destination path")
    parser.add_argument("--dir", type=str, default=".", help="Directory path to scan for archives")
    parser.add_argument("--port", type=int, default=8080, help="Port for local Web UI (default: 8080)")
    parser.add_argument("--description", type=str, default="", help="Optional description for archive manifest")

    args = parser.parse_args()

    if args.ui:
        start_web_ui(args.dir, args.port)
    elif args.archive:
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

