# Sprint 2.1d 生产启动器：用 dist/index.js（无 tsx fork）+ supervisor 监督
$env:ZENITHJOY_API_BASE = "http://100.71.151.105:5200"
$env:ZENITHJOY_API_URL = "ws://100.71.151.105:5200/agent-ws"
$env:ZENITHJOY_AGENT_CDP_URL = "http://localhost:19333"
$env:ZENITHJOY_AGENT_REAL_PUBLISH = "1"

$agentDir = Split-Path -Parent $PSCommandPath
$supervisorPs1 = Join-Path $agentDir "supervisor\agent-supervisor.ps1"

if (-not (Test-Path (Join-Path $agentDir "dist\index.js"))) {
    Write-Host "ERROR: dist/index.js not found. Run 'npm run build' on the dev side and scp dist/ to this machine."
    exit 1
}
if (-not (Test-Path $supervisorPs1)) {
    Write-Host "ERROR: supervisor not found at $supervisorPs1"
    exit 1
}

Write-Host "[start-agent-v3] launching supervisor in background..."
Start-Process powershell -ArgumentList "-ExecutionPolicy", "Bypass", "-File", $supervisorPs1 -WindowStyle Hidden
Write-Host "[start-agent-v3] supervisor PID is recorded in supervisor.log"
Write-Host "[start-agent-v3] OK"
