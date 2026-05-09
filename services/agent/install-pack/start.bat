@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

cd /d "%~dp0"

REM Step 1: Verify .env exists
if not exist .env (
    echo [ERROR] .env not found. Please re-download install pack from dashboard.
    pause
    exit /b 1
)

REM Step 2: Load .env into env vars (skip comment lines)
for /f "usebackq tokens=1,* delims==" %%a in (".env") do (
    set "LINE=%%a"
    if not "!LINE!"=="" (
        if not "!LINE:~0,1!"=="#" (
            set "%%a=%%b"
        )
    )
)

REM Step 3: Validate ZENITHJOY_LICENSE
if not defined ZENITHJOY_LICENSE (
    echo [ERROR] ZENITHJOY_LICENSE not set in .env. Re-download install pack.
    pause
    exit /b 1
)
if "%ZENITHJOY_LICENSE%"=="__PLACEHOLDER__" (
    echo [ERROR] ZENITHJOY_LICENSE is placeholder. Re-download install pack from dashboard.
    pause
    exit /b 1
)
if not defined ZENITHJOY_API_BASE set "ZENITHJOY_API_BASE=https://autopilot.zenjoymedia.media"

REM Step 4: Fix 8 - License precheck before spawning agent
echo [precheck] verifying license at %ZENITHJOY_API_BASE%/api/agent/heartbeat ...
for /f "delims=" %%c in ('curl -s -o nul -w "%%{http_code}" -m 10 -X POST "%ZENITHJOY_API_BASE%/api/agent/heartbeat" -H "Content-Type: application/json" -d "{\"license_key\":\"%ZENITHJOY_LICENSE%\",\"machine_id\":\"precheck\",\"agent_version\":\"1.0.1\"}"') do set "PRECHECK_STATUS=%%c"

if "%PRECHECK_STATUS%"=="200" (
    echo [precheck] license OK
    goto :START_AGENT
)
if "%PRECHECK_STATUS%"=="401" (
    echo [ERROR] license invalid 401. Please re-download install pack from dashboard.
    pause
    exit /b 1
)
if "%PRECHECK_STATUS%"=="403" (
    echo [ERROR] license rejected 403. Please re-download install pack from dashboard.
    pause
    exit /b 1
)
if "%PRECHECK_STATUS%"=="503" (
    echo [WARN] backend 503 unavailable. Try again in 5 minutes.
    pause
    exit /b 1
)
echo [WARN] precheck got status %PRECHECK_STATUS% - proceeding anyway

:START_AGENT
REM Step 5: Find chrome.exe
set "CHROME_EXE=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME_EXE%" set "CHROME_EXE=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME_EXE%" (
    echo [ERROR] chrome.exe not found. Please install Chrome browser first.
    pause
    exit /b 1
)

REM Step 6: Spawn chrome :19222 if not already listening
netstat -ano | findstr ":19222 " | findstr LISTENING >nul 2>&1
if errorlevel 1 (
    echo [chrome] starting chrome on :19222 ...
    start "" "%CHROME_EXE%" --remote-debugging-port=19222 --user-data-dir="%USERPROFILE%\.zj-chrome" --no-first-run
    timeout /t 5 /nobreak >nul
)

REM Step 7: Spawn agent.exe (foreground)
mkdir "%USERPROFILE%\.zj" 2>nul
echo [agent] starting zenithjoy-agent.exe ...
zenithjoy-agent.exe
if errorlevel 1 (
    echo [agent] agent.exe exited with error %errorlevel%
    pause
)
