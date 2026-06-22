@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

cd /d "%~dp0"

REM === E2E test seam: ZJ_LAUNCH_PROBE early-exit guard ===
REM 当 ZJ_LAUNCH_PROBE 置位时（仅 e2e-verify.ps1 / smoke 设置），写一个 probe 标记到
REM %APPDATA%\zenithjoy-agent\probe-marker.txt 后立即退出，证明 start.vbs→start.bat 隐藏拉起链
REM 真执行而无需跑完整重活 / 避免 GHA 上 pause 挂死。生产运行从不设此变量，故不影响真实启动。
if defined ZJ_LAUNCH_PROBE (
    if not exist "%APPDATA%\zenithjoy-agent" mkdir "%APPDATA%\zenithjoy-agent" >nul 2>&1
    echo probe %DATE% %TIME% pid=%RANDOM%> "%APPDATA%\zenithjoy-agent\probe-marker.txt"
    echo [probe] ZJ_LAUNCH_PROBE set, vbs->bat chain verified, exiting early
    exit /b 0
)

REM Unblock all executables recursively (removes Zone Identifier / Mark of the Web)
REM Without this, execFile() on bundled ffmpeg.exe / Playwright chrome.exe fails with "spawn UNKNOWN"
powershell -NoProfile -Command "Get-ChildItem -Path '%~dp0' -Recurse -Include '*.exe','*.dll' | Unblock-File" >nul 2>&1

REM Step 0: Set SPI_SETSCREENREADER system flag to activate WeChat UIAutomation
REM No window, no focus frame, no spoken voice - just flips the OS screen-reader flag so the WeChat
REM 4.1.x mmui control tree exposes its UIAutomation provider.
powershell -NoProfile -Command "Add-Type -Namespace Win -Name Spi -MemberDefinition '[DllImport(\"user32.dll\")] public static extern bool SystemParametersInfo(uint a, uint b, System.IntPtr c, uint d);'; [Win.Spi]::SystemParametersInfo(0x47,1,[System.IntPtr]::Zero,0x02) | Out-Null" >nul 2>&1
echo [uia] WeChat UIAutomation unlocked (screen-reader flag set)

REM Step 0.5: WeChat version guard 已迁移进 preflight.py（step 6.9），由 preflight 自动检测+自修，此处不再早退。


REM Step 1: Verify .env exists - auto-copy from .env.template on first run
if not exist .env (
    if exist .env.template (
        copy .env.template .env >nul
        echo [setup] .env created from .env.template
    ) else (
        echo [ERROR] .env not found. Please re-download install pack from dashboard.
        echo [ERROR] Make sure you EXTRACTED the whole package first, do NOT run start.bat from inside the zip/rar.
        pause
        exit /b 1
    )
)

REM Step 1.5: Append missing new keys to .env (upgrade-compatible, never overwrite user values)
powershell -NoProfile -Command "if (!(Select-String -Path '.env' -Pattern 'ZENITHJOY_AGENT_DRYRUN_BROWSER' -Quiet)) { Add-Content -Path '.env' -Value 'ZENITHJOY_AGENT_DRYRUN_BROWSER=mock'; Write-Host '[setup] ZENITHJOY_AGENT_DRYRUN_BROWSER=mock appended to .env' }"
powershell -NoProfile -Command "if (!(Select-String -Path '.env' -Pattern 'ZENITHJOY_AGENT_REAL_PUBLISH' -Quiet)) { Add-Content -Path '.env' -Value 'ZENITHJOY_AGENT_REAL_PUBLISH=1'; Write-Host '[setup] ZENITHJOY_AGENT_REAL_PUBLISH=1 appended to .env' }"

REM Step 1.8: Normalize .env line endings — strip \r so CRLF files don't pollute env vars
REM for/f keeps \r from Windows CRLF files, causing URL parse errors ("https://api.com\r/api/...")
powershell -NoProfile -Command "$c=[IO.File]::ReadAllText('.env') -replace '\r',''; [IO.File]::WriteAllText('.env',$c)" >nul 2>&1

REM Step 2: Load .env into env vars (skip comment lines)
for /f "usebackq tokens=1,* delims==" %%a in (".env") do (
    set "LINE=%%a"
    if not "!LINE!"=="" (
        if not "!LINE:~0,1!"=="#" (
            set "%%a=%%b"
        )
    )
)

REM Step 3: Validate ZENITHJOY_LICENSE - prompt and persist to .env if placeholder
if not defined ZENITHJOY_LICENSE set "ZENITHJOY_LICENSE="
set "_IS_PLACEHOLDER=0"
if "%ZENITHJOY_LICENSE%"=="" set "_IS_PLACEHOLDER=1"
if "%ZENITHJOY_LICENSE%"=="__PLACEHOLDER__" set "_IS_PLACEHOLDER=1"
if "%ZENITHJOY_LICENSE%"=="ZJ-F-XXXXXX" set "_IS_PLACEHOLDER=1"

