<#
.SYNOPSIS
  西安机群 CI/RPA runner 一键清理脚本
  Sprint: 07202259-xian-runner-fleet  Task: 910a5872

.DESCRIPTION
  白名单式清理 — 只清理 deploy-runner.ps1 自己安装的组件。
  判断依据：$FLEET_ROOT\installed.json（部署时生成的清单文件）。
  机器上其他历史遗留（如 xian-rog 手工配置）一律不动。

  清理顺序（与安装相反）：
    1. 停止并删除计划任务（runner 常驻）
    2. 注销 GitHub runner（向 GitHub 发 DELETE，避免 runner 列表积累僵尸）
    3. 删除 runner 目录
    4. 清空清单文件

  注意：WARP 和 Tailscale 默认不卸载（避免误删办公网络配置）。
        如需卸载，传 -RemoveNetwork $true。

.PARAMETER GithubPat
  GitHub Classic PAT（用于调 runner 注销 API）

.PARAMETER RemoveNetwork
  $true 时同时卸载 WARP 和 Tailscale（默认 $false，不动网络组件）

.EXAMPLE
  # 基础清理（只清 runner，不动网络层）
  $env:GITHUB_PAT = "ghp_xxx"
  .\cleanup-runner.ps1

  # 完整清理（包括网络组件）
  .\cleanup-runner.ps1 -RemoveNetwork $true
#>

