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
netstat -ano -p tcp | findstr ":%CHROME_PORT% " | findstr LISTENING > nul
if %errorlevel%==0 (
  echo   Chrome 端口已占，复用现有窗口
) else (
  echo   启动新 Chrome,请在弹窗里登录 https://creator.douyin.com（用测试号）
  start "" "%CHROME_EXE%" --remote-debugging-port=%CHROME_PORT% --user-data-dir="%CHROME_PROFILE%"
  REM 等 Chrome 起来
  ping -n 4 127.0.0.1 > nul
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