if "%_IS_PLACEHOLDER%"=="1" (
    echo.
    echo  ============================================================
    echo   Enter your ZenithJoy License Key
    echo   Find it at https://autopilot.zenjoymedia.media/dashboard/agent
    echo  ============================================================
    echo.
    set /p "ZENITHJOY_LICENSE=License Key: "
    if "!ZENITHJOY_LICENSE!"=="" (
        echo [ERROR] No License Key entered, exiting.
        pause
        exit /b 1
    )
    REM Persist to .env so it won't prompt next time
    powershell -NoProfile -Command "(Get-Content .env) -replace '^ZENITHJOY_LICENSE=.*', 'ZENITHJOY_LICENSE=!ZENITHJOY_LICENSE!' | Set-Content .env"
    echo [setup] License saved to .env
    echo.
)
if not defined ZENITHJOY_API_BASE set "ZENITHJOY_API_BASE=https://autopilot.zenjoymedia.media"
REM Fix 10 - ws link uses its own var ZENITHJOY_API_URL (does not read ZENITHJOY_API_BASE), defaults to wss
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

REM Step 5.5: Bundled Node.js + hyperframes (zero-dependency, China mirror accelerated)
set "ZJ_RUNTIME=%APPDATA%\ZenithJoy\runtime"
set "ZJ_NODE_DIR=%ZJ_RUNTIME%\nodejs"
set "ZJ_NODE_EXE=%ZJ_NODE_DIR%\node.exe"
set "ZJ_NPM_CLI=%ZJ_NODE_DIR%\node_modules\npm\bin\npm-cli.js"
set "ZJ_HF_DIR=%ZJ_RUNTIME%\hyperframes"
set "ZJ_HF_MAIN=%ZJ_HF_DIR%\node_modules\hyperframes\dist\cli.js"

if not exist "%ZJ_NODE_EXE%" (
    echo [nodejs] first-time setup: extracting bundled Node.js runtime...
    mkdir "%ZJ_NODE_DIR%" 2>nul
    powershell -NoProfile -Command "$dest='%ZJ_NODE_DIR%'; Expand-Archive -Path '%~dp0node-win-x64.zip' -DestinationPath '%TEMP%\zj-node-tmp' -Force; Move-Item '%TEMP%\zj-node-tmp\node-v22.16.0-win-x64\*' $dest -Force; Remove-Item '%TEMP%\zj-node-tmp' -Recurse -Force"
    if exist "%ZJ_NODE_EXE%" (
        powershell -NoProfile -Command "Unblock-File '%ZJ_NODE_EXE%'" >nul 2>&1
        echo [nodejs] Node.js runtime ready
    ) else (
        echo [WARN] Node.js extraction failed, video template rendering will fall back to plain FFmpeg
        goto :HYPERFRAMES_DONE
    )
)

if not exist "%ZJ_HF_MAIN%" (
    echo [hyperframes] first-time install, ~1-2 min via npmmirror...
    mkdir "%ZJ_HF_DIR%" 2>nul
    "%ZJ_NODE_EXE%" "%ZJ_NPM_CLI%" install hyperframes --prefix "%ZJ_HF_DIR%" --registry https://registry.npmmirror.com
    if errorlevel 1 (
        echo [WARN] hyperframes install failed, video template rendering will fall back to plain FFmpeg
    ) else (
        echo [hyperframes] install done OK
    )
) else (
    echo [hyperframes] already installed, skipping
)
:HYPERFRAMES_DONE

REM Step 5.6: Ensure playwright-core npm package present (publisher scripts require('playwright-core'))
REM v1.1.57+ packs node_modules/playwright-core/; this step is self-heal fallback for old packs (<=v1.1.56).
REM Non-fatal: agent still starts, only Douyin/Kuaishou publish would hit MODULE_NOT_FOUND (prompt to re-download).
if not exist "%~dp0node_modules\playwright-core\index.js" (
    if exist "%ZJ_NODE_EXE%" (
        echo [playwright-core] old-pack self-heal: installing playwright-core, first time only ~30s...
        mkdir "%~dp0node_modules" 2>nul
        REM --ignore-scripts prevents npm install pre/postinstall scripts (security hardening)
        REM registry.npmmirror.com is the official Node.js China mirror (formerly npm.taobao.org)
        "%ZJ_NODE_EXE%" "%ZJ_NPM_CLI%" install playwright-core --prefix "%~dp0" --no-save --no-package-lock --ignore-scripts --registry https://registry.npmmirror.com
        if errorlevel 1 (
            echo [WARN] playwright-core install failed - please re-download latest pack v1.1.57+ to fix publishing
        ) else (
            REM quick smoke: confirm module can be required
            "%ZJ_NODE_EXE%" -e "require('playwright-core'); process.exit(0)" 2>nul
            if errorlevel 1 (
                echo [WARN] playwright-core installed but verify failed, publishing may misbehave
            ) else (
                echo [playwright-core] installed and verified OK
            )
        )
    ) else (
        echo [WARN] ZJ_NODE_EXE not ready, skipping playwright-core install - please re-download v1.1.57+ pack
    )
) else (
    echo [playwright-core] present, skipping
)

