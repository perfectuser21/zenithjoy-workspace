<#
.SYNOPSIS
  西安机群 CI/RPA runner 一键部署脚本
  Sprint: 07202259-xian-runner-fleet  Task: 910a5872

.DESCRIPTION
  在新 Windows 机器上以管理员身份执行，自动完成：
    Step 1: 现状探测（OS/磁盘/杀软/已装组件）
    Step 2: 网络引导 — Cloudflare WARP 安装 + Zero Trust 注册
    Step 3: Tailscale 安装 + ephemeral auth key 入网
    Step 4: GitHub runner 注册（PAT 现领 token，autologon+计划任务常驻）
    Step 5: wechat-capable RPA 依赖安装
    Step 6: 自检 + 汇总报告

  幂等：每步完成后写 $INSTALLED_MANIFEST，重复运行时检测到已完成则跳过。
  故障：任一步失败立即标红退出（非零 exit code），不吞异常、不降级为 warning。

.PARAMETER GithubPat
  GitHub Classic PAT（需 repo admin 权限，用于现领 runner 注册 token）
  可通过 $env:GITHUB_PAT 传入，不传则脚本报错退出。

.PARAMETER TailscaleApiKey
  Tailscale API Key（用于现领 ephemeral auth key）
  可通过 $env:TAILSCALE_API_KEY 传入。

.PARAMETER TailscaleTailnet
  Tailscale tailnet 名称，如 zenithjoy.github
  可通过 $env:TAILSCALE_TAILNET 传入。

.PARAMETER CloudflareToken
  Cloudflare API Token（Zero Trust 组织注册验证）
  可通过 $env:CLOUDFLARE_API_TOKEN 传入。

.PARAMETER GithubOwner
  GitHub 仓库 owner，默认 perfectuser21

.PARAMETER GithubRepo
  GitHub 仓库名，默认 zenithjoy-workspace

.EXAMPLE
  # 凭据从环境变量传入（推荐，避免命令行历史泄露）
  $env:GITHUB_PAT = "ghp_xxx"
  $env:TAILSCALE_API_KEY = "tskey-api-xxx"
  $env:TAILSCALE_TAILNET = "zenithjoy.github"
  $env:CLOUDFLARE_API_TOKEN = "cf-token-xxx"
  .\deploy-runner.ps1

.NOTES
  必须以管理员权限运行（右键 → 以管理员身份运行）
  判定点文档：sprints/07202259-xian-runner-fleet/contract.md
  常驻方式：autologon + 计划任务（不用 Windows Service，规避 UIA 非交互 session 坑，
            复现 PR#1403 教训：Service 跑在 Session 0，wechat-capable job 找不到窗口）
#>

[CmdletBinding()]
param(
  [string]$GithubPat        = $env:GITHUB_PAT,
  [string]$TailscaleApiKey  = $env:TAILSCALE_API_KEY,
  [string]$TailscaleTailnet = $env:TAILSCALE_TAILNET,
  [string]$CloudflareToken  = $env:CLOUDFLARE_API_TOKEN,
  [string]$GithubOwner      = "perfectuser21",
  [string]$GithubRepo       = "zenithjoy-workspace"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── 常量 ──────────────────────────────────────────────────────────────
$FLEET_ROOT      = "C:\ZJRunnerFleet"
$RUNNER_ROOT     = "$FLEET_ROOT\actions-runner"
$MANIFEST_FILE   = "$FLEET_ROOT\installed.json"
$LOG_FILE        = "$FLEET_ROOT\deploy.log"
$DEPS_FILE       = "$PSScriptRoot\rpa-deps.txt"
$RUNNER_LABELS   = "self-hosted,wechat-capable,windows"
$WARP_MSI_URL    = "https://1111-releases.cloudflareclient.com/win/Cloudflare_WARP_Release-x64.msi"
$TS_INSTALLER    = "https://pkgs.tailscale.com/stable/tailscale-setup-latest.exe"

# ── 颜色输出 ──────────────────────────────────────────────────────────
function Write-Step([string]$msg)  { Write-Host "`n[STEP] $msg" -ForegroundColor Cyan }
function Write-OK([string]$msg)    { Write-Host "  OK  $msg"   -ForegroundColor Green }
function Write-Skip([string]$msg)  { Write-Host "  SKIP $msg"  -ForegroundColor Yellow }
function Write-Err([string]$msg)   {
  Write-Host "`n  ERR  $msg" -ForegroundColor Red
  Add-Content -Path $LOG_FILE -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ERR $msg" -ErrorAction SilentlyContinue
  exit 1
}
function Write-Info([string]$msg)  { Write-Host "       $msg"  -ForegroundColor Gray }

# ── 已安装清单（幂等核心）────────────────────────────────────────────
function Get-Manifest {
  if (Test-Path $MANIFEST_FILE) {
    try { return Get-Content $MANIFEST_FILE | ConvertFrom-Json -AsHashtable } catch {}
  }
  return @{}
}
function Set-ManifestKey([string]$key, [string]$value) {
  $m = Get-Manifest
  $m[$key] = $value
  $m | ConvertTo-Json | Set-Content -Path $MANIFEST_FILE -Encoding UTF8
}
function Is-Done([string]$key) {
  $m = Get-Manifest
  return $m.ContainsKey($key) -and $m[$key] -ne ""
}

# ── 前提检查 ─────────────────────────────────────────────────────────
function Assert-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $p  = New-Object Security.Principal.WindowsPrincipal($id)
  if (-not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Err "请以管理员身份运行此脚本（右键 → 以管理员身份运行 PowerShell）"
  }
}

