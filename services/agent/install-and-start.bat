@echo off
title ZenithJoy Agent

REM ============================================================
REM  ZenithJoy Agent - one-click install + start (Windows)
REM  Walking Skeleton thin v0.1
REM  Just double-click this file.
REM ============================================================

cd /d "%~dp0"

echo.
echo  ============================================================
echo    ZenithJoy Agent  /  v0.1 thin
echo  ============================================================
echo.

REM ===== 1) Node.js =====
where node >nul 2>&1
if errorlevel 1 goto :no_node

for /f "tokens=*" %%v in ('node -v') do set NODE_VER=%%v
echo  [1/4] Node.js OK   (%NODE_VER%)
echo.

REM ===== 2) Dependencies =====
REM Strict check: playwright must exist (added in v0.1.5). If old node_modules
REM exists but lacks playwright -> force reinstall to pick up new dependency.
if exist "node_modules\playwright\package.json" goto :deps_ok
echo  [2/4] Installing dependencies (first time or upgrading, 2-5 min)...
echo        ^(includes Playwright for douyin browser automation^)
echo.
call npm install
if errorlevel 1 goto :npm_fail
if not exist "node_modules\playwright\package.json" (
  echo.
  echo  [ERROR] npm install completed but playwright still missing.
  echo  Please report this to support with the npm output above.
  pause
  exit /b 5
)
echo.
echo  [2/4] Dependencies installed (Playwright OK)
echo.
goto :have_deps

:deps_ok
echo  [2/4] Dependencies OK (cached, Playwright present)
echo.

:have_deps

REM ===== 3) License =====
if not "%ZENITHJOY_LICENSE%"=="" goto :have_license
echo  [3/4] Paste your license below
echo        (find on Dashboard - Agent client page; format ZJ-F-XXXXXX)
echo.
set /p ZENITHJOY_LICENSE=        License:

:have_license
if "%ZENITHJOY_LICENSE%"=="" goto :no_license

echo.
echo  [3/4] License OK    %ZENITHJOY_LICENSE%
echo.

REM ===== 4) Find chrome.exe =====
set CHROME_EXE=
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if "%CHROME_EXE%"=="" if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if "%CHROME_EXE%"=="" if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if "%CHROME_EXE%"=="" goto :no_chrome

REM ===== 5) Start Chrome (debug mode) =====
echo  [4/4] Starting Chrome and Agent...
echo.
echo    A new Chrome window will open. Log in to:
echo        https://creator.douyin.com
echo    USE A TEST DOUYIN ACCOUNT (NOT your main one).
echo.
echo    Keep THIS cmd window open - it IS the Agent.
echo.

start "ZenithJoy Chrome (Agent)" "%CHROME_EXE%" --remote-debugging-port=19222 --user-data-dir="%USERPROFILE%\zenithjoy-chrome-profile"

REM Wait 4 sec for Chrome to be ready
ping -n 5 127.0.0.1 >nul

REM ===== 6) Run Agent (foreground) =====
REM Pass license as CLI arg --license=... (agent persists to %APPDATA%\zenithjoy-agent\config.json)
REM Tray icon appears in system tray (bottom-right) on success.
set ZENITHJOY_API_BASE=https://autopilot.zenjoymedia.media
REM Override v1.1 hardcoded ws URL (api.zenithjoy.com is dead) → autopilot.
set ZENITHJOY_API_URL=wss://autopilot.zenjoymedia.media/agent-ws
set ZENITHJOY_AGENT_REAL_PUBLISH=1
echo  ------------------------------------------------------------
echo    Agent log (live):  watch for tray icon in bottom-right
echo  ------------------------------------------------------------
call npm start -- --license=%ZENITHJOY_LICENSE%

echo.
echo  Agent stopped. Press any key to close.
pause >nul
exit /b 0


:no_node
echo  [ERROR] Node.js NOT installed.
echo  Install Node 18+ from: https://nodejs.org/
echo  Then double-click this file again.
echo.
pause
exit /b 1

:npm_fail
echo.
echo  [ERROR] npm install failed.
echo.
echo  Possible fixes:
echo    1. Check internet connection.
echo    2. Use China npm mirror:
echo         npm config set registry https://registry.npmmirror.com
echo    3. Install Visual Studio Build Tools 2022.
echo.
pause
exit /b 2

:no_license
echo.
echo  [ERROR] License is empty.
echo  Get it from your Dashboard - Agent client page,
echo  then run this file again.
echo.
pause
exit /b 3

:no_chrome
echo.
echo  [ERROR] Google Chrome NOT found.
echo  Please install Google Chrome from:
echo      https://www.google.com/chrome/
echo.
pause
exit /b 4
