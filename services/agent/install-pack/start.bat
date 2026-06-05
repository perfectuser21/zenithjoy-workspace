@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

cd /d "%~dp0"

REM Unblock all executables recursively (removes Zone Identifier / Mark of the Web)
REM Without this, execFile() on bundled ffmpeg.exe / Playwright chrome.exe fails with "spawn UNKNOWN"
powershell -NoProfile -Command "Get-ChildItem -Path '%~dp0' -Recurse -Include '*.exe','*.dll' | Unblock-File" >nul 2>&1

REM Step 0: 讲述人开关 — 解锁微信 UIAutomation 访问（WeChat 4.1.x 窗口自动化前置条件）
REM 约 2 秒：Start-Process Narrator → 等待 → Stop-Process 关闭，UIAutomation 权限已获取
REM 【静默】先把讲述人语音音量归零（best-effort），避免开机弹窗时出声/抢焦点
reg add "HKCU\Software\Microsoft\Narrator" /v SpeechVolume /t REG_DWORD /d 0 /f >nul 2>&1
reg add "HKCU\Software\Microsoft\Narrator" /v WinEnterLaunch /t REG_DWORD /d 0 /f >nul 2>&1
reg add "HKCU\Software\Microsoft\Narrator\NoRoam" /v SpeechVolume /t REG_DWORD /d 0 /f >nul 2>&1
powershell -NoProfile -Command "Start-Process Narrator; Start-Sleep -Milliseconds 1500; Stop-Process -Name Narrator -ErrorAction SilentlyContinue" >nul 2>&1
echo [narrator] WeChat UIAutomation unlocked (Narrator start+stop, silenced)

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

REM Step 1.5: 追加 .env 中缺失的新 key（升级兼容，不覆盖用户已设的值）
powershell -NoProfile -Command "if (!(Select-String -Path '.env' -Pattern 'ZENITHJOY_AGENT_DRYRUN_BROWSER' -Quiet)) { Add-Content -Path '.env' -Value 'ZENITHJOY_AGENT_DRYRUN_BROWSER=mock'; Write-Host '[setup] ZENITHJOY_AGENT_DRYRUN_BROWSER=mock appended to .env' }"
powershell -NoProfile -Command "if (!(Select-String -Path '.env' -Pattern 'ZENITHJOY_AGENT_REAL_PUBLISH' -Quiet)) { Add-Content -Path '.env' -Value 'ZENITHJOY_AGENT_REAL_PUBLISH=1'; Write-Host '[setup] ZENITHJOY_AGENT_REAL_PUBLISH=1 appended to .env' }"

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
    powershell -NoProfile -Command "$dest='%ZJ_NODE_DIR%'; Expand-Archive -Path '%~dp0node-win-x64.zip' -DestinationPath '%TEMP%\zj-node-tmp' -Force; Move-Item '%TEMP%\zj-node-tmp\node-v22.16.0-win-x64\*' $dest -Force; Remove-Item '%TEMP%\zj-node-tmp' -Recurse -Force"
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

REM Step 5.6: 确保 playwright-core npm 包就位（publisher 脚本 require('playwright-core') 使用）
REM v1.1.57+ 安装包已内置 node_modules/playwright-core/，此步骤仅为旧包（≤v1.1.56）自愈兜底。
REM 失败是非致命的：agent 仍会启动，只是抖音/快手发布会报 MODULE_NOT_FOUND（提示用户重新下载新包）。
if not exist "%~dp0node_modules\playwright-core\index.js" (
    if exist "%ZJ_NODE_EXE%" (
        echo [playwright-core] 旧版安装包自愈：安装 playwright-core（仅首次，约30秒）...
        mkdir "%~dp0node_modules" 2>nul
        REM --ignore-scripts 防止 npm install 执行 pre/postinstall 脚本（安全加固）
        REM registry.npmmirror.com 是 Node.js 官方中国镜像（原 npm.taobao.org），已于2022年正式更名
        "%ZJ_NODE_EXE%" "%ZJ_NPM_CLI%" install playwright-core --prefix "%~dp0" --no-save --no-package-lock --ignore-scripts --registry https://registry.npmmirror.com
        if errorlevel 1 (
            echo [WARN] playwright-core 安装失败 — 请从控制台重新下载最新安装包（v1.1.57+）以解决发布问题
        ) else (
            REM 快速功能验证：确认模块可 require
            "%ZJ_NODE_EXE%" -e "require('playwright-core'); process.exit(0)" 2>nul
            if errorlevel 1 (
                echo [WARN] playwright-core 安装完成但验证失败，发布功能可能异常
            ) else (
                echo [playwright-core] 安装并验证通过 OK
            )
        )
    ) else (
        echo [WARN] ZJ_NODE_EXE 未就绪，跳过 playwright-core 安装 — 请重新下载 v1.1.57+ 安装包
    )
) else (
    echo [playwright-core] 已就位，跳过
)

