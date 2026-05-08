# Sprint 2.1c — Agent 启动器 v2（已迁移至 start-agent-v3.ps1）
# Sprint 2.1d 减肥：tsx fork 启动路径段已删除，改用 dist/index.js + supervisor
# 此文件保留为历史参考，新部署请使用 start-agent-v3.ps1
$env:ZENITHJOY_API_BASE = "http://100.71.151.105:5200"
$env:ZENITHJOY_API_URL = "ws://100.71.151.105:5200/agent-ws"
$env:ZENITHJOY_AGENT_CDP_URL = "http://localhost:19333"
$env:ZENITHJOY_AGENT_REAL_PUBLISH = "1"

$agentDir = Split-Path -Parent $PSCommandPath

Write-Host "[start-agent-v2] DEPRECATED: 请使用 start-agent-v3.ps1"
Write-Host "[start-agent-v2] 直接以 node dist/index.js 启动（无 supervisor 保护）"

$distIndex = Join-Path $agentDir "dist\index.js"
if (-not (Test-Path $distIndex)) {
    Write-Host "ERROR: dist/index.js not found. Run 'npm run build' first."
    exit 1
}

$proc = Start-Process -FilePath "node" `
    -ArgumentList $distIndex `
    -WorkingDirectory $agentDir `
    -PassThru `
    -WindowStyle Hidden
Write-Host "[start-agent-v2] agent PID=$($proc.Id)"
