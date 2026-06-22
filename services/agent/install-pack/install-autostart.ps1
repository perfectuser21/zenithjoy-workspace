<#
.SYNOPSIS
  注册/注销 ZenithJoy 微信监听守护的开机自启（Windows 任务计划 ONLOGON）。

.DESCRIPTION
  以当前登录用户身份，在用户登录时自动拉起 start.bat（zenithjoy-agent.exe），
  Agent 内置微信监听守护进程（startWechatListener），崩溃自动 30s 重启。客户开机后无需任何手动操作即开始接客。

.PARAMETER Unregister
  注销已注册的开机任务。

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File install-autostart.ps1
  powershell -ExecutionPolicy Bypass -File install-autostart.ps1 -Unregister
#>
param(
    [switch]$Unregister
)

$ErrorActionPreference = 'Stop'

$TaskName  = 'ZenithJoyAgent'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
# 开机自启目标 = start.vbs（无窗口入口）：登录时经 wscript 隐藏拉起 start.bat，开机即无黑窗自起。
# （旧版指向 start.bat 会闪 cmd 黑窗，本 sprint 改为 vbs 入口）
$Target    = Join-Path $ScriptDir 'start.vbs'

if ($Unregister) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "[autostart] 已注销开机自启任务 $TaskName"
    exit 0
}

if (-not (Test-Path $Target)) {
    throw "找不到 $Target — 请在安装包根目录运行本脚本"
}

# 以当前登录用户身份、登录时（ONLOGON）触发；交互式以便 listen_chat 能操作微信桌面 UI
# 显式用 wscript.exe 拉起 .vbs，不依赖系统把 .vbs 关联到 wscript（企业组策略/杀软可能改掉关联，
# 导致任务"成功"却没真拉起 Agent 且无日志）。$Target 用引号包裹，路径带空格也安全。
$action    = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$Target`"" -WorkingDirectory $ScriptDir
$trigger   = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null

Write-Host "[autostart] 已注册开机自启任务 $TaskName"
Write-Host "[autostart]   触发: 登录时（ONLOGON），用户 $env:USERNAME"
Write-Host "[autostart]   目标: $Target"
Write-Host "[autostart] 注销请运行: powershell -ExecutionPolicy Bypass -File install-autostart.ps1 -Unregister"
