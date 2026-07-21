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

echo [Error] Node.js not found on system PATH. Please install Node.js 22+.
pause

:end
