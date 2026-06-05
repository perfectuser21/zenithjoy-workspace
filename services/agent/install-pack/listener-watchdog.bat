@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"

REM ============================================================
REM  ZenithJoy 微信监听守护 watchdog
REM  listen_chat.py 退出/崩溃后 30 秒内自动重启（崩溃自愈）。
REM  由 install-autostart.ps1 注册的开机任务以登录用户身份拉起；
REM  也可手动双击运行。Ctrl+C 退出循环。
REM ============================================================

REM 优先用安装包内置 python-embedded；缺失则回退系统 python
set "PY=%~dp0python-embedded\python.exe"
if not exist "%PY%" set "PY=python"
set "SCRIPT=%~dp0wechat-rpa\listen_chat.py"

REM 中台地址：优先 .env 注入的 ZENITHJOY_API_BASE，缺省走公网
if exist .env (
    REM Normalize .env line endings — strip \r so CRLF files don't pollute env vars (same fix as start.bat)
    powershell -NoProfile -Command "$c=[IO.File]::ReadAllText('.env') -replace '\r',''; [IO.File]::WriteAllText('.env',$c)" >nul 2>&1
    for /f "usebackq tokens=1,* delims==" %%a in (".env") do (
        if /i "%%a"=="ZENITHJOY_API_BASE" set "ZENITHJOY_API_BASE=%%b"
        if /i "%%a"=="ZENITHJOY_AGENT_ID" set "ZENITHJOY_AGENT_ID=%%b"
    )
)
set "MW=%ZENITHJOY_API_BASE%"
if "%MW%"=="" set "MW=https://autopilot.zenjoymedia.media"

if not exist "%SCRIPT%" (
    echo [watchdog][ERROR] 找不到 %SCRIPT% — 请确认安装包完整
    pause
    exit /b 1
)

:loop
echo [watchdog] starting listen_chat at %DATE% %TIME% (middleware=%MW%)
"%PY%" "%SCRIPT%" --middleware-url "%MW%" --timeout 86400
echo [watchdog] listen_chat exited (code %errorlevel%), restarting in 30s...
timeout /t 30 /nobreak >nul
goto loop
