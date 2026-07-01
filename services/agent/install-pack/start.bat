@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

cd /d "%~dp0"

REM === E2E test seam: ZJ_LAUNCH_PROBE early-exit guard ===
REM When ZJ_LAUNCH_PROBE is set (only e2e-verify.ps1 / smoke set it), write a probe marker to
REM %APPDATA%\zenithjoy-agent\probe-marker.txt then exit immediately, proving the
REM start.vbs->start.bat hidden launch chain really runs without the full heavy work / avoids
REM pause hanging on GHA. Production runs never set this var, so real startup is unaffected.
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

REM Step 0.5: WeChat version guard moved into preflight.py (step 6.9); preflight auto-detects + self-repairs, no early-exit here.


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
REM F: environment selector - prod by default; set ZENITHJOY_ENV=staging in .env to point the agent at staging middleware
powershell -NoProfile -Command "if (!(Select-String -Path '.env' -Pattern 'ZENITHJOY_ENV' -Quiet)) { Add-Content -Path '.env' -Value 'ZENITHJOY_ENV=prod'; Write-Host '[setup] ZENITHJOY_ENV=prod appended to .env (set to staging to target staging-autopilot)' }"

REM Step 1.8: Normalize .env line endings - strip \r so CRLF files don't pollute env vars
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
REM === Step 3.5 (F): Environment selection ===
REM ZENITHJOY_ENV=staging points the agent at the staging middleware (staging-autopilot) so the Lead
REM can self-verify without hand-editing .env. Default (unset / 'prod') keeps production URLs.
REM Order matters: an explicitly-defined ZENITHJOY_API_BASE/URL (advanced override) always wins; then
REM staging fills staging defaults when ZENITHJOY_ENV=staging; finally prod defaults backfill anything left.
if /i "%ZENITHJOY_ENV%"=="staging" (
    if not defined ZENITHJOY_API_BASE set "ZENITHJOY_API_BASE=https://staging-autopilot.zenjoymedia.media"
    if not defined ZENITHJOY_API_URL set "ZENITHJOY_API_URL=wss://staging-autopilot.zenjoymedia.media/agent-ws"
    echo [env] ZENITHJOY_ENV=staging - targeting staging-autopilot middleware
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

REM === Lock-update removed (2026-06-24) ===
REM The old four-layer lock (rename WeixinUpdate.exe + firewall block + AutoUpdate=0) is gone:
REM it did not actually hold (clients restarted WeChat and it auto-upgraded to 4.1.10 anyway),
REM and 4.1.10's Qt window UIA still sends/replies fine, so the lock was both ineffective and
REM unnecessary. We no longer fight WeChat auto-update.

REM === Step 6.9: WeChat RPA environment self-check (non-blocking, module-manager handles self-heal) ===
REM preflight.py already runs automatically via module-manager after it downloads the latest module
REM (incl. _run_elevated WeChat install). start.bat no longer blocks startup, so any Windows machine
REM can self-heal without re-downloading the install pack. This is just an informational line before
REM core launch, non-blocking.
if exist "%~dp0python-embedded\python.exe" if exist "%~dp0wechat-rpa\preflight.py" (
    echo [preflight] environment self-check will run automatically via agent core module-manager after startup...
)

REM Step 6.92: Register boot autostart (idempotent, runs every time to ensure the scheduled task entry exists)
REM install-autostart.ps1 uses RunLevel Limited + ONLOGON, no admin required.
if exist "%~dp0install-autostart.ps1" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-autostart.ps1" >nul 2>&1
    echo [autostart] boot autostart registered (ZenithJoyAgent scheduled task)
) else (
    echo [autostart] install-autostart.ps1 not found, skipping (old install pack)
)

REM Step 6.93: Create windowless shortcuts (idempotent) - one "Start ZenithJoy Agent" on desktop + install dir
REM Points to start.vbs (windowless) so users only get a no-black-window entry; start.bat is for internal hidden use.
if exist "%~dp0create-shortcut.ps1" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0create-shortcut.ps1" >nul 2>&1
    echo [shortcut] windowless shortcut created (points to start.vbs)
) else (
    echo [shortcut] create-shortcut.ps1 not found, skipping (old install pack)
)

REM === P1-5 keep-alive supervisor loop entry (Sprint 07011457) ===
REM Every iteration re-runs: single-instance cleanup + re-read .active-core pointer (picks up the
REM upgraded core) + relaunch the core. Root cause (2026-07-01 rog real machine): CoreUpgrader writes
REM the .active-core pointer then process.exit(0), delegating "launch the new core" to start.bat. The
REM old start.bat only ran zenithjoy-agent.exe ONCE (foreground) then fell off the end of the script,
REM relying on the ONLOGON scheduled task to relaunch. But ONLOGON only fires at LOGON, not when the
REM core exits mid-session -> after a self-upgrade/crash the core stayed dead until the next login
REM (customer messages had no process to receive them -> no reply). This loop keeps the core alive.
:AGENT_SUPERVISE_LOOP

REM Step 6.95: Single-instance guard - kill any existing zenithjoy-agent.exe before starting
REM Two agents with the same license kick each other off the server WS connection,
REM causing repeated disconnects ("dropped again" / "out of gas" symptom when upgrading without closing old).
powershell -NoProfile -Command "Get-Process -Name zenithjoy-agent -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue" >nul 2>&1
echo [agent] previous agent processes stopped (if any)