[CmdletBinding()]
param(
  [string]$GithubPat    = $env:GITHUB_PAT,
  [string]$GithubOwner  = "perfectuser21",
  [string]$GithubRepo   = "zenithjoy-workspace",
  [bool]$RemoveNetwork  = $false
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$FLEET_ROOT    = "C:\ZJRunnerFleet"
$RUNNER_ROOT   = "$FLEET_ROOT\actions-runner"
$MANIFEST_FILE = "$FLEET_ROOT\installed.json"

function Write-Step([string]$msg)  { Write-Host "`n[CLEAN] $msg" -ForegroundColor Cyan }
function Write-OK([string]$msg)    { Write-Host "  OK  $msg"    -ForegroundColor Green }
function Write-Skip([string]$msg)  { Write-Host "  SKIP $msg"   -ForegroundColor Yellow }
function Write-Info([string]$msg)  { Write-Host "       $msg"   -ForegroundColor Gray }
function Write-Warn([string]$msg)  { Write-Host "  WARN $msg"   -ForegroundColor Yellow }
function Write-Err([string]$msg)   { Write-Host "`n  ERR  $msg" -ForegroundColor Red; exit 1 }

function Get-Manifest {
  if (Test-Path $MANIFEST_FILE) {
    try { return Get-Content $MANIFEST_FILE | ConvertFrom-Json -AsHashtable } catch {}
  }
  return @{}
}

# ── 校验清单存在 ─────────────────────────────────────────────────────
if (-not (Test-Path $MANIFEST_FILE)) {
  Write-Warn "未找到清单文件 $MANIFEST_FILE（deploy-runner.ps1 未曾运行过，或已清理完毕）"
  Write-Host "无需清理，退出。" -ForegroundColor Yellow
  exit 0
}

$manifest = Get-Manifest
Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  ZenithJoy 西安机群 CI Runner 一键清理（白名单式）" -ForegroundColor Cyan
Write-Host "  清单来源：$MANIFEST_FILE" -ForegroundColor Cyan
Write-Host "  内容：$(Get-Content $MANIFEST_FILE)" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Cyan

# ── 1. 停止并删除计划任务 ────────────────────────────────────────────
Write-Step "1. 删除 runner 计划任务"
$taskName = $manifest["runner_task"] ?? ""
if ([string]::IsNullOrWhiteSpace($taskName)) {
  Write-Skip "清单中无 runner_task，跳过"
} else {
  try {
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($task) {
      Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
      Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
      Write-OK "计划任务 '$taskName' 已删除"
    } else {
      Write-Skip "计划任务 '$taskName' 不存在（已清理或从未创建）"
    }
  } catch {
    Write-Warn "删除计划任务失败（不影响继续清理）：$($_.Exception.Message)"
  }
}

# ── 2. 注销 GitHub runner ────────────────────────────────────────────
Write-Step "2. 注销 GitHub runner"
$runnerName = $manifest["runner"] ?? ""
if ([string]::IsNullOrWhiteSpace($runnerName)) {
  Write-Skip "清单中无 runner，跳过"
} elseif ([string]::IsNullOrWhiteSpace($GithubPat)) {
  Write-Warn "GITHUB_PAT 未设，无法调 API 注销 runner（runner '$runnerName' 可能留在 GitHub 列表，手动删除）"
} else {
  try {
    # 先找到 runner ID
    $runnersResp = Invoke-RestMethod -Uri "https://api.github.com/repos/$GithubOwner/$GithubRepo/actions/runners" `
      -Headers @{ "Authorization" = "Bearer $GithubPat"; "Accept" = "application/vnd.github+json" }
    $runner = $runnersResp.runners | Where-Object { $_.name -eq $runnerName } | Select-Object -First 1
    if ($runner) {
      # 先领 remove token
      $removeTokenResp = Invoke-RestMethod `
        -Uri "https://api.github.com/repos/$GithubOwner/$GithubRepo/actions/runners/remove-token" `
        -Method POST `
        -Headers @{ "Authorization" = "Bearer $GithubPat"; "Accept" = "application/vnd.github+json" }
      $removeToken = $removeTokenResp.token

      # 用 runner 自带 config.cmd 注销
      if (Test-Path "$RUNNER_ROOT\config.cmd") {
        $proc = Start-Process -FilePath "$RUNNER_ROOT\config.cmd" `
          -ArgumentList "remove --token $removeToken" `
          -WorkingDirectory $RUNNER_ROOT -Wait -PassThru -NoNewWindow
        if ($proc.ExitCode -eq 0) {
          Write-OK "runner '$runnerName' 已从 GitHub 注销"
        } else {
          Write-Warn "runner config remove 退出码非零（$($proc.ExitCode)），尝试 API 直接删除..."
          Invoke-RestMethod `
            -Uri "https://api.github.com/repos/$GithubOwner/$GithubRepo/actions/runners/$($runner.id)" `
            -Method DELETE `
            -Headers @{ "Authorization" = "Bearer $GithubPat"; "Accept" = "application/vnd.github+json" }
          Write-OK "runner '$runnerName' 已通过 API 删除"
        }
      } else {
        Write-Warn "runner 目录已不存在，直接通过 API 删除..."
        Invoke-RestMethod `
          -Uri "https://api.github.com/repos/$GithubOwner/$GithubRepo/actions/runners/$($runner.id)" `
          -Method DELETE `
          -Headers @{ "Authorization" = "Bearer $GithubPat"; "Accept" = "application/vnd.github+json" }
        Write-OK "runner '$runnerName' 已通过 API 删除"
      }
    } else {
      Write-Skip "GitHub 上未找到 runner '$runnerName'（已注销或从未注册）"
    }
  } catch {
    Write-Warn "runner 注销过程出错（不影响继续清理）：$($_.Exception.Message)"
  }
}

# ── 3. 删除 runner 目录 ─────────────────────────────────────────────
Write-Step "3. 删除 runner 目录 $RUNNER_ROOT"
if (Test-Path $RUNNER_ROOT) {
  try {
    # 先杀掉可能还在跑的 runner 进程
    Get-Process -Name "Runner.Listener","Runner.Worker" -ErrorAction SilentlyContinue |
      Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2

    Remove-Item -Path $RUNNER_ROOT -Recurse -Force
    Write-OK "runner 目录已删除"
  } catch {
    Write-Warn "删除 runner 目录失败：$($_.Exception.Message)（可手动删除 $RUNNER_ROOT）"
  }
} else {
  Write-Skip "runner 目录不存在"
}

# ── 4. 可选：卸载网络组件 ────────────────────────────────────────────
if ($RemoveNetwork) {
  Write-Step "4. 卸载网络组件（-RemoveNetwork=$RemoveNetwork）"

  # 卸载 Tailscale
  try {
    $tsApp = Get-Package -Name "*Tailscale*" -ErrorAction SilentlyContinue
    if ($tsApp) {
      Uninstall-Package -Name $tsApp.Name -Force
      Write-OK "Tailscale 已卸载"
    } else {
      Write-Skip "Tailscale 未安装"
    }
  } catch {
    Write-Warn "Tailscale 卸载失败：$($_.Exception.Message)"
  }

  # 卸载 WARP
  try {
    $warpApp = Get-Package -Name "*Cloudflare WARP*" -ErrorAction SilentlyContinue
    if ($warpApp) {
      Uninstall-Package -Name $warpApp.Name -Force
      Write-OK "Cloudflare WARP 已卸载"
    } else {
      Write-Skip "Cloudflare WARP 未安装"
    }
  } catch {
    Write-Warn "WARP 卸载失败：$($_.Exception.Message)"
  }
} else {
  Write-Step "4. 网络组件（WARP/Tailscale）保留（-RemoveNetwork=$RemoveNetwork，白名单式清理不动历史网络配置）"
  Write-Skip "跳过 WARP/Tailscale 卸载"
}

# ── 5. 清空清单文件 ──────────────────────────────────────────────────
Write-Step "5. 清空清单文件"
try {
  Remove-Item -Path $MANIFEST_FILE -Force
  Write-OK "清单文件已删除（$MANIFEST_FILE）"
} catch {
  Write-Warn "清单文件删除失败：$($_.Exception.Message)"
}

Write-Host "`n╔══════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host   "║         ZenithJoy Runner Fleet 清理完成      ║" -ForegroundColor Green
Write-Host   "╚══════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host "  已清理：runner 计划任务 + runner 注册 + runner 目录" -ForegroundColor White
Write-Host "  未动：  WARP / Tailscale / Python / RPA 依赖（历史配置保留）" -ForegroundColor Gray
Write-Host "  如需完整清理：.\cleanup-runner.ps1 -RemoveNetwork `$true" -ForegroundColor Yellow
Write-Host ""
exit 0
