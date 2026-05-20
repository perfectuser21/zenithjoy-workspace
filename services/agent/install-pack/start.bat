@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

cd /d "%~dp0"

REM Unblock all .exe files (removes Zone Identifier / Mark of the Web from downloaded files)
REM Without this, execFile() on bundled ffmpeg.exe fails with "spawn UNKNOWN" on Windows
powershell -NoProfile -Command "Get-ChildItem -Path '%~dp0' -Filter '*.exe' | Unblock-File" >nul 2>&1

REM Step 1: Verify .env exists — 首次运行自动从 .env.template 复制
if not exist .env (
    if exist .env.template (
        copy .env.template .env >nul
        echo [setup] .env created from .env.template
    ) else (
        echo [ERROR] .env not found. Please re-download install pack from dashboard.
        pause
        exit /b 1
    )
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

REM Step 3: Validate ZENITHJOY_LICENSE — 占位符时提示输入并写入 .env
if not defined ZENITHJOY_LICENSE set "ZENITHJOY_LICENSE="
set "_IS_PLACEHOLDER=0"
if "%ZENITHJOY_LICENSE%"=="" set "_IS_PLACEHOLDER=1"
if "%ZENITHJOY_LICENSE%"=="__PLACEHOLDER__" set "_IS_PLACEHOLDER=1"
if "%ZENITHJOY_LICENSE%"=="ZJ-F-XXXXXX" set "_IS_PLACEHOLDER=1"

if "%_IS_PLACEHOLDER%"=="1" (
    echo.
    echo  ============================================================
    echo   请输入你的 ZenithJoy License Key
    echo   在 https://autopilot.zenjoymedia.media/dashboard/agent 可查看
    echo  ============================================================
    echo.
    set /p "ZENITHJOY_LICENSE=License Key: "
    if "!ZENITHJOY_LICENSE!"=="" (
        echo [ERROR] 未输入 License Key，退出。
        pause
        exit /b 1
    )
    REM 写入 .env，下次启动不再提示
    powershell -NoProfile -Command "(Get-Content .env) -replace '^ZENITHJOY_LICENSE=.*', 'ZENITHJOY_LICENSE=!ZENITHJOY_LICENSE!' | Set-Content .env"
    echo [setup] License 已写入 .env
    echo.
)
if not defined ZENITHJOY_API_BASE set "ZENITHJOY_API_BASE=https://autopilot.zenjoymedia.media"
REM Fix 10 - ws 链路用独立变量 ZENITHJOY_API_URL（不读 ZENITHJOY_API_BASE），默认 wss
if not defined ZENITHJOY_API_URL set "ZENITHJOY_API_URL=wss://autopilot.zenjoymedia.media/agent-ws"

REM Step 4: Fix 8 - License precheck before spawning agent (Bearer header, not body)
echo [precheck] verifying license at %ZENITHJOY_API_BASE%/api/agent/heartbeat ...
for /f "delims=" %%c in ('curl -s -o nul -w "%%{http_code}" -m 10 -X POST "%ZENITHJOY_API_BASE%/api/agent/heartbeat" -H "Authorization: Bearer %ZENITHJOY_LICENSE%" -H "Content-Type: application/json" -d "{\"machine_id\":\"precheck\",\"agent_version\":\"1.0.1\"}"') do set "PRECHECK_STATUS=%%c"

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
REM Step 5: Ensure ffmpeg.exe is available (required for video pipeline)
if exist "%~dp0ffmpeg.exe" (
    echo [ffmpeg] found bundled ffmpeg.exe
) else (
    where ffmpeg >nul 2>&1
    if errorlevel 1 (
        echo [ffmpeg] not found. Attempting install via winget...
        winget install --id Gyan.FFmpeg --source winget --accept-package-agreements --accept-source-agreements
        if errorlevel 1 (
            echo [WARN] ffmpeg install failed. Video pipeline will not work. Install ffmpeg manually and add to PATH.
        ) else (
            echo [ffmpeg] installed via winget. Restart start.bat to reload PATH.
            pause
            exit /b 0
        )
    ) else (
        echo [ffmpeg] found in PATH
    )
)

REM Step 5.5: 内置 Node.js + hyperframes（零依赖，国内加速）
set "ZJ_RUNTIME=%APPDATA%\ZenithJoy\runtime"
set "ZJ_NODE_DIR=%ZJ_RUNTIME%\nodejs"
set "ZJ_NODE_EXE=%ZJ_NODE_DIR%\node.exe"
set "ZJ_NPM_CLI=%ZJ_NODE_DIR%\node_modules\npm\bin\npm-cli.js"
set "ZJ_HF_DIR=%ZJ_RUNTIME%\hyperframes"
set "ZJ_HF_MAIN=%ZJ_HF_DIR%\node_modules\hyperframes\dist\cli.js"

if not exist "%ZJ_NODE_EXE%" (
    echo [nodejs] 首次设置：解压内置 Node.js 运行时...
    mkdir "%ZJ_NODE_DIR%" 2>nul
    powershell -NoProfile -Command "Expand-Archive -Path '%~dp0node-win-x64.zip' -DestinationPath '%TEMP%\zj-node-tmp' -Force; Move-Item '%TEMP%\zj-node-tmp\node-v20.18.0-win-x64\*' '%ZJ_NODE_DIR%\' -Force; Remove-Item '%TEMP%\zj-node-tmp' -Recurse -Force"
    if exist "%ZJ_NODE_EXE%" (
        powershell -NoProfile -Command "Unblock-File '%ZJ_NODE_EXE%'" >nul 2>&1
        echo [nodejs] Node.js 运行时就绪
    ) else (
        echo [WARN] Node.js 解压失败，视频模板渲染将使用基础 FFmpeg 模式
        goto :HYPERFRAMES_DONE
    )
)

if not exist "%ZJ_HF_MAIN%" (
    echo [hyperframes] 首次安装（约 1-2 分钟，通过 npmmirror 加速）...
    mkdir "%ZJ_HF_DIR%" 2>nul
    "%ZJ_NODE_EXE%" "%ZJ_NPM_CLI%" install hyperframes --prefix "%ZJ_HF_DIR%" --registry https://registry.npmmirror.com
    if errorlevel 1 (
        echo [WARN] hyperframes 安装失败，视频模板渲染将使用基础 FFmpeg 模式
    ) else (
        echo [hyperframes] 安装完成 OK
    )
) else (
    echo [hyperframes] 已安装，跳过
)
:HYPERFRAMES_DONE

REM Step 6: Find chrome.exe
set "CHROME_EXE=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME_EXE%" set "CHROME_EXE=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME_EXE%" (
    echo [ERROR] chrome.exe not found. Please install Chrome browser first.
    pause
    exit /b 1
)

REM 让 hyperframes 的 puppeteer-core 使用系统 Chrome，避免重新下载 ~100MB Chromium
set "PUPPETEER_EXECUTABLE_PATH=%CHROME_EXE%"
set "PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1"

REM Step 7: Spawn chrome :19222 if not already listening
netstat -ano | findstr ":19222 " | findstr LISTENING >nul 2>&1
if errorlevel 1 (
    echo [chrome] starting chrome on :19222 ...
    start "" "%CHROME_EXE%" --remote-debugging-port=19222 --user-data-dir="%USERPROFILE%\.zj-chrome" --no-first-run
    timeout /t 5 /nobreak >nul
)

REM Step 8: Spawn agent.exe (foreground)
mkdir "%USERPROFILE%\.zj" 2>nul
echo [agent] starting zenithjoy-agent.exe ...
zenithjoy-agent.exe
if errorlevel 1 (
    echo [agent] agent.exe exited with error %errorlevel%
    pause
)
