@echo off
title Antigravity 2.0 Session Archiver Dashboard
echo ===================================================
echo   Starting Antigravity 2.0 Session Archiver UI...
echo ===================================================

where node >nul 2>nul
if %errorlevel% equ 0 (
    echo [Info] Found Node.js engine, starting UI...
    node "%~dp0scripts\session_archiver.js" --ui
    goto :end
)

where python >nul 2>nul
if %errorlevel% equ 0 (
    echo [Info] Found Python engine, starting UI...
    python "%~dp0scripts\session_archiver.py" --ui
    goto :end
)

echo [Error] Neither Node.js nor Python was found on system PATH.
pause

:end
