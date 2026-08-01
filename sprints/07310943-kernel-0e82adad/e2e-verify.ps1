param(
  [string]$BaseUrl = 'http://localhost:5174',
  [string]$ApiUrl = 'http://localhost:3000',
  [int]$Repeat = 2,
  [string]$ScreenshotDir = 'screenshots'
)
$ErrorActionPreference = 'Stop'
$env:VITE_API_URL = $ApiUrl
$api = Start-Process npm -ArgumentList 'run','dev','--workspace','apps/api' -PassThru
$ui = Start-Process npm -ArgumentList 'run','dev','--workspace','apps/dashboard','--','--port','5174' -PassThru
try {
  foreach ($port in 3000,5174) {
    $ready = $false
    1..60 | ForEach-Object { if (Test-NetConnection localhost -Port $port -InformationLevel Quiet) { $ready = $true } else { Start-Sleep 1 } }
    if (-not $ready) { throw "port $port not ready" }
  }
  New-Item -ItemType Directory -Force -Path $ScreenshotDir | Out-Null
  1..$Repeat | ForEach-Object {
    Push-Location apps/dashboard
    npx playwright test e2e/acquisition-cancel.spec.ts --project=chromium
    Pop-Location
    if ($LASTEXITCODE -ne 0) { throw 'cancel Playwright failed' }
  }
} finally {
  Stop-Process -Id $api.Id,$ui.Id -Force -ErrorAction SilentlyContinue
}
