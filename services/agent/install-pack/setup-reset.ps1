param(
    [switch]$DryRun,
    [string]$EnvDeclaration = ".env"
)

$ErrorActionPreference = "Stop"

try {
    Write-Host "[setup-reset] starting (DryRun=$DryRun)"

    # -----------------------------------------------------------------------
    # Step 1: Kill zenithjoy processes (skip in DryRun)
    # -----------------------------------------------------------------------
    if (-not $DryRun) {
        $procs = Get-Process -Name zenithjoy-agent -ErrorAction SilentlyContinue
        if ($procs) {
            $procs | Stop-Process -Force -ErrorAction SilentlyContinue
            Write-Host "[setup-reset] killed $($procs.Count) zenithjoy-agent process(es)"
        } else {
            Write-Host "[setup-reset] no zenithjoy-agent process running"
        }
    } else {
        Write-Host "[setup-reset] DryRun: skipping process kill"
    }

    # -----------------------------------------------------------------------
    # Step 2: Delete stale .launcher.lock (if PID inside is dead)
    # -----------------------------------------------------------------------
    $agentDataDir = Join-Path $env:APPDATA "zenithjoy-agent"
    $lockFile = Join-Path $agentDataDir ".launcher.lock"

    if (Test-Path $lockFile) {
        $lockContent = (Get-Content $lockFile -Raw -ErrorAction SilentlyContinue) -replace '\s', ''
        # Token format is RANDOM-RANDOM-DATE-TIME, not a pure PID
        # We treat any lock from a non-running script session as stale
        # Parse: if first token segment is numeric, try to find process
        $firstToken = ($lockContent -split '-')[0]
        $isPidAlive = $false
        if ($firstToken -match '^\d+$') {
            $pid2 = [int]$firstToken
            $isPidAlive = $null -ne (Get-Process -Id $pid2 -ErrorAction SilentlyContinue)
        }
        if (-not $isPidAlive) {
            Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue
            Write-Host "[setup-reset] removed stale .launcher.lock (token=$lockContent)"
        } else {
            Write-Host "[setup-reset] .launcher.lock has alive PID=$firstToken, leaving"
        }
    } else {
        Write-Host "[setup-reset] .launcher.lock not present"
    }

    # -----------------------------------------------------------------------
    # Step 3: Read .env declared ZENITHJOY_* keys
    # -----------------------------------------------------------------------
    $declaredKeys = @()
    $envFilePath = $EnvDeclaration

    # Resolve relative to script dir if not absolute
    if (-not [System.IO.Path]::IsPathRooted($envFilePath)) {
        $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
        if (-not $scriptDir) { $scriptDir = (Get-Location).Path }
        $envFilePath = Join-Path $scriptDir $envFilePath
    }

    if (Test-Path $envFilePath) {
        $lines = Get-Content $envFilePath -Encoding utf8 -ErrorAction SilentlyContinue
        foreach ($line in $lines) {
            $trimmed = $line.Trim()
            if ($trimmed -match '^(ZENITHJOY_[A-Z0-9_]+)\s*=') {
                $declaredKeys += $Matches[1]
            }
        }
        Write-Host "[setup-reset] declared ZENITHJOY_* keys from ${envFilePath}: $($declaredKeys.Count)"
    } else {
        Write-Host "[setup-reset] .env declaration file not found at $envFilePath -- will remove ALL ZENITHJOY_* keys from HKCU"
    }

    # -----------------------------------------------------------------------
    # Step 4: Remove undeclared HKCU\Environment ZENITHJOY_* keys
    # -----------------------------------------------------------------------
    $regPath = "HKCU:\Environment"
    if (Test-Path $regPath) {
        $props = Get-Item -Path $regPath -ErrorAction SilentlyContinue
        if ($props) {
            $allValues = $props.Property
            $zenithjoyKeys = $allValues | Where-Object { $_ -match '^ZENITHJOY_' }
            foreach ($key in $zenithjoyKeys) {
                if ($declaredKeys -notcontains $key) {
                    Remove-ItemProperty -Path $regPath -Name $key -Force -ErrorAction SilentlyContinue
                    Write-Host "[setup-reset] removed undeclared HKCU Environment key: $key"
                } else {
                    Write-Host "[setup-reset] keeping declared key: $key"
                }
            }
            if (-not $zenithjoyKeys) {
                Write-Host "[setup-reset] no ZENITHJOY_* keys in HKCU Environment"
            }
        }
    } else {
        Write-Host "[setup-reset] HKCU:\Environment not found, skipping key cleanup"
    }

    # -----------------------------------------------------------------------
    # Step 5: Delete + re-create ZenithJoyAgent scheduled task (not /change)
    # -----------------------------------------------------------------------
    $taskName = "ZenithJoyAgent"
    $scriptDir2 = Split-Path -Parent $MyInvocation.MyCommand.Path
    if (-not $scriptDir2) { $scriptDir2 = (Get-Location).Path }
    $startVbs = Join-Path $scriptDir2 "start.vbs"

    # Delete existing task (ignore error if not found)
    $savedEAP = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    schtasks /delete /tn $taskName /f 2>&1 | Out-Null
    $ErrorActionPreference = $savedEAP
    Write-Host "[setup-reset] deleted scheduled task $taskName (if existed)"

    # Re-create with /it (interactive) so it has access to UI sessions
    $createArgs = @(
        "/create",
        "/tn", $taskName,
        "/tr", "wscript.exe `"$startVbs`"",
        "/sc", "ONLOGON",
        "/rl", "LIMITED",
        "/it",
        "/f"
    )
    $result = schtasks @createArgs 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] schtasks /create failed: $result"
        throw "schtasks /create ZenithJoyAgent failed (exit $LASTEXITCODE)"
    }
    Write-Host "[setup-reset] ZenithJoyAgent scheduled task re-created (ONLOGON, LIMITED, /it)"

    Write-Host "[setup-reset] done"

} catch {
    Write-Host "[ERROR] setup-reset failed: $_"
    exit 1
}