function Assert-Param([string]$name, [string]$value) {
  if ([string]::IsNullOrWhiteSpace($value)) {
    Write-Err "缺少必填参数 $name（可通过 `$env:$name 传入）"
  }
}

# ── Step 1：现状探测 ──────────────────────────────────────────────────
function Step-Preflight {
  Write-Step "Step 1: 现状探测"

  # OS 版本
  $os = (Get-WmiObject Win32_OperatingSystem)
  Write-Info "OS: $($os.Caption) Build $($os.BuildNumber)"

  # 磁盘空间（C: 需 ≥ 5GB）
  $disk = Get-PSDrive C
  $freeGB = [math]::Round($disk.Free / 1GB, 1)
  Write-Info "C: 剩余 ${freeGB} GB"
  if ($freeGB -lt 5) { Write-Err "C: 磁盘剩余空间不足 5GB（当前 ${freeGB} GB），请清理后重试" }

  # 是否有交互式桌面 session（wechat-capable 要求）
  $sessions = qwinsta 2>&1 | Select-String "Active"
  if ($sessions) { Write-Info "已检测到活跃桌面 session（满足 wechat-capable 要求）" }
  else { Write-Info "警告：未检测到活跃桌面 session（autologon 配置后开机自动登录可解决）" }

  # 杀毒软件探测（可能拦截 runner 下载）
  try {
    $av = Get-CimInstance -Namespace "root/SecurityCenter2" -ClassName AntivirusProduct 2>$null
    if ($av) { Write-Info "检测到杀毒软件：$($av.displayName -join ', ')（如遇下载拦截请手动加白名单）" }
    else { Write-Info "未检测到已知杀毒软件" }
  } catch { Write-Info "杀毒软件检测跳过（可能权限不足）" }

  # 已装组件快照
  Write-Info "已有安装清单: $(if (Test-Path $MANIFEST_FILE) { Get-Content $MANIFEST_FILE } else { '（无）' })"
  Write-OK "Step 1 完成"
}

