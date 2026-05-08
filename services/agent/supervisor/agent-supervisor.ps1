# Sprint 2.1d — Agent supervisor (Windows PowerShell)
# 监控 agent 进程，死了 3s 后自动重启。最多 100 次（约 1 小时极端情况）。
$ErrorActionPreference = 'Continue'
$agentDir = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$logPath = Join-Path $agentDir "supervisor.log"
$maxRestarts = 100
$restartCount = 0

function Write-LogLine($msg) {
    $line = "[$([DateTime]::Now.ToString('yyyy-MM-dd HH:mm:ss'))] $msg"
    Write-Host $line
    Add-Content -Path $logPath -Value $line
}

Write-LogLine "[supervisor] starting, agentDir=$agentDir maxRestarts=$maxRestarts"

while ($restartCount -lt $maxRestarts) {
    Write-LogLine "[supervisor] launching agent (restart count=$restartCount)"
    try {
        $proc = Start-Process node `
            -ArgumentList "dist\index.js" `
            -WorkingDirectory $agentDir `
            -RedirectStandardOutput (Join-Path $agentDir "agent.log") `
            -RedirectStandardError  (Join-Path $agentDir "agent.err.log") `
            -PassThru `
            -WindowStyle Hidden `
            -Wait
        $exitCode = $proc.ExitCode
    } catch {
        $exitCode = -1
        Write-LogLine "[supervisor] launch failed: $_"
    }
    Write-LogLine "[supervisor] agent exited code=$exitCode, sleeping 3s before restart"
    Start-Sleep -Seconds 3
    $restartCount++
}

Write-LogLine "[supervisor] reached maxRestarts=$maxRestarts, giving up. Investigate environment."