REM Step 5.7: Set NODE_PATH so publisher scripts can find node_modules (incl. playwright-core)
set "NODE_PATH=%~dp0node_modules"
echo [node] NODE_PATH=%NODE_PATH%

REM Step 6: Bundled Playwright Chromium path (packed in playwright-browsers/)
REM Playwright reads PLAYWRIGHT_BROWSERS_PATH to locate Chromium, no system Chrome needed
set "PLAYWRIGHT_BROWSERS_PATH=%~dp0playwright-browsers"
echo [playwright] PLAYWRIGHT_BROWSERS_PATH=%PLAYWRIGHT_BROWSERS_PATH%

REM Step 6.5: Let hyperframes' puppeteer-core also use bundled Chromium (no extra Chrome install)
REM Find chromium-*/chrome-win64/chrome.exe
for /f "delims=" %%d in ('dir /b /ad "%PLAYWRIGHT_BROWSERS_PATH%\chromium-*" 2^>nul') do (
    if exist "%PLAYWRIGHT_BROWSERS_PATH%\%%d\chrome-win64\chrome.exe" (
        set "PUPPETEER_EXECUTABLE_PATH=%PLAYWRIGHT_BROWSERS_PATH%\%%d\chrome-win64\chrome.exe"
        set "PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1"
        echo [puppeteer] using bundled Chromium: %%d\chrome-win64\chrome.exe
    )
)

REM === Unlock WeChat UIAutomation (set SPI_SETSCREENREADER system flag) ===
REM WeChat 4.1.x mmui control tree only exposes once the OS screen-reader flag is on, which makes it
REM activate its UIAutomation provider. Setting the SPI_SETSCREENREADER flag does this directly:
REM no window, no focus frame, no spoken voice (replaces the old screen-reader start+stop toggle).
echo [setup] unlocking WeChat automation (screen-reader flag)...
powershell -NoProfile -Command "Add-Type -Namespace Win -Name Spi -MemberDefinition '[DllImport(\"user32.dll\")] public static extern bool SystemParametersInfo(uint a, uint b, System.IntPtr c, uint d);'; [Win.Spi]::SystemParametersInfo(0x47,1,[System.IntPtr]::Zero,0x02) | Out-Null" >nul 2>&1
echo [setup] done

REM === Lock update: prevent WeChat auto-upgrading to 4.1.9+ (accessibility tree removed = RPA dead) ===
REM Idempotent: safe to re-run. Two measures:
REM   1) Rename WeixinUpdate.exe -> .disabled in each version subdir under the Weixin install dir
REM   2) Add an outbound firewall block rule so WeixinUpdate.exe cannot fetch new versions
REM Use dir /s /b to find real subdir paths (version dir name changes, cannot hardcode).
echo [lock-update] locking WeChat version, disabling auto-update...
set "_WEIXIN_ROOT=C:\Program Files\Tencent\Weixin"
if exist "%_WEIXIN_ROOT%" (
    for /f "delims=" %%u in ('dir /s /b "%_WEIXIN_ROOT%\WeixinUpdate.exe" 2^>nul') do (
        REM 1) rename to disable (already-.disabled ones won't match, naturally idempotent)
        ren "%%u" "WeixinUpdate.exe.disabled" >nul 2>&1
        if exist "%%u" (
            echo [lock-update] WARN rename failed - file in use?: %%u
        ) else (
            echo [lock-update] disabled %%u
        )
        REM 2) outbound firewall block (idempotent: delete same-name rule first, then add)
        netsh advfirewall firewall delete rule name="Block WeixinUpdate" program="%%u" >nul 2>&1
        netsh advfirewall firewall add rule name="Block WeixinUpdate" dir=out action=block program="%%u" enable=yes >nul 2>&1
    )
    REM also add a firewall rule for already-.disabled ones (fallback if restored)
    for /f "delims=" %%d in ('dir /s /b "%_WEIXIN_ROOT%\WeixinUpdate.exe.disabled" 2^>nul') do (
        set "_ORIG=%%d"
        set "_ORIG=!_ORIG:.disabled=!"
        netsh advfirewall firewall delete rule name="Block WeixinUpdate" program="!_ORIG!" >nul 2>&1
        netsh advfirewall firewall add rule name="Block WeixinUpdate" dir=out action=block program="!_ORIG!" enable=yes >nul 2>&1
    )
    echo [lock-update] done
) else (
    echo [lock-update] WeChat install dir not found, skipping (%_WEIXIN_ROOT%)
)