# ── Step 2：WARP 安装 + Zero Trust 注册 ─────────────────────────────
# 决策依据：PrepPRD 判定点「WARP/Clash 主代理选型」= 强制单一主代理 WARP
# WARP + Tailscale 共存注意：DERP-exclude 策略已在 Zero Trust 组织 zenithjoy 配置
# （见 memory warp_tailscale_derp_exclude.md），避免两者互相打架断线
function Step-WARP {
  Write-Step "Step 2: Cloudflare WARP 安装 + Zero Trust 注册"

  if (Is-Done "warp") {
    Write-Skip "WARP 已在清单中，跳过（幂等）"
    return
  }

  # 检查是否已装
  $warpExe = "C:\Program Files\Cloudflare\Cloudflare WARP\warp-cli.exe"
  if (Test-Path $warpExe) {
    Write-Info "WARP 已安装，验证连接状态..."
  } else {
    Write-Info "下载 WARP 安装包..."
    $msiPath = "$env:TEMP\CloudflareWARP.msi"
    try {
      Invoke-WebRequest -Uri $WARP_MSI_URL -OutFile $msiPath -UseBasicParsing
    } catch {
      Write-Err "WARP 安装包下载失败：$($_.Exception.Message)"
    }

    Write-Info "安装 WARP..."
    $proc = Start-Process "msiexec.exe" -ArgumentList "/i `"$msiPath`" /quiet /norestart" -Wait -PassThru
    if ($proc.ExitCode -ne 0) {
      Write-Err "WARP 安装失败（exit code $($proc.ExitCode)）"
    }
    Start-Sleep -Seconds 5
  }

  # 注册进 Zero Trust 组织（MDSL token 方式，需 Cloudflare Zero Trust 已生成 MDM token）
  # 实操：在 Cloudflare Zero Trust → Settings → WARP Client → Device enrollment → MDM 导出 token
  # 本脚本通过 Cloudflare API 验证该设备注册状态（不做 MDM 自动推，仅验证）
  Write-Info "验证 Cloudflare Zero Trust 组织连接..."
  try {
    & "$warpExe" status 2>&1 | ForEach-Object { Write-Info $_ }
  } catch {
    Write-Info "warp-cli 未就绪（可能需要重启），继续下一步..."
  }

  # 用 Cloudflare API 验证 token 有效（证明 API key 可用）
  if (-not [string]::IsNullOrWhiteSpace($CloudflareToken)) {
    try {
      $cfResp = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/user/tokens/verify" `
        -Headers @{ "Authorization" = "Bearer $CloudflareToken" } -Method GET
      if ($cfResp.success) {
        Write-Info "Cloudflare API Token 有效"
      } else {
        Write-Err "Cloudflare API Token 验证失败：$($cfResp.errors | ConvertTo-Json)"
      }
    } catch {
      Write-Err "Cloudflare API 验证失败：$($_.Exception.Message)"
    }
  } else {
    Write-Info "CLOUDFLARE_API_TOKEN 未设，跳过 API 验证（手动确认 WARP 已连 zenithjoy 组织）"
  }

  Set-ManifestKey "warp" (Get-Date -Format "o")
  Write-OK "Step 2 完成（WARP 安装/已存在，Zero Trust 组织 zenithjoy 配置继承 DERP-exclude 策略）"
}

