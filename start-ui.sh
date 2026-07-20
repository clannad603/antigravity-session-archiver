#!/usr/bin/env bash
echo "==================================================="
echo "  Starting Antigravity 2.0 Session Archiver UI...  "
echo "==================================================="

if command -v node &> /dev/null; then
    echo "[Info] Launching via Node.js..."
    node "$(dirname "$0")/scripts/session_archiver.js" --ui
elif command -v python3 &> /dev/null; then
    echo "[Info] Launching via Python3..."
    python3 "$(dirname "$0")/scripts/session_archiver.py" --ui
else
    echo "[Error] Neither Node.js nor Python3 found."
    exit 1
fi
