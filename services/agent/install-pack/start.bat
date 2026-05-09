@echo off
REM Sprint 2.1e — Agent install pack 启动器
REM 双击运行：验 .env → spawn chrome :19222 → spawn agent.exe
setlocal

set "AGENT_DIR=%~dp0"
cd /d "%AGENT_DIR%"

REM ===== 验 .env =====
if not exist .env (
    echo [start.bat] ERROR: .env file missing
    echo Please copy .env.template to .env, fill in ZENITHJOY_LICENSE, then retry.
    pause
    exit /b 1
)

findstr /b /c:"ZENITHJOY_LICENSE=ZJ-" .env >nul 2>&1
if errorlevel 1 (
    echo [start.bat] ERROR: ZENITHJOY_LICENSE in .env is invalid
    echo Should be ZENITHJOY_LICENSE=ZJ-X-XXXXXXXX format (copy from dashboard License page)
    pause
    exit /b 1
)

REM ===== Find chrome.exe =====
set "CHROME_EXE=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME_EXE%" set "CHROME_EXE=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME_EXE%" (
    echo [start.bat] ERROR: chrome.exe not found
    echo Please install Chrome browser first.
    pause
    exit /b 1
)

REM ===== Spawn chrome :19222 if not running =====
netstat -ano | findstr ":19222 " | findstr LISTENING >nul 2>&1
if errorlevel 1 (
    echo [start.bat] starting chrome :19222...
    start "" "%CHROME_EXE%" --remote-debugging-port=19222 --user-data-dir="%USERPROFILE%\.zj-chrome" --no-first-run
    timeout /t 5 /nobreak >nul
)

REM ===== Load .env to env vars =====
for /f "tokens=1,2 delims==" %%a in ('type .env ^| findstr /v "^#"') do (
    set "%%a=%%b"
)

REM ===== Spawn agent.exe (foreground + log to %USERPROFILE%\.zj) =====
mkdir "%USERPROFILE%\.zj" 2>nul
echo [start.bat] launching agent.exe ...
zenithjoy-agent.exe
if errorlevel 1 (
    echo [start.bat] agent.exe exited with error %errorlevel%
    pause
)
