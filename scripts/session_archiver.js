#!/usr/bin/env node
/**
 * Antigravity 2.0 Session Archiver Backend Service & Web Dashboard (`session_archiver.js`)
 *
 * Features:
 * 1. Real Restoration via official Language Server gRPC-Web API:
 *    - Calls JetboxSubscribeToSummaries to list all sessions (including archived ones).
 *    - Calls UpdateConversationAnnotations with {archived:false} to truly restore a session
 *      back to the official Antigravity sidebar.
 * 2. Project-aware filtering: sessions are grouped by workspace folder URI.
 * 3. Zero data fabrication: every field comes directly from the LS API response.
 *
 * NOTE: This requires the Antigravity client to be running (LS must be alive).
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const url = require('url');

const PORT = 8080;
const USER_PROFILE = process.env.USERPROFILE || process.env.HOME || os.homedir();
const ANTIGRAVITY_DIR = path.join(USER_PROFILE, '.gemini', 'antigravity');
const DEVTOOLS_PORT_FILE = path.join(USER_PROFILE, 'AppData', 'Roaming', 'Antigravity', 'DevToolsActivePort');

// LS uses a self-signed certificate for 127.0.0.1; disable TLS verification for our local calls.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

let cacheData = null;
let cacheTime = 0;
const CACHE_TTL_MS = 2000;

// ---------------------------------------------------------------------------
// Language Server client (gRPC-Web JSON mode, connect-es compatible)
// ---------------------------------------------------------------------------

/**
 * Read the CDP port from DevToolsActivePort file (line 1, written by Electron).
 * The LS HTTP port is NOT a fixed offset from CDP — earlier builds used CDP+1,
 * newer builds use CDP+3 or other offsets. We probe a small range around CDP
 * and return the first port whose HTTPS index page contains a csrfToken.
 * 缓存最近一次成功探测的端口，避免每次请求都扫描；失效时自动重试。
 */
let _cachedLsPort = null;
let _cachedLsPortCdp = null;

function readCdpPort() {
    try {
        const content = fs.readFileSync(DEVTOOLS_PORT_FILE, 'utf-8').trim();
        const cdpPort = parseInt(content.split('\n')[0], 10);
        if (!Number.isFinite(cdpPort) || cdpPort <= 0) return null;
        return cdpPort;
    } catch (e) {
        return null;
    }
}

async function probeLsPort(candidatePort) {
    try {
        const r = await fetch(`https://127.0.0.1:${candidatePort}/`, {
            signal: AbortSignal.timeout(1500)
        });
        if (!r.ok) return false;
        const txt = await r.text();
        return /"csrfToken"\s*:/.test(txt);
    } catch (e) {
        return false;
    }
}

async function getLsPort() {
    const cdpPort = readCdpPort();
    if (!cdpPort) {
        _cachedLsPort = null;
        _cachedLsPortCdp = null;
        return null;
    }
    // Same CDP port as last time → reuse cached LS port.
    if (_cachedLsPort && _cachedLsPortCdp === cdpPort) {
        // Quick liveness check; if it fails, fall through to re-scan.
        if (await probeLsPort(_cachedLsPort)) return _cachedLsPort;
        _cachedLsPort = null;
    }
    // Scan a window around CDP. Empirically LS lands within ±0..8 of CDP.
    // Try CDP+1 first (old builds), then expand outward.
    const offsets = [1, 3, 2, 4, 5, 6, 7, 8, 0];
    for (const off of offsets) {
        const candidate = cdpPort + off;
        if (candidate <= 0 || candidate > 65535) continue;
        if (await probeLsPort(candidate)) {
            _cachedLsPort = candidate;
            _cachedLsPortCdp = cdpPort;
            return candidate;
        }
    }
    return null;
}

/**
 * Fetch the CSRF token by reading window.__APP_CONFIG__ from the LS-served index page.
 * The token changes on every LS restart, so we fetch it fresh on every request.
 */
