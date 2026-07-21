#!/usr/bin/env bash
echo "==================================================="
echo "  Starting Antigravity 2.0 Session Archiver UI  "
echo "==================================================="

if command -v node &> /dev/null; then
    echo "[Info] Launching via Node.js..."
    node "$(dirname "$0")/scripts/session_archiver.js" --ui
else
    echo "[Error] Node.js not found. Please install Node.js 22+."
    exit 1
fi