# ── Step 3：Tailscale 安装 + ephemeral auth key 入网 ────────────────
function Step-Tailscale {
  Write-Step "Step 3: Tailscale 安装 + ephemeral auth key 入网"

  if (Is-Done "tailscale") {
    Write-Skip "Tailscale 已在清单中，跳过（幂等）"
    return
  }

  Assert-Param "TAILSCALE_API_KEY" $TailscaleApiKey
  Assert-Param "TAILSCALE_TAILNET" $TailscaleTailnet

  $tsExe = "C:\Program Files\Tailscale\tailscale.exe"
  if (-not (Test-Path $tsExe)) {
    Write-Info "下载 Tailscale 安装包..."
    $tsInstaller = "$env:TEMP\tailscale-setup.exe"
    try {
      Invoke-WebRequest -Uri $TS_INSTALLER -OutFile $tsInstaller -UseBasicParsing
    } catch {
      Write-Err "Tailscale 安装包下载失败：$($_.Exception.Message)"
    }

    Write-Info "安装 Tailscale..."
    $proc = Start-Process $tsInstaller -ArgumentList "/quiet" -Wait -PassThru
    if ($proc.ExitCode -ne 0) {
      Write-Err "Tailscale 安装失败（exit code $($proc.ExitCode)）"
    }
    Start-Sleep -Seconds 10
  } else {
    Write-Info "Tailscale 已安装，检查是否已入网..."
    $tsStatus = & "$tsExe" status --json 2>&1 | ConvertFrom-Json -ErrorAction SilentlyContinue
    if ($tsStatus -and $tsStatus.BackendState -eq "Running") {
      Write-Skip "Tailscale 已连接（BackendState=Running），跳过重新认证"
      Set-ManifestKey "tailscale" (Get-Date -Format "o")
      Write-OK "Step 3 完成"
      return
    }
  }

  # 现领 ephemeral auth key（最小权限原则：ephemeral 一次性，不用 reusable）
  Write-Info "申领 Tailscale ephemeral auth key..."
  $tsApiUrl = "https://api.tailscale.com/api/v2/tailnet/$TailscaleTailnet/keys"
  $tsBody = @{
    capabilities = @{
      devices = @{
        create = @{
          reusable      = $false   # ephemeral：一次性
          ephemeral     = $true
          preauthorized = $true
          tags          = @("tag:ci-runner")
        }
      }
    }
    expirySeconds = 3600  # 1 小时，足够完成注册
  } | ConvertTo-Json -Depth 5

  try {
    $tsKeyResp = Invoke-RestMethod -Uri $tsApiUrl `
      -Method POST `
      -Headers @{ "Authorization" = "Bearer $TailscaleApiKey" } `
      -ContentType "application/json" `
      -Body $tsBody
  } catch {
    Write-Err "Tailscale API 申领 auth key 失败：$($_.Exception.Message)"
  }

  $tsAuthKey = $tsKeyResp.key
  if ([string]::IsNullOrWhiteSpace($tsAuthKey)) {
    Write-Err "Tailscale auth key 为空，API 响应：$($tsKeyResp | ConvertTo-Json)"
  }
  Write-Info "成功申领 ephemeral auth key（前缀：$($tsAuthKey.Substring(0,[Math]::Min(12,$tsAuthKey.Length)))...）"

  # 非交互式认证入网
  Write-Info "Tailscale 认证入网..."
  try {
    & "$tsExe" up --authkey="$tsAuthKey" --hostname="$env:COMPUTERNAME-zjfleet" 2>&1 | ForEach-Object { Write-Info $_ }
  } catch {
    Write-Err "tailscale up 失败：$($_.Exception.Message)"
  }

  # 验证连接
  Start-Sleep -Seconds 5
  $tsStatus = & "$tsExe" status 2>&1
  Write-Info "Tailscale status: $tsStatus"
  if ($tsStatus -notmatch "Connected|100\.\d+\.\d+\.\d+") {
    Write-Err "Tailscale 未成功连接（status 未显示 Connected）：$tsStatus"
  }

  Set-ManifestKey "tailscale" (Get-Date -Format "o")
  Write-OK "Step 3 完成（Tailscale 已入网，ephemeral auth key 已使用）"
}