async function getCsrfToken(lsPort) {
    const res = await fetch(`https://127.0.0.1:${lsPort}/`);
    const html = await res.text();
    const m = html.match(/"csrfToken":"([^"]+)"/);
    if (!m) throw new Error('CSRF token not found in LS index page');
    return m[1];
}

/**
 * Frame a JSON object as a gRPC-Web unary message (5-byte header + JSON payload).
 * Flag byte 0 = uncompressed. 4-byte big-endian length.
 */
function grpcWebJsonFrame(obj) {
    const payload = Buffer.from(JSON.stringify(obj), 'utf-8');
    const frame = Buffer.alloc(5);
    frame.writeUInt8(0, 0);
    frame.writeUInt32BE(payload.length, 1);
    return Buffer.concat([frame, payload]);
}

/**
 * Call a LanguageServerService method. Reads the first gRPC-Web frame and parses JSON.
 * For streaming RPCs (like JetboxSubscribeToSummaries), only the first frame is consumed.
 */
async function callLsMethod(lsPort, csrfToken, method, requestBody, { stream = false } = {}) {
    const target = `https://127.0.0.1:${lsPort}/exa.language_server_pb.LanguageServerService/${method}`;
    const controller = new AbortController();
    const res = await fetch(target, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/grpc-web+json',
            'X-Grpc-Web': '1',
            'X-User-Agent': 'CONNECT_ES_USER_AGENT',
            'x-codeium-csrf-token': csrfToken
        },
        body: grpcWebJsonFrame(requestBody || {}),
        signal: controller.signal
    });

    if (!res.ok && res.status !== 200) {
        throw new Error(`LS ${method} returned HTTP ${res.status}`);
    }

    if (!stream) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length === 0) return {}; // empty unary response (e.g. UpdateConversationAnnotations)
        if (buf.length < 5) throw new Error('LS response too short');
        const flag = buf.readUInt8(0);
        const len = buf.readUInt32BE(1);
        const jsonStr = buf.slice(5, 5 + len).toString('utf-8');
        return JSON.parse(jsonStr);
    }

    // Streaming: read first frame then abort
    const reader = res.body.getReader();
    const chunks = [];
    let totalLen = 0;
    const abortTimer = setTimeout(() => controller.abort(), 3000);
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            totalLen += value.length;
            // First frame of JetboxSubscribeToSummaries contains all current sessions.
            // Once we have a complete frame, stop reading.
            if (totalLen > 5) {
                const probe = Buffer.concat(chunks);
                if (probe.length >= 5) {
                    const len = probe.readUInt32BE(1);
                    if (probe.length >= 5 + len) break;
                }
            }
            if (totalLen > 2000000) break;
        }
    } catch (e) {
        // abort is expected
    }
    clearTimeout(abortTimer);

    const buf = Buffer.concat(chunks);
    if (buf.length < 5) throw new Error('LS stream response too short');
    const flag = buf.readUInt8(0);
    const len = buf.readUInt32BE(1);
    const jsonStr = buf.slice(5, 5 + len).toString('utf-8');
    return JSON.parse(jsonStr);
}

/**
 * List all conversations (including archived) by calling JetboxSubscribeToSummaries.
 * Returns an array of normalized session objects with full detail fields.
 * Subagent sessions are excluded by default (they are children of main sessions
 * and should not appear as standalone entries in the sidebar).
 */