REM === Step 6.9: WeChat RPA 环境自检（非阻断，由 module-manager 负责自愈）===
REM preflight.py 已由 module-manager 在下载最新模块后自动运行（含 _run_elevated 安装微信）。
REM start.bat 不再阻断启动流程，确保任意 Windows 机器能自愈，无需重新下载安装包。
REM 此处仅在 core 启动前做一次信息性输出，不阻断。
if exist "%~dp0python-embedded\python.exe" if exist "%~dp0wechat-rpa\preflight.py" (
    echo [preflight] 环境自检将由 agent core module-manager 在启动后自动运行...
)

REM Step 6.92: 注册开机自启（幂等，每次都跑，确保任务计划条目存在）
REM install-autostart.ps1 用 RunLevel Limited + ONLOGON，不需要管理员。
if exist "%~dp0install-autostart.ps1" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-autostart.ps1" >nul 2>&1
    echo [autostart] boot autostart registered (ZenithJoyAgent scheduled task)
) else (
    echo [autostart] install-autostart.ps1 不存在，跳过（旧版安装包）
)

REM Step 6.95: Single-instance guard — kill any existing zenithjoy-agent.exe before starting
REM Two agents with the same license kick each other off the server WS connection,
REM causing repeated disconnects ("又掉了" / "车没油" symptom when upgrading without closing old).
powershell -NoProfile -Command "Get-Process -Name zenithjoy-agent -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue" >nul 2>&1
echo [agent] previous agent processes stopped (if any)

REM === Step 6.96: 核心自升级自换 — 读 .active-core 指针选最新核心目录（Sprint 06222100）===
REM 客户机布局：<root>\extracted\zenithjoy-agent-v<ver>\（本 start.bat 所在）。CoreUpgrader 升级后把
REM 新核心解压到同级 extracted\zenithjoy-agent-v<新ver>，并在 <root>\.active-core 写下目标目录名，
REM 然后优雅退出。计划任务 ONLOGON 始终拉起本启动器；本启动器读 .active-core 指针 → 切到被选中的最新
REM 核心目录运行其 zenithjoy-agent.exe。这样重启后跑的就是新核心，不依赖人手动重装。
REM 回退（防自换把客户机搞挂）：指针文件不存在 / 指向目录的 exe 不存在 → 用 %~dp0 本地核心。
set "CORE_RUN_DIR=%~dp0"
REM <root> = extracted 的父 = %~dp0 的祖父目录
for %%i in ("%~dp0..") do set "EXTRACTED_DIR=%%~fi"
for %%i in ("%EXTRACTED_DIR%\..") do set "ROOT_DIR=%%~fi"
set "ACTIVE_CORE_FILE=%ROOT_DIR%\.active-core"
if exist "%ACTIVE_CORE_FILE%" (
    set "ACTIVE_CORE_NAME="
    for /f "usebackq delims=" %%n in ("%ACTIVE_CORE_FILE%") do if not defined ACTIVE_CORE_NAME set "ACTIVE_CORE_NAME=%%n"
    if defined ACTIVE_CORE_NAME (
        set "POINTED_DIR=%EXTRACTED_DIR%\!ACTIVE_CORE_NAME!"
        if exist "!POINTED_DIR!\zenithjoy-agent.exe" (
            set "CORE_RUN_DIR=!POINTED_DIR!\"
            echo [active-core] 指针选中最新核心: !ACTIVE_CORE_NAME!
        ) else (
            echo [active-core] WARN 指针指向 !ACTIVE_CORE_NAME! 但缺 zenithjoy-agent.exe — fallback 回退本地核心
        )
    ) else (
        echo [active-core] WARN .active-core 指针为空 — fallback 回退本地核心
    )
) else (
    echo [active-core] 无 .active-core 指针，使用本地核心（首装/未升级）
)

REM Step 7: Spawn agent.exe (foreground) — 跑指针选中的最新核心（无指针则本地）
mkdir "%USERPROFILE%\.zj" 2>nul
echo [agent] starting zenithjoy-agent.exe (dir=%CORE_RUN_DIR%) ...
pushd "%CORE_RUN_DIR%"
zenithjoy-agent.exe
set "_AGENT_EXIT=%errorlevel%"
popd
if not "%_AGENT_EXIT%"=="0" (
    echo [agent] agent.exe exited with error %_AGENT_EXIT%
    pause
)