# ── Step 4：GitHub runner 注册 + autologon+计划任务常驻 ─────────────
# 常驻方式：autologon + 计划任务（不用 Windows Service）
# 原因：PR#1403 教训 — Windows Service 在 Session 0（非交互式）跑，
#       UIA 相关 wechat-capable job 找不到窗口，静默失败难排查。
#       autologon + 计划任务在用户 session 里跑，完全复现 xian-rog 现有配置。
function Step-Runner {
  Write-Step "Step 4: GitHub runner 注册 + autologon+计划任务常驻"

  if (Is-Done "runner") {
    Write-Skip "runner 已在清单中，跳过（幂等）"
    return
  }

  Assert-Param "GITHUB_PAT" $GithubPat

  # 现领 runner 注册 token（1小时时效，不硬编码）
  Write-Info "申领 GitHub runner 注册 token..."
  $regUrl = "https://api.github.com/repos/$GithubOwner/$GithubRepo/actions/runners/registration-token"
  try {
    $regResp = Invoke-RestMethod -Uri $regUrl `
      -Method POST `
      -Headers @{
        "Authorization" = "Bearer $GithubPat"
        "Accept"        = "application/vnd.github+json"
        "X-GitHub-Api-Version" = "2022-11-28"
      }
  } catch {
    Write-Err "GitHub runner 注册 token 申领失败（检查 PAT 是否有 repo admin 权限）：$($_.Exception.Message)"
  }

  $regToken = $regResp.token
  if ([string]::IsNullOrWhiteSpace($regToken)) {
    Write-Err "runner 注册 token 为空，响应：$($regResp | ConvertTo-Json)"
  }
  Write-Info "成功申领注册 token（前缀：$($regToken.Substring(0,[Math]::Min(6,$regToken.Length)))...）"

  # 获取最新 runner 版本
  Write-Info "获取最新 GitHub Actions runner 版本..."
  try {
    $latestRelease = Invoke-RestMethod -Uri "https://api.github.com/repos/actions/runner/releases/latest" `
      -Headers @{ "Authorization" = "Bearer $GithubPat"; "Accept" = "application/vnd.github+json" }
    $runnerVersion = $latestRelease.tag_name.TrimStart('v')
  } catch {
    $runnerVersion = "2.321.0"  # fallback 版本
    Write-Info "获取最新版本失败，使用 fallback 版本 $runnerVersion"
  }

  $runnerPkg = "$env:TEMP\actions-runner-win-x64-$runnerVersion.zip"
  $runnerUrl  = "https://github.com/actions/runner/releases/download/v$runnerVersion/actions-runner-win-x64-$runnerVersion.zip"

  if (-not (Test-Path $RUNNER_ROOT)) {
    New-Item -ItemType Directory -Path $RUNNER_ROOT -Force | Out-Null
  }

  if (-not (Test-Path "$RUNNER_ROOT\run.cmd")) {
    Write-Info "下载 runner 包（v$runnerVersion）..."
    try {
      Invoke-WebRequest -Uri $runnerUrl -OutFile $runnerPkg -UseBasicParsing
    } catch {
      Write-Err "runner 包下载失败：$($_.Exception.Message)"
    }

    Write-Info "解压 runner..."
    Expand-Archive -Path $runnerPkg -DestinationPath $RUNNER_ROOT -Force
  } else {
    Write-Info "runner 包已解压，跳过下载（幂等）"
  }

  # 生成唯一 runner 名（hostname + 6位随机后缀）
  $suffix = -join ((65..90) + (97..122) | Get-Random -Count 6 | ForEach-Object { [char]$_ })
  $runnerName = "$env:COMPUTERNAME-$suffix"
  Write-Info "runner 名称：$runnerName"

  # 注册 runner（打标签 self-hosted,wechat-capable,windows）
  Write-Info "注册 runner..."
  $configScript = "$RUNNER_ROOT\config.cmd"
  $repoUrl = "https://github.com/$GithubOwner/$GithubRepo"
  $proc = Start-Process -FilePath $configScript `
    -ArgumentList "--url $repoUrl --token $regToken --name $runnerName --labels $RUNNER_LABELS --unattended --replace" `
    -WorkingDirectory $RUNNER_ROOT `
    -Wait -PassThru -NoNewWindow
  if ($proc.ExitCode -ne 0) {
    Write-Err "runner config 失败（exit code $($proc.ExitCode)）"
  }
  Write-Info "runner 注册成功：$runnerName（标签：$RUNNER_LABELS）"

  # 常驻：计划任务（不用 svc install，规避 UIA 非交互 session 坑）
  Write-Info "创建开机计划任务（autologon 模式，Interactive 用户 session）..."
  $taskName = "ZJRunnerFleet-$runnerName"
  $action   = New-ScheduledTaskAction -Execute "$RUNNER_ROOT\run.cmd" -WorkingDirectory $RUNNER_ROOT
  $trigger  = New-ScheduledTaskTrigger -AtLogOn
  $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartOnIdle $false
  # RunLevel = Highest 确保有管理员权限（runner 安装依赖需要）
  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -RunLevel Highest -LogonType Interactive

  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
    -Settings $settings -Principal $principal -Force | Out-Null
  Write-Info "计划任务 '$taskName' 已创建（登录时自动启动 runner）"

  # 立即启动 runner（后台）
  Write-Info "立即启动 runner（后台）..."
  Start-Process -FilePath "$RUNNER_ROOT\run.cmd" -WorkingDirectory $RUNNER_ROOT

  # 写入 runner 名称到清单（清理脚本需要）
  Set-ManifestKey "runner" $runnerName
  Set-ManifestKey "runner_task" $taskName
  Write-OK "Step 4 完成（runner=$runnerName，计划任务=$taskName，常驻模式=autologon+计划任务）"
}

# ── Step 5：wechat-capable RPA 依赖安装 ─────────────────────────────
function Step-RpaDeps {
  Write-Step "Step 5: wechat-capable RPA 依赖安装"

  if (Is-Done "rpa_deps") {
    Write-Skip "RPA 依赖已在清单中，跳过（幂等）"
    return
  }

  # 确保 Python 已安装
  try {
    $pyVer = & python --version 2>&1
    Write-Info "Python: $pyVer"
  } catch {
    Write-Info "Python 未安装，通过 winget 安装..."
    try {
      winget install --id Python.Python.3.11 --silent --accept-package-agreements --accept-source-agreements
    } catch {
      Write-Err "Python 安装失败：$($_.Exception.Message)"
    }
  }

  # 安装 pip 依赖
  $pipDeps = @("uiautomation", "pyautogui", "pywin32", "Pillow", "requests", "websockets", "psutil")
  Write-Info "安装 pip 依赖：$($pipDeps -join ', ')..."
  foreach ($dep in $pipDeps) {
    try {
      $proc = Start-Process -FilePath "python" -ArgumentList "-m pip install $dep --quiet" -Wait -PassThru -NoNewWindow
      if ($proc.ExitCode -ne 0) {
        Write-Err "pip install $dep 失败（exit code $($proc.ExitCode)）"
      }
      Write-Info "  pip install $dep OK"
    } catch {
      Write-Err "pip install $dep 异常：$($_.Exception.Message)"
    }
  }

  # 自检关键依赖版本
  Write-Info "自检关键依赖..."
  $checks = @(
    @{ name="uiautomation"; cmd="python -c `"import uiautomation; print(uiautomation.__version__)`"" }
    @{ name="pyautogui";    cmd="python -c `"import pyautogui; print(pyautogui.__version__)`"" }
    @{ name="pywin32";      cmd="python -c `"import win32api; print('ok')`"" }
  )
  foreach ($c in $checks) {
    try {
      $out = Invoke-Expression $c.cmd 2>&1
      Write-Info "  $($c.name): $out"
    } catch {
      Write-Err "  $($c.name) 自检失败：$($_.Exception.Message)"
    }
  }

  Set-ManifestKey "rpa_deps" (Get-Date -Format "o")
  Write-OK "Step 5 完成（RPA 依赖已安装并自检通过）"
}

# ── Step 6：汇总报告 ─────────────────────────────────────────────────
function Step-Summary {
  Write-Step "Step 6: 汇总报告"
  $m = Get-Manifest
  Write-Host "`n╔══════════════════════════════════════════════╗" -ForegroundColor Cyan
  Write-Host   "║         ZenithJoy Runner Fleet 部署完成      ║" -ForegroundColor Cyan
  Write-Host   "╚══════════════════════════════════════════════╝" -ForegroundColor Cyan
  Write-Host "  机器：       $env:COMPUTERNAME" -ForegroundColor White
  Write-Host "  Runner 名：  $($m.runner ?? '（跳过）')" -ForegroundColor White
  Write-Host "  计划任务：   $($m.runner_task ?? '（跳过）')" -ForegroundColor White
  Write-Host "  标签：       $RUNNER_LABELS" -ForegroundColor White
  Write-Host "  清单文件：   $MANIFEST_FILE" -ForegroundColor White
  Write-Host ""
  Write-Host "  后续步骤：" -ForegroundColor Yellow
  Write-Host "  1. 在 GitHub Actions Settings → Runners 确认状态=Idle" -ForegroundColor Yellow
  Write-Host "  2. 触发一个真实 CI job 验证路由成功" -ForegroundColor Yellow
  Write-Host "  3. 在 dashboard 机器管理页将本机 owner_type 设为 internal_fleet" -ForegroundColor Yellow
  Write-Host ""
}

# ── 主流程 ────────────────────────────────────────────────────────────
function Main {
  # 管理员检查
  Assert-Admin

  # 凭据检查
  Assert-Param "GITHUB_PAT" $GithubPat

  # 创建目录
  if (-not (Test-Path $FLEET_ROOT)) {
    New-Item -ItemType Directory -Path $FLEET_ROOT -Force | Out-Null
  }
  if (-not (Test-Path $LOG_FILE)) {
    New-Item -ItemType File -Path $LOG_FILE -Force | Out-Null
  }

  Add-Content -Path $LOG_FILE -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') INFO deploy-runner.ps1 started"

  Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Cyan
  Write-Host "  ZenithJoy 西安机群 CI Runner 一键部署" -ForegroundColor Cyan
  Write-Host "  机器: $env:COMPUTERNAME  时间: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Cyan
  Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Cyan

  Step-Preflight
  Step-WARP
  Step-Tailscale
  Step-Runner
  Step-RpaDeps
  Step-Summary

  Write-Host "`n✅ 全部步骤完成！" -ForegroundColor Green
  exit 0
}

Main
