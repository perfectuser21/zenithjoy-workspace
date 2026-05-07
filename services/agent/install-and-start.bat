@echo off
REM ============================================================
REM  ZenithJoy Agent — 一键安装 + 启动（Windows）
REM  解压 tarball 后双击本文件即可。
REM
REM  做的事：
REM    1. 检查 Node.js 18+
REM    2. 装依赖（首次约 2-5 分钟，已装则跳过）
REM    3. 提示输入 license（已 set 环境变量则跳过）
REM    4. 调 scripts\customer-start.bat 启动 Chrome 调试 + Agent
REM ============================================================

setlocal EnableDelayedExpansion

REM 切到本脚本所在目录（services/agent 根）
pushd "%~dp0"

echo ============================================================
echo  ZenithJoy Agent ^| 一键安装 + 启动
echo ============================================================
echo.

REM ===== 1) 检查 Node.js =====
where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] 未检测到 Node.js。请先装 Node 18+ : https://nodejs.org/
  echo         安装时勾选 "Add to PATH"。
  pause
  exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do set NODE_VER=%%v
echo [1/4] Node.js: %NODE_VER%

REM ===== 2) 装依赖 =====
if exist "node_modules\.package-lock.json" (
  echo [2/4] 依赖已装，跳过 npm install
) else (
  echo [2/4] 装依赖（首次约 2-5 分钟）...
  call npm install
  if errorlevel 1 (
    echo.
    echo [ERROR] npm install 失败。常见原因:
    echo   - 网络问题: 试 npm config set registry https://registry.npmmirror.com
    echo   - 缺 build tools: 装 Visual Studio Build Tools 2022 ^(C++ 桌面开发^)
    pause
    exit /b 2
  )
)

REM ===== 3) 拿 license =====
if "%ZENITHJOY_LICENSE%"=="" (
  echo.
  echo [3/4] 请输入 license（在 autopilot Dashboard "Agent 客户端" 页复制）
  set /p ZENITHJOY_LICENSE=     license (ZJ-X-XXXXXX):
  if "!ZENITHJOY_LICENSE!"=="" (
    echo [ERROR] license 为空，退出。
    pause
    exit /b 3
  )
) else (
  echo [3/4] 已使用环境变量 ZENITHJOY_LICENSE
)

REM 简单格式校验：以 ZJ- 开头
echo !ZENITHJOY_LICENSE! | findstr /b "ZJ-" >nul
if errorlevel 1 (
  echo [WARN] license 格式不像 ZJ-X-XXXXXX，但仍会尝试启动 ^(服务端会鉴权^)
)

REM ===== 4) 启动 =====
echo.
echo [4/4] 启动 Chrome 调试 + Agent...
echo.
set ZENITHJOY_LICENSE=!ZENITHJOY_LICENSE!
call scripts\customer-start.bat

popd
endlocal
