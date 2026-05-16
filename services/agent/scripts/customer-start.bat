@echo off
chcp 65001 >nul 2>&1
title ZenithJoy Agent

REM Walking Skeleton thin: simplified launcher.
REM Recommended: double-click ../install-and-start.bat instead.
REM This script assumes deps already installed and ZENITHJOY_LICENSE set.

cd /d "%~dp0\.."

if "%ZENITHJOY_LICENSE%"=="" goto :no_license

set CHROME_EXE=
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if "%CHROME_EXE%"=="" if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if "%CHROME_EXE%"=="" if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if "%CHROME_EXE%"=="" goto :no_chrome

start "ZenithJoy Chrome (Agent)" "%CHROME_EXE%" --remote-debugging-port=19222 --user-data-dir="%USERPROFILE%\zenithjoy-chrome-profile"
timeout /t 4 /nobreak >nul 2>&1

set ZENITHJOY_API_BASE=https://autopilot.zenjoymedia.media
set ZENITHJOY_API_URL=wss://autopilot.zenjoymedia.media/agent-ws
set ZENITHJOY_AGENT_REAL_PUBLISH=1

echo Starting agent (keep this window open, watch for tray icon)...
call npm start -- --license=%ZENITHJOY_LICENSE%

echo.
echo Agent stopped. Press any key to close.
pause >nul
exit /b 0


:no_license
echo [ERROR] ZENITHJOY_LICENSE not set.
echo Run install-and-start.bat instead, or set the license env var first.
pause
exit /b 1

:no_chrome
echo [ERROR] Google Chrome not found.
pause
exit /b 2
