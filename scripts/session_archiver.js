#!/usr/bin/env node
/**
 * Antigravity 2.0 Session Archiver (Pure Node.js Zero-Dependency Version)
 * 
 * Works out-of-the-box on Windows, macOS, and Linux without Python or npm dependencies.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const { exec, execSync } = require('child_process');

const VERSION = "1.0.0";

// Helper: parse transcript.jsonl
function parseTranscript(jsonlPath) {
    if (!fs.existsSync(jsonlPath)) {
        return { total_steps: 0, user_inputs: [], tool_calls_count: 0, steps: [] };
    }
    const lines = fs.readFileSync(jsonlPath, 'utf-8').split('\n');
    const steps = [];
    const userInputs = [];
    let toolCallsCount = 0;

    for (let line of lines) {
        line = line.trim();
        if (!line) continue;
        try {
            const data = JSON.parse(line);
            steps.push(data);
            if (data.type === 'USER_INPUT' && data.content) {
                userInputs.push(data.content);
            }
            if (data.tool_calls && Array.isArray(data.tool_calls)) {
                toolCallsCount += data.tool_calls.length;
            }
        } catch (e) {}
    }

    return {
        total_steps: steps.length,
        user_inputs: userInputs,
        tool_calls_count: toolCallsCount,
        steps: steps
    };
}

// Zip/Unzip utils using standard Node zlib & tar/zip system fallback or raw zip structure
function createZipArchive(sourceDir, outputFile, manifestData) {
    const outputAbs = path.resolve(outputFile);
    const sourceAbs = path.resolve(sourceDir);

    if (!fs.existsSync(sourceAbs)) {
        return { success: false, message: `Session directory not found: ${sourceDir}` };
    }

    // Write temporary manifest.json into source directory before zipping
    const manifestPath = path.join(sourceAbs, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifestData, null, 2), 'utf-8');

    try {
        if (process.platform === 'win32') {
            // Windows PowerShell Compress-Archive fallback
            const psCmd = `powershell -Command "Compress-Archive -Path '${sourceAbs}\\*' -DestinationPath '${outputAbs}' -Force"`;
            execSync(psCmd, { stdio: 'ignore' });
        } else {
            // Unix zip fallback
            execSync(`zip -r "${outputAbs}" .`, { cwd: sourceAbs, stdio: 'ignore' });
        }
        // Clean manifest from source directory
        if (fs.existsSync(manifestPath)) fs.unlinkSync(manifestPath);
        return { success: true, path: outputAbs };
    } catch (err) {
        return { success: false, message: err.message };
    }
}

function extractZipArchive(zipFile, targetDir) {
    const zipAbs = path.resolve(zipFile);
    const targetAbs = path.resolve(targetDir);

    if (!fs.existsSync(zipAbs)) {
        return { success: false, message: `Archive file not found: ${zipFile}` };
    }

    if (!fs.existsSync(targetAbs)) {
        fs.mkdirSync(targetAbs, { recursive: true });
    }

    try {
        if (process.platform === 'win32') {
            const psCmd = `powershell -Command "Expand-Archive -Path '${zipAbs}' -DestinationPath '${targetAbs}' -Force"`;
            execSync(psCmd, { stdio: 'ignore' });
        } else {
            execSync(`unzip -o "${zipAbs}" -d "${targetAbs}"`, { stdio: 'ignore' });
        }

        // Generate context summary file
        const contextMdPath = path.join(targetAbs, 'RESTORED_SESSION_CONTEXT.md');
        let manifest = {};
        const manifestFile = path.join(targetAbs, 'manifest.json');
        if (fs.existsSync(manifestFile)) {
            try { manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf-8')); } catch (e) {}
        }

        const contextContent = [
            `# Restored Session Context`,
            `- **Session ID**: \`${manifest.session_id || 'Unknown'}\``,
            `- **Archived At**: \`${manifest.archived_at || 'Unknown'}\``,
            `- **Initial Prompt**: ${manifest.initial_prompt || 'N/A'}`,
            `- **Total Steps**: ${manifest.total_steps || 0}`,
            `- **Tool Calls**: ${manifest.tool_calls_count || 0}`,
            `\n> [!NOTE]\n> Restored automatically by Antigravity Session Archiver (Node.js Engine).\n`
        ].join('\n');

        fs.writeFileSync(contextMdPath, contextContent, 'utf-8');
        return { success: true, path: targetAbs };
    } catch (err) {
        return { success: false, message: err.message };
    }
}

// Archive Session Action
function archiveSession(sessionDir, outputFile, description = "") {
    const sessionPath = path.resolve(sessionDir);
    const sessionId = path.basename(sessionPath);
    const transcriptFile = path.join(sessionPath, '.system_generated', 'logs', 'transcript.jsonl');
    
    const meta = fs.existsSync(transcriptFile) ? parseTranscript(transcriptFile) : { total_steps: 0, user_inputs: [], tool_calls_count: 0 };
    
    const manifest = {
        antigravity_archiver_version: VERSION,
        session_id: sessionId,
        archived_at: new Date().toISOString(),
        description: description || `Archive of Antigravity Session ${sessionId}`,
        total_steps: meta.total_steps,
        user_input_count: meta.user_inputs.length,
        tool_calls_count: meta.tool_calls_count,
        initial_prompt: meta.user_inputs[0] || 'N/A'
    };

    const outPath = outputFile || `session_${sessionId}_${Date.now()}.agarch`;
    console.log(`📦 Archiving session: ${sessionId} ...`);
    const res = createZipArchive(sessionPath, outPath, manifest);
    if (res.success) {
        console.log(`✅ Session successfully archived to: ${res.path}`);
    } else {
        console.error(`❌ Archiving failed: ${res.message}`);
    }
    return res;
}

// List Archives
function getArchivesList(dirPath) {
    const folder = path.resolve(dirPath);
    if (!fs.existsSync(folder)) return [];
    
    const files = fs.readdirSync(folder).filter(f => f.endsWith('.agarch') || f.endsWith('.zip'));
    return files.map(f => {
        const filePath = path.join(folder, f);
        const stats = fs.statSync(filePath);
        return {
            filename: f,
            filepath: filePath,
            size_bytes: stats.size,
            size_mb: (stats.size / (1024 * 1024)).toFixed(2),
            session_id: f.replace('.agarch', '').replace('.zip', ''),
            archived_at: stats.mtime.toISOString()
        };
    });
}

// Export Markdown Report
function exportMarkdown(transcriptPath, outputPath) {
    const parsed = parseTranscript(transcriptPath);
    const lines = [
        `# Antigravity Session Transcript Report`,
        `- **File**: \`${path.basename(transcriptPath)}\``,
        `- **Total Steps**: ${parsed.total_steps}`,
        `- **User Prompts**: ${parsed.user_inputs.length}`,
        `- **Tool Executions**: ${parsed.tool_calls_count}`,
        `\n---\n`
    ];

    parsed.steps.forEach((step, idx) => {
        lines.push(`### Step ${idx + 1}: [${step.type || 'UNKNOWN'}] (Source: ${step.source || ''})`);
        if (step.content) lines.push(`\n${step.content}\n`);
        if (step.tool_calls) {
            lines.push(`**Tool Calls Executed:**`);
            step.tool_calls.forEach(tc => {
                const name = tc.name || (tc.function && tc.function.name) || 'tool';
                const args = JSON.stringify(tc.args || tc.arguments || {}, null, 2);
                lines.push(`\`\`\`json\n// Call: ${name}\n${args}\n\`\`\``);
            });
        }
        lines.push(`\n---\n`);
    });

    fs.writeFileSync(outputPath, lines.join('\n'), 'utf-8');
    console.log(`📄 Exported transcript report to: ${outputPath}`);
    return { success: true, path: outputPath };
}

// Web UI Dashboard Server
function startWebUI(dirPath = ".", port = 8080) {
    const server = http.createServer((req, res) => {
        const parsedUrl = new URL(req.url, `http://localhost:${port}`);
        
        if (req.method === 'GET' && (parsedUrl.pathname === '/' || parsedUrl.pathname === '/index.html')) {
            const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title>Antigravity 2.0 会话归档面板 (Node.js Engine)</title>
    <style>
        body { background: #0f172a; color: #f8fafc; font-family: system-ui; padding: 24px; }
        .title { font-size: 24px; font-weight: bold; color: #38bdf8; margin-bottom: 20px; }
        .card { background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 16px; margin-bottom: 12px; }
        .btn { background: #38bdf8; color: #000; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: bold; }
    </style>
</head>
<body>
    <div class="title">🚀 Antigravity 2.0 会话归档仪表盘 (Node.js 原生免配置引擎)</div>
    <div id="archives">加载中...</div>
    <script>
        fetch('/api/archives').then(r => r.json()).then(data => {
            const el = document.getElementById('archives');
            if(data.length === 0) { el.innerHTML = '暂无归档包'; return; }
            el.innerHTML = data.map(a => '<div class="card"><b>' + a.filename + '</b> (' + a.size_mb + ' MB)<br><small>' + a.archived_at + '</small></div>').join('');
        });
    </script>
</body>
</html>`;
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(html);
        } else if (req.method === 'GET' && parsedUrl.pathname === '/api/archives') {
            const list = getArchivesList(dirPath);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(list));
        } else {
            res.writeHead(404);
            res.end('Not Found');
        }
    });

    server.listen(port, '127.0.0.1', () => {
        const url = `http://127.0.0.1:${port}`;
        console.log(`🚀 Node.js Web UI Dashboard running at: ${url}`);
        if (process.platform === 'win32') exec(`start ${url}`);
        else if (process.platform === 'darwin') exec(`open ${url}`);
        else exec(`xdg-open ${url}`);
    });
}

// CLI Command Parser
function main() {
    const args = process.argv.slice(2);
    if (args.includes('--ui')) {
        startWebUI('.', 8080);
    } else if (args.includes('--list')) {
        console.log(getArchivesList('.'));
    } else if (args.includes('--archive')) {
        const sessionIdx = args.indexOf('--session-dir');
        const outIdx = args.indexOf('--output');
        const sessionDir = sessionIdx !== -1 ? args[sessionIdx + 1] : null;
        const output = outIdx !== -1 ? args[outIdx + 1] : null;
        if (!sessionDir) return console.log('[Error] --session-dir is required');
        archiveSession(sessionDir, output);
    } else if (args.includes('--restore')) {
        const inputIdx = args.indexOf('--input');
        const outIdx = args.indexOf('--output');
        const input = inputIdx !== -1 ? args[inputIdx + 1] : null;
        const output = outIdx !== -1 ? args[outIdx + 1] : null;
        if (!input || !output) return console.log('[Error] --input and --output required');
        extractZipArchive(input, output);
    } else {
        console.log("Antigravity 2.0 Session Archiver (Node.js Engine)");
        console.log("Usage: node session_archiver.js [--ui | --archive | --restore | --list]");
    }
}

main();