REM Step 6.955 (hand-off B): Kill orphan listen_chat python listeners before starting.
REM Killing only the core exe above leaves the old python listen_chat as an orphan that keeps
REM grabbing WeChat for up to 24h (timeout=86400) and runs preflight in parallel -> "preflight_already_running"
REM -> module falsely shows "not installed". Match by command line so we catch python.exe AND
REM python-embedded.exe regardless of name, then kill the whole tree.
powershell -NoProfile -Command "Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*listen_chat*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1
echo [agent] orphan listen_chat listeners stopped (if any)

REM Step 6.956 (hand-off env-standardize / PR-B): purge legacy stale artifacts so every client
REM converges to ONE clean standard state (single module version + single listener + no old residue).
REM
REM 1) Remove the legacy standalone %APPDATA%\zenithjoy\zj-start-listen.bat. Older installs left this
REM    file behind pointing at an OLD module version (e.g. line04 1.0.33) + PRODUCTION middleware. The
REM    WeChat listener is now launched SOLELY by the module fork (agent core module-manager), so this
REM    rogue bat can only spawn an orphan listener on the wrong version/env -> delete it (single listener).
if exist "%APPDATA%\zenithjoy\zj-start-listen.bat" (
    powershell -NoProfile -Command "Remove-Item -LiteralPath '%APPDATA%\zenithjoy\zj-start-listen.bat' -Force -ErrorAction SilentlyContinue" >nul 2>&1
    echo [cleanup] removed legacy zj-start-listen.bat (listener now launched only by module fork)
)
REM
REM 2) Purge OLD extracted agent residue under Downloads\zenithjoy-agent-v* . Two guards so we ONLY ever
REM    delete a real old ZenithJoy agent extract and NEVER a user file or the live install:
REM      a) Signature: the directory must contain BOTH start.bat AND zenithjoy-agent.exe (Test-Path both).
REM      b) Self-exclude: skip the currently running install dir (%~dp0) and any ancestor it lives under.
powershell -NoProfile -Command "$cur=(Resolve-Path -LiteralPath '%~dp0').Path.TrimEnd('\'); $dl=Join-Path $env:USERPROFILE 'Downloads'; if (Test-Path $dl) { Get-ChildItem -Path $dl -Directory -Filter 'zenithjoy-agent-v*' -ErrorAction SilentlyContinue | Where-Object { (Test-Path (Join-Path $_.FullName 'start.bat')) -and (Test-Path (Join-Path $_.FullName 'zenithjoy-agent.exe')) -and ($_.FullName.TrimEnd('\') -ne $cur) -and (-not $cur.StartsWith($_.FullName.TrimEnd('\') + '\')) } | ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue; Write-Host ('[cleanup] removed old agent residue: ' + $_.FullName) } }" >nul 2>&1
echo [cleanup] old Downloads\zenithjoy-agent-v* residue purged (signature-verified, current install preserved)

REM === Step 6.96: Core self-upgrade/self-swap - read .active-core pointer to pick the newest core dir (Sprint 06222100) ===
REM Client layout: <root>\extracted\zenithjoy-agent-v<ver>\ (where this start.bat lives). After upgrading,
REM CoreUpgrader extracts the new core to a sibling extracted\zenithjoy-agent-v<newver>, writes the target
REM dir name into <root>\.active-core, then exits gracefully. The ONLOGON scheduled task always launches
REM this launcher; this launcher reads the .active-core pointer -> switches to the selected newest core dir
REM and runs its zenithjoy-agent.exe. So after a restart it runs the new core, no manual reinstall needed.
REM Fallback (so self-swap can't brick the client machine): pointer file missing / pointed dir's exe missing
REM -> use the local %~dp0 core.
set "CORE_RUN_DIR=%~dp0"
REM <root> = parent of extracted = grandparent of %~dp0
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
            echo [active-core] pointer selected newest core: !ACTIVE_CORE_NAME!
        ) else (
            echo [active-core] WARN pointer points to !ACTIVE_CORE_NAME! but zenithjoy-agent.exe missing - fallback to local core
        )
    ) else (
        echo [active-core] WARN .active-core pointer empty - fallback to local core
    )
) else (
    echo [active-core] no .active-core pointer, using local core (first install/not upgraded)
)

REM Step 7: Spawn agent.exe (foreground) - run the pointer-selected newest core (local if no pointer)
mkdir "%USERPROFILE%\.zj" 2>nul
echo [agent] starting zenithjoy-agent.exe (dir=%CORE_RUN_DIR%) ...
pushd "%CORE_RUN_DIR%"
zenithjoy-agent.exe
set "_AGENT_EXIT=%errorlevel%"
popd
REM === P1-5 keep-alive: after ANY core exit (self-upgrade exit0 = swap to new core / crash exit!=0)
REM auto-relaunch, never fall off the end. No pause on error (pause would freeze this loop forever,
REM the exact reason a self-upgrade left the core dead until next login on 2026-07-01). Use ping for
REM the 5s delay instead of timeout (wscript hidden launch has no stdin -> timeout errors out).
echo [supervise] core exited code=%_AGENT_EXIT% - relaunching in 5s (keep-alive self-heal)...
ping -n 6 127.0.0.1 >nul 2>&1
goto :AGENT_SUPERVISE_LOOP