REM Step 5.7: 设置 NODE_PATH 让 publisher 脚本能找到 node_modules（含 playwright-core）
set "NODE_PATH=%~dp0node_modules"
echo [node] NODE_PATH=%NODE_PATH%

REM Step 6: 内置 Playwright Chromium 路径（打包在 playwright-browsers/ 目录里）
REM Playwright 读 PLAYWRIGHT_BROWSERS_PATH 环境变量来定位 Chromium，无需依赖系统 Chrome
set "PLAYWRIGHT_BROWSERS_PATH=%~dp0playwright-browsers"
echo [playwright] PLAYWRIGHT_BROWSERS_PATH=%PLAYWRIGHT_BROWSERS_PATH%

REM Step 6.5: 让 hyperframes 的 puppeteer-core 也用内置 Chromium（无需另装 Chrome）
REM 找 chromium-*/chrome-win64/chrome.exe
for /f "delims=" %%d in ('dir /b /ad "%PLAYWRIGHT_BROWSERS_PATH%\chromium-*" 2^>nul') do (
    if exist "%PLAYWRIGHT_BROWSERS_PATH%\%%d\chrome-win64\chrome.exe" (
        set "PUPPETEER_EXECUTABLE_PATH=%PLAYWRIGHT_BROWSERS_PATH%\%%d\chrome-win64\chrome.exe"
        set "PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1"
        echo [puppeteer] using bundled Chromium: %%d\chrome-win64\chrome.exe
    )
)

REM === 解锁微信 UIAutomation（静默开关讲述人，约2秒）===
REM 微信 4.1.x 的 mmui 控件树要靠"有 AT 客户端(讲述人)"激活后，pywinauto 才能读取。
REM Narrator 是 Windows 自带无障碍朗读器（系统组件，非外部程序），开/关一次即激活
REM UIAutomation provider，随后立刻关闭不留后台进程。
REM 【静默】讲述人默认会出声/抢焦点 —— 启动前把它静音：
REM   - HKCU\Software\Microsoft\Narrator 下 SpeechVolume=0（语音音量归零）
REM   - WinEnterLaunch=0 防止下次自启；IntonationPause/EchoChars 等不影响激活
REM 这是最佳努力（best-effort）：注册表写失败也不阻断，UIA 仍能被激活。
echo [setup] 正在解锁微信自动化权限（讲述人静默激活）...
reg add "HKCU\Software\Microsoft\Narrator" /v SpeechVolume /t REG_DWORD /d 0 /f >nul 2>&1
reg add "HKCU\Software\Microsoft\Narrator" /v WinEnterLaunch /t REG_DWORD /d 0 /f >nul 2>&1
reg add "HKCU\Software\Microsoft\Narrator\NoRoam" /v SpeechVolume /t REG_DWORD /d 0 /f >nul 2>&1
powershell -WindowStyle Hidden -Command "Start-Process 'Narrator'; Start-Sleep 2; Stop-Process -Name 'Narrator' -ErrorAction SilentlyContinue" 2>nul
echo [setup] 完成

