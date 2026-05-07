@echo off
REM Walking Skeleton #1 客户一键启动脚本（Windows）
REM 用法：
REM   set ZENITHJOY_LICENSE=ZJ-F-XXXXXX
REM   scripts\customer-start.bat
REM
REM 默认连 https://autopilot.zenjoymedia.media；本地开发可覆盖 ZENITHJOY_API_BASE

setlocal EnableDelayedExpansion

REM ===== 必填环境变量校验 =====
if "%ZENITHJOY_LICENSE%"=="" (
  echo [ERROR] 请先 set ZENITHJOY_LICENSE=ZJ-F-XXXXXX  在 autopilot dashboard 拿
  exit /b 1
)
if "%ZENITHJOY_API_BASE%"=="" set ZENITHJOY_API_BASE=https://autopilot.zenjoymedia.media
if "%ZENITHJOY_AGENT_REAL_PUBLISH%"=="" set ZENITHJOY_AGENT_REAL_PUBLISH=1

set CHROME_PORT=19222
set CHROME_PROFILE=%USERPROFILE%\zenithjoy-chrome-profile

REM ===== 探测 chrome.exe 路径（按优先级）=====
set CHROME_EXE=
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
  set "CHROME_EXE=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
) else if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
  set "CHROME_EXE=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
) else if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" (
  set "CHROME_EXE=%LocalAppData%\Google\Chrome\Application\chrome.exe"
)

if "%CHROME_EXE%"=="" (
  echo [ERROR] 未找到 chrome.exe。请装 Google Chrome 到默认路径，或手动改本脚本。
  exit /b 2
)

REM ===== 检查 Chrome 19222 端口是否已占用 =====
echo [1/2] 启动 Chrome 调试模式 (port %CHROME_PORT%)
set PORT_BUSY=0
REM netstat 不存在或失败时静默忽略，最坏情况另开新 Chrome（user-data-dir 隔离）
where netstat >nul 2>&1 && (
  netstat -ano -p tcp 2>nul | findstr ":%CHROME_PORT% " 2>nul | findstr LISTENING >nul 2>&1
  if not errorlevel 1 set PORT_BUSY=1
)
if "%PORT_BUSY%"=="1" (
  echo   Chrome 端口已占，复用现有窗口
) else (
  echo   启动新 Chrome,请在弹窗里登录 https://creator.douyin.com（用测试号）
  start "" "%CHROME_EXE%" --remote-debugging-port=%CHROME_PORT% --user-data-dir="%CHROME_PROFILE%"
  REM 端口轮询等 Chrome 起来（最多 15s），优于固定 ping 延迟
  set CHROME_READY=0
  for /l %%i in (1,1,15) do (
    if "!CHROME_READY!"=="0" (
      timeout /t 1 /nobreak >nul 2>&1 || ping -n 2 127.0.0.1 >nul
      where netstat >nul 2>&1 && (
        netstat -ano -p tcp 2>nul | findstr ":%CHROME_PORT% " 2>nul | findstr LISTENING >nul 2>&1
        if not errorlevel 1 set CHROME_READY=1
      )
    )
  )
  if "!CHROME_READY!"=="1" (
    echo   Chrome 已就绪 (port %CHROME_PORT%)
  ) else (
    echo   [WARN] Chrome 端口探测超时，继续启动 agent 但握手可能失败
  )
)

REM ===== 启动 ZenithJoy Agent =====
echo.
echo [2/2] 启动 ZenithJoy Agent
echo   API: %ZENITHJOY_API_BASE%
echo   REAL_PUBLISH: %ZENITHJOY_AGENT_REAL_PUBLISH%
echo.

REM 切到 services\agent 根目录（本脚本在 scripts\ 下）
pushd "%~dp0\.."
call npm start
popd

endlocal