async function listAllSessions(includeSubagents = false) {
    const lsPort = await getLsPort();
    if (!lsPort) {
        throw new Error('Antigravity is not running. Please launch the Antigravity client first.');
    }
    const csrfToken = await getCsrfToken(lsPort);
    const data = await callLsMethod(lsPort, csrfToken, 'JetboxSubscribeToSummaries', {}, { stream: true });
    const updates = data.updates || {};
    const sessions = [];
    for (const cascadeId of Object.keys(updates)) {
        const s = updates[cascadeId];
        const ann = s.annotations || {};
        const meta = s.trajectoryMetadata || {};
        const isSubagent = !!(meta.subagentSpec || meta.parentConversationId);
        if (isSubagent && !includeSubagents) continue;
        const workspace = (s.workspaces && s.workspaces[0]) || (meta.workspaces && meta.workspaces[0]) || {};
        const projectUri = workspace.workspaceFolderAbsoluteUri || '';
        const projectPath = projectUri ? decodeURIComponent(projectUri.replace(/^file:\/\/\//, '')) : '';
        const projectName = projectPath ? path.basename(projectPath) : (workspace.repository && workspace.repository.computedName ? workspace.repository.computedName : 'Unlinked');
        const repo = workspace.repository || {};
        sessions.push({
            sessionId: cascadeId,
            title: ann.title || s.summary || ('Untitled ' + cascadeId.substring(0, 8)),
            summary: s.summary || '',
            projectName: projectName,
            projectPath: projectPath,
            archived: ann.archived === true,
            isSubagent: isSubagent,
            parentConversationId: meta.parentConversationId || '',
            updatedAt: s.lastModifiedTime ? Date.parse(s.lastModifiedTime) : (s.createdTime ? Date.parse(s.createdTime) : 0),
            updatedAtStr: s.lastModifiedTime ? new Date(s.lastModifiedTime).toISOString() : '',
            createdAtStr: s.createdTime || (meta.createdAt || ''),
            lastUserInputTimeStr: s.lastUserInputTime || '',
            lastUserInputStepIndex: s.lastUserInputStepIndex ?? -1,
            stepCount: s.stepCount || 0,
            status: s.status || '',
            killed: s.killed === true,
            trajectoryType: s.trajectoryType || '',
            branchName: workspace.branchName || '',
            gitOriginUrl: repo.gitOriginUrl || '',
            repoComputedName: repo.computedName || '',
            projectId: meta.projectId || ''
        });
    }
    sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    return sessions;
}

/**
 * Restore a session by setting annotations.archived = false via the official LS API.
 */
async function restoreSession(cascadeId) {
    const lsPort = await getLsPort();
    if (!lsPort) {
        throw new Error('Antigravity is not running. Please launch the Antigravity client first.');
    }
    const csrfToken = await getCsrfToken(lsPort);
    await callLsMethod(lsPort, csrfToken, 'UpdateConversationAnnotations', {
        cascadeId: cascadeId,
        annotations: { archived: false },
        mergeAnnotations: true
    });
    cacheData = null; // invalidate cache so next /api/sessions reflects the change
    return true;
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    if (pathname === '/api/sessions') {
        (async () => {
            try {
                const includeSubagents = parsedUrl.query.includeSubagents === '1' || parsedUrl.query.includeSubagents === 'true';
                const now = Date.now();
                if (cacheData && (now - cacheTime < CACHE_TTL_MS) && cacheData._includeSubagents === includeSubagents) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, sessions: cacheData.sessions }));
                    return;
                }
                const sessions = await listAllSessions(includeSubagents);
                cacheData = { sessions, _includeSubagents: includeSubagents };
                cacheTime = now;
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, sessions: sessions }));
            } catch (e) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: e.message, sessions: [] }));
            }
        })();
        return;
    }

    if (pathname === '/api/restore' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            (async () => {
                try {
                    const data = JSON.parse(body);
                    const { sessionId } = data;
                    if (!sessionId) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, error: 'Missing sessionId' }));
                        return;
                    }
                    await restoreSession(sessionId);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, restored: true }));
                } catch (e) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: e.message }));
                }
            })();
        });
        return;
    }

    if (pathname === '/' || pathname === '/index.html') {
        res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
        });
        res.end(DASHBOARD_HTML);
        return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
});

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
    <meta http-equiv="Pragma" content="no-cache">
    <meta http-equiv="Expires" content="0">
    <title>Antigravity Session Archive Center</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { height: 100%; }
        body { background: #0b0f19; color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 20px; display: flex; flex-direction: column; }
        .header { display: flex; justify-content: space-between; align-items: center; padding-bottom: 16px; border-bottom: 1px solid #1e293b; margin-bottom: 16px; }
        .title { font-size: 18px; font-weight: bold; color: #38bdf8; display: flex; align-items: center; gap: 8px; }
        .sub-title { font-size: 13px; color: #94a3b8; margin-top: 4px; }
        .header-right { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
        .lang-switch { display: flex; gap: 4px; }
        .lang-btn { background: #1e293b; color: #94a3b8; border: 1px solid #334155; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 11px; }
        .lang-btn.active { background: #0284c7; color: #fff; border-color: #38bdf8; }

        .tabs { display: flex; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
        .tab-btn { background: #1e293b; color: #94a3b8; border: 1px solid #334155; padding: 8px 16px; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: bold; transition: all 0.2s; }
        .tab-btn:hover { background: #334155; color: #fff; }
        .tab-btn.active { background: #0284c7; color: #fff; border-color: #38bdf8; box-shadow: 0 0 12px rgba(56,189,248,0.3); }

        .toolbar { display: flex; gap: 12px; margin-bottom: 12px; align-items: center; flex-wrap: wrap; }
        .search-input { flex: 1; min-width: 200px; background: #151c2c; border: 1px solid #334155; color: #fff; padding: 10px 14px; border-radius: 8px; font-size: 14px; }
        .search-input:focus { outline: none; border-color: #38bdf8; }
        .toggle-label { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #94a3b8; cursor: pointer; }
        .toggle-label input { cursor: pointer; }

        .card-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding-right: 6px; }
        .card { background: #151c2c; border: 1px solid #1e293b; border-radius: 10px; transition: all 0.2s; overflow: hidden; flex-shrink: 0; }
        .card:hover { border-color: #38bdf8; }
        .card-row { display: flex; justify-content: space-between; align-items: center; padding: 14px 16px; }
        .card-left { display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 0; padding-right: 12px; }
        .card-title { font-size: 15px; font-weight: bold; color: #f8fafc; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
        .card-title:hover { color: #38bdf8; }
        .card-meta { font-size: 12px; color: #64748b; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
        .tag { padding: 2px 8px; border-radius: 4px; font-size: 11px; white-space: nowrap; }
        .tag-project { background: rgba(56, 189, 248, 0.15); color: #38bdf8; }
        .tag-archived { background: rgba(239, 68, 68, 0.2); color: #f87171; }
        .tag-active { background: rgba(16, 185, 129, 0.2); color: #34d399; }
        .tag-subagent { background: rgba(168, 85, 247, 0.2); color: #c084fc; }
        .tag-killed { background: rgba(234, 179, 8, 0.2); color: #facc15; }

        .btn-action { background: #0284c7; color: #fff; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: bold; transition: all 0.2s; white-space: nowrap; }
        .btn-action:hover { background: #0369a1; transform: scale(1.02); }
        .btn-action:disabled { background: #334155; cursor: not-allowed; transform: none; }
        .btn-action.restoring { opacity: 0.6; cursor: wait; }

        .card-detail { background: #0f172a; border-top: 1px solid #1e293b; padding: 14px 16px; font-size: 12px; color: #94a3b8; display: none; }
        .card-detail.open { display: block; }
        .detail-grid { display: grid; grid-template-columns: 130px 1fr; gap: 6px 12px; }
        .detail-label { color: #64748b; }
        .detail-value { color: #cbd5e1; word-break: break-all; }
        .detail-summary { margin-top: 10px; padding-top: 10px; border-top: 1px dashed #1e293b; color: #cbd5e1; line-height: 1.6; }

        .empty-state { text-align: center; color: #64748b; padding: 40px 20px; font-size: 14px; }
        .error-state { text-align: center; color: #f87171; padding: 40px 20px; font-size: 14px; line-height: 1.6; }
    </style>
</head>
<body>
    <div class="header">
        <div>
            <div class="title" id="hdr-title">📦 Antigravity Archive Center</div>
            <div class="sub-title" id="hdr-sub">Restore archived sessions to sidebar via official Language Server API</div>
        </div>
        <div class="header-right">
            <div class="lang-switch">
                <button class="lang-btn active" id="lang-zh" onclick="switchLang('zh')">中文</button>
                <button class="lang-btn" id="lang-en" onclick="switchLang('en')">EN</button>
            </div>
            <div id="stat-info" style="font-size:12px; color:#64748b;"></div>
        </div>
    </div>

    <div class="tabs">
        <button class="tab-btn active" id="tab-archived" onclick="switchTab('archived')"></button>
        <button class="tab-btn" id="tab-active" onclick="switchTab('active')"></button>
        <button class="tab-btn" id="tab-all" onclick="switchTab('all')"></button>
    </div>

    <div class="toolbar">
        <input type="text" class="search-input" id="search-input" oninput="renderList()">
        <label class="toggle-label"><input type="checkbox" id="show-subagents" onchange="fetchSessions()"> <span id="lbl-subagents"></span></label>
    </div>

    <div class="card-list" id="card-list"></div>

    <script>
        // ---- i18n ----
        const I18N = {
            zh: {
                title: '📦 Antigravity 归档会话恢复中心',
                sub: '通过官方 Language Server API 将归档会话真正恢复至侧边栏',
                loading: '加载中...',
                loadFail: '加载失败',
                tabArchived: '📦 已归档',
                tabActive: '⚡ 侧栏活跃',
                tabAll: '📂 全部主会话',
                search: '🔍 搜索标题、工程名称...',
                showSubagents: '含子代理会话',
                restore: '↺ 恢复至侧栏',
                restoring: '恢复中...',
                inSidebar: '已在侧栏',
                restoreFail: '恢复失败',
                unknownErr: '未知错误',
                empty: '当前分类暂无会话。',
                archivedTag: '已归档',
                activeTag: '侧栏活跃',
                subagentTag: '子代理',
                killedTag: '已中断',
                steps: '轮',
                statAll: '全量: 已归档',
                statProj: '工程',
                statSep: '活跃',
                statUnit: '条',
                detailCreated: '创建时间',
                detailModified: '最后修改',
                detailLastInput: '最后用户输入',
                detailSteps: '对话轮数',
                detailStatus: '运行状态',
                detailBranch: 'Git 分支',
                detailRepo: 'Git 仓库',
                detailProject: '工程路径',
                detailSessionId: '会话 ID',
                detailSummary: '会话摘要',
                detailType: '轨迹类型',
                detailParent: '父会话 ID',
                statusIdle: '空闲',
                statusRunning: '运行中',
                statusComplete: '已完成',
                statusKilled: '已中断',
                clickDetail: '点击标题展开详情',
                restoredToast: '✨ 会话已通过官方 LS API 恢复，刷新侧栏即可看到。'
            },
            en: {
                title: '📦 Antigravity Archive Center',
                sub: 'Restore archived sessions to sidebar via official Language Server API',
                loading: 'Loading...',
                loadFail: 'Load failed',
                tabArchived: '📦 Archived',
                tabActive: '⚡ Sidebar Active',
                tabAll: '📂 All Main Sessions',
                search: '🔍 Search title, project...',
                showSubagents: 'Include subagents',
                restore: '↺ Restore to Sidebar',
                restoring: 'Restoring...',
                inSidebar: 'In Sidebar',
                restoreFail: 'Restore failed',
                unknownErr: 'Unknown error',
                empty: 'No sessions in this category.',
                archivedTag: 'Archived',
                activeTag: 'Active',
                subagentTag: 'Subagent',
                killedTag: 'Killed',
                steps: 'steps',
                statAll: 'Total: archived',
                statProj: 'Project',
                statSep: 'active',
                statUnit: '',
                detailCreated: 'Created',
                detailModified: 'Last modified',
                detailLastInput: 'Last user input',
                detailSteps: 'Step count',
                detailStatus: 'Status',
                detailBranch: 'Git branch',
                detailRepo: 'Git repo',
                detailProject: 'Project path',
                detailSessionId: 'Session ID',
                detailSummary: 'Summary',
                detailType: 'Trajectory type',
                detailParent: 'Parent conversation',
                statusIdle: 'Idle',
                statusRunning: 'Running',
                statusComplete: 'Complete',
                statusKilled: 'Killed',
                clickDetail: 'Click title to expand details',
                restoredToast: '✨ Session restored via official LS API. Refresh sidebar to see it.'
            }
        };

        let lang = (new URLSearchParams(window.location.search)).get('lang') || 'zh';
        if (lang !== 'zh' && lang !== 'en') lang = 'zh';
        const t = (k) => (I18N[lang] && I18N[lang][k]) || k;

        let allSessions = [];
        let currentTab = 'archived';
        const filterProject = (new URLSearchParams(window.location.search)).get('project') || '';

        function applyI18n() {
            document.getElementById('hdr-title').innerText = t('title');
            document.getElementById('hdr-sub').innerText = t('sub');
            document.getElementById('search-input').placeholder = t('search');
            document.getElementById('lbl-subagents').innerText = t('showSubagents');
            document.getElementById('tab-archived').innerHTML = t('tabArchived') + ' (<span id="cnt-archived">0</span>)';
            document.getElementById('tab-active').innerHTML = t('tabActive') + ' (<span id="cnt-active">0</span>)';
            document.getElementById('tab-all').innerHTML = t('tabAll') + ' (<span id="cnt-all">0</span>)';
            document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
            document.getElementById('lang-zh').classList.toggle('active', lang === 'zh');
            document.getElementById('lang-en').classList.toggle('active', lang === 'en');
        }

        function switchLang(l) {
            lang = l;
            applyI18n();
            updateCounts();
            renderList();
        }

        async function fetchSessions() {
            const listEl = document.getElementById('card-list');
            listEl.innerHTML = '<div class="empty-state">' + escapeHtml(t('loading')) + '</div>';
            try {
                const includeSub = document.getElementById('show-subagents').checked ? '1' : '0';
                const res = await fetch('/api/sessions?includeSubagents=' + includeSub + '&_t=' + Date.now());
                const data = await res.json();
                if (!data.success) {
                    listEl.innerHTML = '<div class="error-state">' + escapeHtml(data.error || t('loadFail')) + '</div>';
                    document.getElementById('stat-info').innerText = t('loadFail');
                    return;
                }
                allSessions = data.sessions || [];
                updateCounts();
                renderList();
            } catch(e) {
                listEl.innerHTML = '<div class="error-state">' + escapeHtml(e.message) + '</div>';
            }
        }

        function getPartitionedSessions() {
            let list = allSessions;
            if (filterProject) {
                list = list.filter(s => s.projectName.toLowerCase().includes(filterProject.toLowerCase()));
            }
            const archivedList = list.filter(s => s.archived);
            const activeList = list.filter(s => !s.archived);
            return { activeList, archivedList, allList: list };
        }

        function updateCounts() {
            const { activeList, archivedList, allList } = getPartitionedSessions();
            const cA = document.getElementById('cnt-archived');
            const cA2 = document.getElementById('cnt-active');
            const cAll = document.getElementById('cnt-all');
            if (cA) cA.innerText = archivedList.length;
            if (cA2) cA2.innerText = activeList.length;
            if (cAll) cAll.innerText = allList.length;
            document.getElementById('stat-info').innerText = filterProject ?
                (t('statProj') + ' [' + filterProject + ']: ' + t('tabArchived').replace(/^[^\\w]+\\s*/, '') + ' ' + archivedList.length + ' | ' + t('statSep') + ' ' + activeList.length + ' ' + t('statUnit')) :
                (t('statAll') + ' ' + archivedList.length + ' | ' + t('statSep') + ' ' + activeList.length + ' ' + t('statUnit'));
        }

        function switchTab(tab) {
            currentTab = tab;
            document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
            document.getElementById('tab-' + tab).classList.add('active');
            renderList();
        }

        function statusText(s) {
            if (s.killed) return t('statusKilled');
            if (s.status === 'CASCADE_RUN_STATUS_RUNNING') return t('statusRunning');
            if (s.status === 'CASCADE_RUN_STATUS_COMPLETE') return t('statusComplete');
            return t('statusIdle');
        }

        function fmtTime(s) {
            if (!s) return '-';
            try { return new Date(s).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US'); }
            catch(e) { return s; }
        }

        function toggleDetail(sessionId, ev) {
            if (ev) ev.stopPropagation();
            const el = document.getElementById('detail-' + sessionId);
            if (el) el.classList.toggle('open');
        }

        function renderList() {
            const listEl = document.getElementById('card-list');
            const searchKw = document.getElementById('search-input').value.trim().toLowerCase();
            const { activeList, archivedList, allList } = getPartitionedSessions();
            let list = currentTab === 'archived' ? archivedList : (currentTab === 'active' ? activeList : allList);
            if (searchKw) {
                list = list.filter(s => (s.title || '').toLowerCase().includes(searchKw) || (s.projectName || '').toLowerCase().includes(searchKw) || (s.summary || '').toLowerCase().includes(searchKw));
            }
            if (list.length === 0) {
                listEl.innerHTML = '<div class="empty-state">' + escapeHtml(t('empty')) + '</div>';
                return;
            }
            listEl.innerHTML = list.map(s => {
                const tag = s.archived ? '<span class="tag tag-archived">' + escapeHtml(t('archivedTag')) + '</span>' : '<span class="tag tag-active">' + escapeHtml(t('activeTag')) + '</span>';
                const subagentTag = s.isSubagent ? '<span class="tag tag-subagent">' + escapeHtml(t('subagentTag')) + '</span>' : '';
                const killedTag = s.killed ? '<span class="tag tag-killed">' + escapeHtml(t('killedTag')) + '</span>' : '';
                const btnLabel = s.archived ? escapeHtml(t('restore')) : escapeHtml(t('inSidebar'));
                const btnDisabled = !s.archived ? 'disabled' : '';
                return '<div class="card">' +
                    '<div class="card-row">' +
                        '<div class="card-left">' +
                            '<div class="card-title" onclick="toggleDetail(\\'' + s.sessionId + '\\', event)" title="' + escapeHtml(t('clickDetail')) + '">' + escapeHtml(s.title) + '</div>' +
                            '<div class="card-meta">' +
                                '<span class="tag tag-project">' + escapeHtml(s.projectName) + '</span>' +
                                tag + subagentTag + killedTag +
                                '<span>🕒 ' + escapeHtml(fmtTime(s.updatedAtStr)) + '</span>' +
                                '<span>💬 ' + (s.stepCount || 0) + ' ' + escapeHtml(t('steps')) + '</span>' +
                            '</div>' +
                        '</div>' +
                        '<div class="card-right">' +
                            '<button class="btn-action" ' + btnDisabled + ' onclick="restoreSession(\\'' + s.sessionId + '\\', this)">' + btnLabel + '</button>' +
                        '</div>' +
                    '</div>' +
                    '<div class="card-detail" id="detail-' + s.sessionId + '">' +
                        '<div class="detail-grid">' +
                            '<span class="detail-label">' + escapeHtml(t('detailCreated')) + '</span><span class="detail-value">' + escapeHtml(fmtTime(s.createdAtStr)) + '</span>' +
                            '<span class="detail-label">' + escapeHtml(t('detailModified')) + '</span><span class="detail-value">' + escapeHtml(fmtTime(s.updatedAtStr)) + '</span>' +
                            '<span class="detail-label">' + escapeHtml(t('detailLastInput')) + '</span><span class="detail-value">' + escapeHtml(fmtTime(s.lastUserInputTimeStr)) + '</span>' +
                            '<span class="detail-label">' + escapeHtml(t('detailSteps')) + '</span><span class="detail-value">' + (s.stepCount || 0) + '</span>' +
                            '<span class="detail-label">' + escapeHtml(t('detailStatus')) + '</span><span class="detail-value">' + escapeHtml(statusText(s)) + '</span>' +
                            (s.branchName ? '<span class="detail-label">' + escapeHtml(t('detailBranch')) + '</span><span class="detail-value">' + escapeHtml(s.branchName) + '</span>' : '') +
                            (s.gitOriginUrl ? '<span class="detail-label">' + escapeHtml(t('detailRepo')) + '</span><span class="detail-value">' + escapeHtml(s.gitOriginUrl) + '</span>' : '') +
                            (s.projectPath ? '<span class="detail-label">' + escapeHtml(t('detailProject')) + '</span><span class="detail-value">' + escapeHtml(s.projectPath) + '</span>' : '') +
                            (s.trajectoryType ? '<span class="detail-label">' + escapeHtml(t('detailType')) + '</span><span class="detail-value">' + escapeHtml(s.trajectoryType) + '</span>' : '') +
                            (s.parentConversationId ? '<span class="detail-label">' + escapeHtml(t('detailParent')) + '</span><span class="detail-value">' + escapeHtml(s.parentConversationId) + '</span>' : '') +
                            '<span class="detail-label">' + escapeHtml(t('detailSessionId')) + '</span><span class="detail-value">' + escapeHtml(s.sessionId) + '</span>' +
                        '</div>' +
                        (s.summary ? '<div class="detail-summary"><b>' + escapeHtml(t('detailSummary')) + ':</b><br>' + escapeHtml(s.summary) + '</div>' : '') +
                    '</div>' +
                '</div>';
            }).join('');
        }

        async function restoreSession(sessionId, btn) {
            if (btn) { btn.classList.add('restoring'); btn.disabled = true; btn.innerText = t('restoring'); }
            try {
                const res = await fetch('/api/restore', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionId })
                });
                const data = await res.json();
                if (data.success) {
                    window.parent.postMessage({ type: 'RESTORE_SESSION_SUCCESS', sessionId: sessionId }, '*');
                    // Optimistic update: mutate local state directly instead of re-fetching.
                    // Re-fetching immediately after restore can hit streaming-RPC timing issues
                    // (LS still propagating the annotation change) and return stale/empty data.
                    const target = allSessions.find(s => s.sessionId === sessionId);
                    if (target) target.archived = false;
                    updateCounts();
                    renderList();
                } else {
                    alert(t('restoreFail') + ': ' + (data.error || t('unknownErr')));
                    if (btn) { btn.classList.remove('restoring'); btn.disabled = false; btn.innerText = t('restore'); }
                }
            } catch(e) {
                alert(t('restoreFail') + ': ' + e.message);
                if (btn) { btn.classList.remove('restoring'); btn.disabled = false; btn.innerText = t('restore'); }
            }
        }

        function escapeHtml(str) {
            return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        }

        applyI18n();
        fetchSessions();
    </script>
</body>
</html>`;

server.listen(PORT, '127.0.0.1', () => {
    console.log(`[Session Archiver] Server listening on http://127.0.0.1:${PORT}`);
});
