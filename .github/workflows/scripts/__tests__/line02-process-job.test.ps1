$ErrorActionPreference = 'Stop'
$source = (Resolve-Path (Join-Path $PSScriptRoot '..\line02-process-job.cs')).Path
Add-Type -Path $source
$root = Join-Path ([IO.Path]::GetTempPath()) ('zj-process-job-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root | Out-Null
$childScript = Join-Path $root 'child.ps1'
@'
param($Source, $JobName, $Proof)
$ErrorActionPreference = 'Stop'
Add-Type -Path $Source
[ZJProcessGroup]::Attach($JobName)
$child = Start-Process powershell.exe -ArgumentList '-NoProfile -Command "Start-Sleep -Seconds 60"' -PassThru
@(@{pid=$PID;start_ticks=(Get-Process -Id $PID).StartTime.ToUniversalTime().Ticks},@{pid=$child.Id;start_ticks=$child.StartTime.ToUniversalTime().Ticks}) | ConvertTo-Json | Set-Content ($Proof+'.partial')
Move-Item ($Proof+'.partial') $Proof
Start-Sleep -Seconds 60
'@ | Set-Content -LiteralPath $childScript -Encoding ascii
try {
    foreach ($method in @('Reap', 'Dispose')) {
        $name = 'Global\ZJProcessTest-' + [guid]::NewGuid().ToString('N')
        $group = New-Object ZJProcessGroup($name, [Security.Principal.WindowsIdentity]::GetCurrent().User.Value)
        $proof = Join-Path $root ($method + '.json')
        $child = $null
        try {
            $args = '-NoProfile -File "' + $childScript + '" -Source "' + $source + '" -JobName "' + $name + '" -Proof "' + $proof + '"'
            $child = Start-Process powershell.exe -ArgumentList $args -PassThru -RedirectStandardError (Join-Path $root ($method+'.stderr'))
            $deadline = (Get-Date).AddSeconds(20)
            while (-not (Test-Path -LiteralPath $proof)) {
                if ((Get-Date) -ge $deadline) { throw 'fixture child did not enter job' }
                Start-Sleep -Milliseconds 100
            }
            $identities = Get-Content -LiteralPath $proof -Raw | ConvertFrom-Json
            # Capture handles before termination. Get-Process can return an exiting
            # process whose StartTime is already unavailable; PID polling races exit.
            $processes = @($identities | ForEach-Object {
                $process = Get-Process -Id $_.pid -ErrorAction Stop
                $null = $process.Handle
                if ($process.StartTime.ToUniversalTime().Ticks -ne $_.start_ticks) { throw 'fixture process identity changed' }
                $process
            })
            try {
                if ($method -eq 'Reap') { $group.Reap() } else { $group.Dispose() }
                foreach ($process in $processes) {
                    if (-not $process.WaitForExit(5000)) { throw "process survived $method" }
                }
            } finally { $processes | ForEach-Object { $_.Dispose() } }
            Write-Output "PASS ${method}: worker and descendant reaped"
        } finally {
            $group.Dispose()
            if ($child -and -not $child.HasExited) { $child.Kill(); $child.WaitForExit() }
        }
    }
} finally { Remove-Item -LiteralPath $root -Recurse -Force }