REM === 锁更新：防微信自动升回 4.1.9+（无障碍控件树被砍 = RPA 报废）===
REM 幂等：重复跑不报错。两手并用：
REM   1) 把 Weixin 安装目录下各版本子目录里的 WeixinUpdate.exe 改名为 .disabled
REM   2) 加防火墙出站封禁规则，挡住 WeixinUpdate.exe 联网拉新版
REM 用 dir /s /b 找真实子目录路径（版本号目录名会变，不能写死）。
echo [lock-update] 锁定微信版本，禁止自动升级...
set "_WEIXIN_ROOT=C:\Program Files\Tencent\Weixin"
if exist "%_WEIXIN_ROOT%" (
    for /f "delims=" %%u in ('dir /s /b "%_WEIXIN_ROOT%\WeixinUpdate.exe" 2^>nul') do (
        REM 1) 改名禁用（已是 .disabled 的不会再被命中，天然幂等）
        ren "%%u" "WeixinUpdate.exe.disabled" >nul 2>&1
        if exist "%%u" (
            echo [lock-update] WARN 改名失败（可能被占用）：%%u
        ) else (
            echo [lock-update] 已禁用 %%u
        )
        REM 2) 防火墙出站封禁（幂等：先删同名规则再加，避免重复堆叠）
        netsh advfirewall firewall delete rule name="Block WeixinUpdate" program="%%u" >nul 2>&1
        netsh advfirewall firewall add rule name="Block WeixinUpdate" dir=out action=block program="%%u" enable=yes >nul 2>&1
    )
    REM 对已改名为 .disabled 的也补一条防火墙规则（兜底，防被还原后联网）
    for /f "delims=" %%d in ('dir /s /b "%_WEIXIN_ROOT%\WeixinUpdate.exe.disabled" 2^>nul') do (
        set "_ORIG=%%d"
        set "_ORIG=!_ORIG:.disabled=!"
        netsh advfirewall firewall delete rule name="Block WeixinUpdate" program="!_ORIG!" >nul 2>&1
        netsh advfirewall firewall add rule name="Block WeixinUpdate" dir=out action=block program="!_ORIG!" enable=yes >nul 2>&1
    )
    echo [lock-update] 完成
) else (
    echo [lock-update] 未发现微信安装目录，跳过（%_WEIXIN_ROOT%）
)

REM === Step 6.9: 微信 RPA 开机环境自检 + 自愈（preflight）===
REM 用包内 python-embedded\python.exe 跑 wechat-rpa\preflight.py，检查并自愈微信 RPA
REM 运行所需环境（微信版本/讲述人 UIA/pywinauto/依赖等），跑完打印报告并写
REM C:\Users\Public\zj-preflight.json，中台看板可读取。
REM 中台地址复用 start.bat 既有变量 ZENITHJOY_API_BASE（preflight 自己也有默认/env 兜底）。
REM 【不硬阻断】preflight 已尽力自愈，剩余问题需人工但不该让 agent 完全不启动 —
REM 否则一个非致命的环境告警会拖垮整个发布端。所以无论返回码如何都继续拉起 agent，
REM 仅 echo 明确提示，让用户/中台看板感知。
if exist "%~dp0python-embedded\python.exe" if exist "%~dp0wechat-rpa\preflight.py" (
    echo.
    echo  ============================================================
    echo   微信 RPA 环境自检（preflight，自愈尽力，不阻断启动）
    echo  ============================================================
    "%~dp0python-embedded\python.exe" "%~dp0wechat-rpa\preflight.py" --middleware-url "%ZENITHJOY_API_BASE%"
    if errorlevel 1 (
        echo [preflight] WARN 环境自检发现问题（自愈后仍有残留），详见上方报告/中台看板，继续启动 agent
    ) else (
        echo [preflight] 环境自检通过 OK
    )
    echo.
) else (
    echo [preflight] 跳过：未找到 python-embedded 或 wechat-rpa\preflight.py（旧包或精简包）
)

REM Step 7: Spawn agent.exe (foreground)
mkdir "%USERPROFILE%\.zj" 2>nul
echo [agent] starting zenithjoy-agent.exe ...
zenithjoy-agent.exe
if errorlevel 1 (
    echo [agent] agent.exe exited with error %errorlevel%
    pause
)
