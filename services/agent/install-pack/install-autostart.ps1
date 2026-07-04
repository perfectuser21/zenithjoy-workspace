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

# 清理残留的旧版本计划任务（root cause 2026-07-04, rog）：历次调试曾在客户机上手工创建过
# 自定义命名的计划任务（如 ZJAgent / ZJClean / ZJStart52 / restart_agent），各自指向不同的
# 旧版本安装目录。这些任务名不是 $TaskName，靠下面 Register-ScheduledTask 的 -Force 覆盖注册
# 完全清不到它们。旧版本 start.bat 没有 launcher 互斥锁（decision 72740815），一旦触发（重启 /
# StartWhenAvailable 追赶）就会同时唤起多个互不知情的永生 supervise 循环：每个循环都无脑
# taskkill 全部 zenithjoy-agent.exe 再拉起自己版本，彼此打架、疯狂弹窗。这里在注册前枚举所有
# 引用 zenithjoy-agent-v* 安装路径、但任务名不是 $TaskName 的计划任务，全部清掉。
Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object {
    $_.TaskName -ne $TaskName -and (
        ($_.Actions | ForEach-Object { "$($_.Execute) $($_.Arguments)" }) -join ' ' -match 'zenithjoy-agent-v'
    )
} | ForEach-Object {
    Write-Host "[autostart] 清理残留任务: $($_.TaskName)（指向旧版本安装路径，非当前 $TaskName）"
    Unregister-ScheduledTask -TaskName $_.TaskName -Confirm:$false -ErrorAction SilentlyContinue
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
