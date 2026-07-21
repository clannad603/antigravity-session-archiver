#!/usr/bin/env node
/**
 * Antigravity 2.0 Electron Native Sidebar Injector & Auto-Launcher (`inject.js`)
 * 
 * Features:
 * 1. Safe Unicode DOM Insertion (Zero Garbled Characters).
 * 2. Instant Context & Breakpoint Auto-Fill Hook (Guaranteed Session Continuation).
 * 3. Line-1 AutoUpdater Suppressor.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function findResourcesDir() {
    const home = process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\Default';
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');

    const candidates = [
        path.join(localAppData, 'Programs', 'antigravity', 'resources'),
        path.join(localAppData, 'Programs', 'Antigravity', 'resources'),
        '/Applications/Antigravity.app/Contents/Resources',
        '/opt/Antigravity/resources'
    ];

    for (const c of candidates) {
        if (fs.existsSync(c)) return c;
    }
    return null;
}

const SIDEBAR_PRELOAD_SNIPPET = `
// =========================================================================
// Antigravity 2.0 Session Archiver - Native Sidebar Hook & Auto Injection
// =========================================================================
(function() {
    if (typeof window === 'undefined') return;

    // Listen for real-restore success events from the dashboard iframe.
    // The dashboard calls UpdateConversationAnnotations via the LS API directly,
    // so there is no clipboard/input-box injection here — only a toast confirmation.
    window.addEventListener('message', function(event) {
        if (event.data && event.data.type === 'RESTORE_SESSION_SUCCESS') {
            showParentGradientToast('✨ 会话已通过官方 LS API 恢复，刷新侧栏即可看到。');
            setTimeout(function() {
                const modal = document.getElementById('agy-archive-modal');
                if (modal) modal.style.display = 'none';
            }, 1200);
        }
    });

    function showParentGradientToast(msg) {
        let toast = document.getElementById('agy-parent-gradient-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'agy-parent-gradient-toast';
            toast.style.cssText = 'position:fixed; top:28px; left:50%; transform:translateX(-50%) translateY(-20px); background:linear-gradient(135deg, rgba(16, 185, 129, 0.95), rgba(56, 189, 248, 0.95)); color:#ffffff; font-weight:bold; padding:14px 32px; border-radius:14px; font-size:14px; box-shadow:0 12px 40px rgba(16, 185, 129, 0.45); z-index:9999999; backdrop-filter:blur(12px); border:1px solid rgba(255,255,255,0.25); opacity:0; transition:all 0.35s cubic-bezier(0.34, 1.56, 0.64, 1); pointer-events:none; text-align:center; max-width:85%;';
            document.body.appendChild(toast);
        }
        toast.innerText = msg;
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(-50%) translateY(0)';

        setTimeout(function() {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(-50%) translateY(-20px)';
        }, 3600);
    }

    function initArchiverSidebarHook() {
        function getActiveProjectName() {
            const activeEl = document.querySelector('[class*="active"], [class*="selected"], [aria-selected="true"]');
            if (activeEl) {
                const text = activeEl.innerText || activeEl.textContent || '';
                if (text && text.length < 40) return text.trim();
            }
            const documentTitle = document.title || '';
            if (documentTitle.includes('-')) {
                return documentTitle.split('-')[0].trim();
            }
            return '';
        }

        function tryInjectSidebar() {
            if (document.getElementById('agy-sidebar-archive-item')) return;

            const allElements = Array.from(document.querySelectorAll('*'));
            
            const targetElement = allElements.find(function(el) {
                const text = (el.innerText || el.textContent || '').trim();
                return (text === 'Scheduled Tasks' || text === 'Conversation History' || text === 'Conversations') && el.children.length <= 2;
            });

            if (!targetElement) return;

            let itemContainer = targetElement;
            while (itemContainer && itemContainer.parentElement && itemContainer.parentElement.children.length <= 5) {
                if (itemContainer.tagName === 'A' || itemContainer.tagName === 'BUTTON' || itemContainer.getAttribute('role') === 'button' || (itemContainer.className && typeof itemContainer.className === 'string' && (itemContainer.className.includes('item') || itemContainer.className.includes('button')))) {
                    break;
                }
                itemContainer = itemContainer.parentElement;
            }

            if (!itemContainer || !itemContainer.parentElement) return;

            const clone = itemContainer.cloneNode(true);
            clone.id = 'agy-sidebar-archive-item';
            clone.style.cursor = 'pointer';
            
            const walk = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT, null, false);
            const textNodes = [];
            let n;
            while (n = walk.nextNode()) {
                if (n.nodeValue && n.nodeValue.trim()) textNodes.push(n);
            }
            
            if (textNodes.length > 0) {
                textNodes[textNodes.length - 1].nodeValue = ' Archived Sessions (归档会话)';
            }
            
            const svg = clone.querySelector('svg');
            if (svg) {
                const iconSpan = document.createElement('span');
                iconSpan.innerHTML = '📦 ';
                iconSpan.style.marginRight = '6px';
                iconSpan.style.fontSize = '14px';
                svg.parentNode.replaceChild(iconSpan, svg);
            }

            clone.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                const activeProject = getActiveProjectName();
                openArchivedDashboardModal(activeProject);
            });

            itemContainer.parentElement.appendChild(clone);
            console.log('[Archiver] Injected Archived Sessions into official Agent sidebar!');
        }

        function openArchivedDashboardModal(projectName) {
            projectName = projectName || '';
            let modal = document.getElementById('agy-archive-modal');
            const targetUrl = 'http://127.0.0.1:8080' + (projectName ? '?project=' + encodeURIComponent(projectName) : '');

            if (!modal) {
                modal = document.createElement('div');
                modal.id = 'agy-archive-modal';
                modal.style.cssText = 'position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(11,15,25,0.82); backdrop-filter:blur(10px); z-index:999999; display:flex; justify-content:center; align-items:center;';
                modal.innerHTML = '' +
                    '<div style="width:92%; height:90%; background:#0b0f19; border-radius:14px; border:1px solid #2e3b52; overflow:hidden; display:flex; flex-direction:column; box-shadow:0 20px 50px rgba(0,0,0,0.8);">' +
                        '<div style="display:flex; justify-content:space-between; align-items:center; padding:14px 24px; background:#151c2c; border-bottom:1px solid #2e3b52;">' +
                            '<div style="color:#38bdf8; font-weight:bold; font-size:16px;">📦 Antigravity 2.0 Agent 会话归档解封中心</div>' +
                            '<button id="agy-modal-close" style="background:none; border:none; color:#fff; font-size:22px; cursor:pointer;">✕</button>' +
                        '</div>' +
                        '<iframe id="agy-modal-iframe" src="' + targetUrl + '" style="width:100%; height:100%; border:none;"></iframe>' +
                    '</div>';
                document.body.appendChild(modal);
                document.getElementById('agy-modal-close').onclick = function() {
                    modal.style.display = 'none';
                };
            } else {
                const iframe = document.getElementById('agy-modal-iframe');
                if (iframe) {
                    // 强制重载 iframe：先设 about:blank 清空，下一帧再设目标 URL。
                    // 浏览器对相同 src 不会触发重新加载，会导致重新打开 modal 时
                    // 看到上次离开时的旧状态（可能是出错状态），而不是重新请求后端。
                    iframe.src = 'about:blank';
                    setTimeout(function() { iframe.src = targetUrl; }, 50);
                }
            }
            modal.style.display = 'flex';
        }

        const obs = new MutationObserver(tryInjectSidebar);
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function() {
                obs.observe(document.body, { childList: true, subtree: true });
                tryInjectSidebar();
            });
        } else {
            obs.observe(document.body, { childList: true, subtree: true });
            tryInjectSidebar();
        }
    }

    try { initArchiverSidebarHook(); } catch(e) {}
})();
`;

const MAIN_STARTUP_SNIPPET = `
// Prepend AutoUpdater Suppressor & Archiver Daemon at Line 1
try {
    const { autoUpdater } = require('electron-updater');
    if (autoUpdater) {
        autoUpdater.autoDownload = false;
        autoUpdater.autoInstallOnAppQuit = false;
        autoUpdater.checkForUpdates = () => Promise.resolve(null);
        autoUpdater.checkForUpdatesAndNotify = () => Promise.resolve(null);
    }
} catch(e) {}

try {
    const { fork } = require('child_process');
    const fs = require('fs');
    const archiverScript = 'd:/workspaces/antigravity-session-archiver/scripts/session_archiver.js';
    if (fs.existsSync(archiverScript)) {
        fork(archiverScript, ['--ui', '--daemon', '--port', '8080'], {
            detached: true,
            stdio: 'ignore'
        }).unref();
        console.log('[Archiver Daemon] Spawned archiver backend service on port 8080');
    }
} catch(e) {}
`;

function install() {
    const resDir = findResourcesDir();
    if (!resDir) return false;

    const asarPath = path.join(resDir, 'app.asar');
    const bakPath = path.join(resDir, 'app.asar.bak');
    const extractDir = path.join(resDir, 'app_extracted');

    if (!fs.existsSync(asarPath)) return false;

    if (!fs.existsSync(bakPath)) {
        fs.copyFileSync(asarPath, bakPath);
    }

    try {
        if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true, force: true });
        execSync(`npx -y asar extract "${asarPath}" "${extractDir}"`, { stdio: 'inherit' });

        const mainPath = path.join(extractDir, 'dist', 'main.js');
        if (fs.existsSync(mainPath)) {
            let mainContent = fs.readFileSync(mainPath, 'utf-8');
            if (!mainContent.includes('[Archiver Daemon]')) {
                if (mainContent.startsWith('"use strict";')) {
                    mainContent = '"use strict";\n' + MAIN_STARTUP_SNIPPET + mainContent.substring(12);
                } else {
                    mainContent = MAIN_STARTUP_SNIPPET + '\n' + mainContent;
                }
                fs.writeFileSync(mainPath, mainContent, 'utf-8');
            }
        }

        const preloadPath = path.join(extractDir, 'dist', 'preload.js');
        if (fs.existsSync(preloadPath)) {
            let preloadContent = fs.readFileSync(preloadPath, 'utf-8');
            const hookMarker = '// =========================================================================\n// Antigravity 2.0 Session Archiver';
            if (preloadContent.includes('Archived Sessions')) {
                const idx = preloadContent.indexOf(hookMarker);
                if (idx !== -1) {
                    preloadContent = preloadContent.substring(0, idx).trim();
                }
            }
            preloadContent += '\n' + SIDEBAR_PRELOAD_SNIPPET;
            fs.writeFileSync(preloadPath, preloadContent, 'utf-8');
        }

        execSync(`npx -y asar pack "${extractDir}" "${asarPath}"`, { stdio: 'inherit' });
        fs.rmSync(extractDir, { recursive: true, force: true });

        console.log(`🎉 SUCCESS! Clean Safe Unicode Injection completed!`);
        return true;
    } catch (err) {
        console.error("❌ Injection failed:", err.message);
        return false;
    }
}

function uninstall() {
    const resDir = findResourcesDir();
    if (!resDir) return false;
    const asarPath = path.join(resDir, 'app.asar');
    const bakPath = path.join(resDir, 'app.asar.bak');
    if (fs.existsSync(bakPath)) {
        fs.copyFileSync(bakPath, asarPath);
        fs.unlinkSync(bakPath);
    }
    return true;
}

function main() {
    const args = process.argv.slice(2);
    if (args.includes('--install')) {
        install();
    } else if (args.includes('--uninstall')) {
        uninstall();
    }
}

main();
