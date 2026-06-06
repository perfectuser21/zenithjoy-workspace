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

REM ── 启动前预检：微信版本 / 登录态 / UIA / 中台（自愈 + 阻断不支持版本）──
REM preflight.py 检测并自愈：
REM   - 微信未装   → 自动下载 4.1.8 静默安装
REM   - 微信>=4.1.9 → 自动降级到 4.1.8（4.1.9+ UIA 控件树被砍，RPA 不可用）
REM   - 锁更新    → 禁 WeixinUpdate.exe + 防火墙出站封
REM   - UIA 讲述人 → 静默激活一次
REM 有 failed 退出码=1 → 阻断 watchdog 启动；仅 warn/ok → 继续。
if exist "%~dp0python-embedded\python.exe" if exist "%~dp0wechat-rpa\preflight.py" (
    echo.
    echo  ============================================================
    echo   WeChat 环境自检（版本/UIA/中台），自动修复中...
    echo  ============================================================
    "%~dp0python-embedded\python.exe" "%~dp0wechat-rpa\preflight.py" --middleware-url "%MW%"
    if errorlevel 1 (
        echo.
        echo  ============================================================
        echo   [BLOCKED] 环境自检失败，监听未启动。
        echo   常见原因：微信版本 ^>=4.1.9（UIA 控件树被砍）
        echo   解决方案：
        echo     1. 卸载当前微信
        echo     2. 下载 4.1.8：https://zenithjoy-static-1333590468.cos.accelerate.myqcloud.com/install-pack/wechat/WeChatWin_4.1.8.exe
        echo     3. 安装后重新双击 listener-watchdog.bat
        echo   详细原因见上方自检报告。
        echo  ============================================================
        echo.
        pause
        exit /b 1
    )
    echo [preflight] 自检通过，启动监听...
    echo.
)

:loop
echo [watchdog] starting listen_chat at %DATE% %TIME% (middleware=%MW%)
"%PY%" "%SCRIPT%" --middleware-url "%MW%" --timeout 86400
echo [watchdog] listen_chat exited (code %errorlevel%), restarting in 30s...
timeout /t 30 /nobreak >nul
goto loop
