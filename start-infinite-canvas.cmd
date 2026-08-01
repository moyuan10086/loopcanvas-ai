@echo off
setlocal EnableExtensions
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-infinite-canvas.ps1" %*
exit /b %errorlevel%
