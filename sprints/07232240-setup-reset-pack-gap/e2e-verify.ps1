$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$taskName = 'ZenithJoyAgent'
$packVersion = '2.0.89'
$packUrl = 'https://zenithjoy-static-1333590468.cos.accelerate.myqcloud.com/install-pack/zenithjoy-agent-v2.0.89.tar.gz'
$runToken = if ($env:GITHUB_RUN_ID) { $env:GITHUB_RUN_ID } else { [guid]::NewGuid().ToString('N') }
$testRoot = "C:\Users\Public\zj-accept-1467-$runToken"
$archive = Join-Path $testRoot "zenithjoy-agent-v$packVersion.tar.gz"
$extractRoot = Join-Path $testRoot 'extract'
$stdoutFile = Join-Path $testRoot 'start-stdout.txt'
$stderrFile = Join-Path $testRoot 'start-stderr.txt'
$preflightStdout = Join-Path $testRoot 'preflight-stdout.txt'
$preflightStderr = Join-Path $testRoot 'preflight-stderr.txt'
$preflightExitFile = Join-Path $testRoot 'preflight-exit.txt'
$preflightBatch = Join-Path $testRoot 'run-preflight.bat'
$preflightReport = 'C:\Users\Public\zj-preflight.json'
$sharedDataDir = Join-Path $env:APPDATA 'zenithjoy-agent'
$sharedLog = Join-Path $sharedDataDir 'setup-reset.log'
$sharedLogBackup = Join-Path $testRoot 'setup-reset-before.log'

$testCmd = $null
$testDir = $null
$originalDir = $null
$originalTask = $null
$originalTaskXml = $null
$originalTaskExists = $false
$originalTaskSignature = '<absent>'
$hadSharedLog = $false
$testLaunchStarted = $false
$acceptancePassed = $false

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) {
        throw $Message
    }
}

function Write-Checkpoint {
    param([string]$Message)
    Write-Host "[acceptance] PASS: $Message"
}

function Get-AgentProcesses {
    return @(
        Get-CimInstance Win32_Process `
            -Filter "Name='zenithjoy-agent.exe'" `
            -ErrorAction SilentlyContinue
    )
}

function Get-TaskSignature {
    param($Task)

    if ($null -eq $Task) {
        return '<absent>'
    }

    return (@(
        $Task.Actions | ForEach-Object {
            "$($_.Execute)|$($_.Arguments)|$($_.WorkingDirectory)"
        }
    ) -join ';')
}

function Get-DotEnvValue {
    param([string]$Text, [string]$Key)

    $pattern = '(?m)^' + [regex]::Escape($Key) + '=(.*)$'
    $match = [regex]::Match($Text, $pattern)
    if (-not $match.Success) {
        return $null
    }
    return $match.Groups[1].Value.Trim()
}

function Set-DotEnvValue {
    param([string]$Path, [string]$Key, [string]$Value)

    $lines = [Collections.Generic.List[string]]::new()
    Get-Content $Path | ForEach-Object { $lines.Add([string]$_) }
    $found = $false

    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match ('^' + [regex]::Escape($Key) + '=')) {
            $lines[$i] = "$Key=$Value"
            $found = $true
        }
    }

    if (-not $found) {
        $lines.Add("$Key=$Value")
    }

    [IO.File]::WriteAllLines(
        $Path,
        $lines,
        [Text.UTF8Encoding]::new($false)
    )
}

function Get-DirectoryFromTask {
    param($Task)

    if ($null -eq $Task) {
        return $null
    }

    foreach ($action in @($Task.Actions)) {
        $arguments = [string]$action.Arguments
        $quoted = [regex]::Match($arguments, '(?i)"([^"]+\\start\.vbs)"')
        if ($quoted.Success) {
            return Split-Path -Parent $quoted.Groups[1].Value
        }

        $unquoted = [regex]::Match($arguments, '(?i)([A-Z]:\\.+\\start\.vbs)')
        if ($unquoted.Success) {
            return Split-Path -Parent $unquoted.Groups[1].Value.Trim()
        }
    }

    return $null
}

function Find-OriginalAgentDirectory {
    param($Task)

    foreach ($process in @(Get-AgentProcesses)) {
        $path = [string]$process.ExecutablePath
        if ($path) {
            $candidate = Split-Path -Parent $path
            if (Test-Path (Join-Path $candidate '.env')) {
                return $candidate
            }
        }
    }

    $taskDirectory = Get-DirectoryFromTask $Task
    if (
        $taskDirectory -and
        (Test-Path (Join-Path $taskDirectory '.env'))
    ) {
        return $taskDirectory
    }

    $desktop = Join-Path $env:USERPROFILE 'Desktop'
    if (Test-Path $desktop) {
        foreach ($candidate in @(
            Get-ChildItem $desktop -Directory -Filter 'zenithjoy-agent-v*' `
                -ErrorAction SilentlyContinue |
                Sort-Object LastWriteTimeUtc -Descending
        )) {
            if (Test-Path (Join-Path $candidate.FullName '.env')) {
                return $candidate.FullName
            }
        }
    }

    return $null
}

function Wait-Until {
    param(
        [scriptblock]$Condition,
        [int]$TimeoutSeconds,
        [string]$FailureMessage
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if (& $Condition) {
            return
        }
        Start-Sleep -Seconds 2
    }

    throw $FailureMessage
}

function Stop-TestProcessTree {
    param($Process)

    if ($null -eq $Process) {
        return
    }

    try {
        & "$env:SystemRoot\System32\taskkill.exe" `
            /PID $Process.Id /T /F 2>$null | Out-Null
    } catch {
        Write-Host "[acceptance] cleanup: test launcher tree already stopped"
    }
}

New-Item -ItemType Directory -Force -Path $testRoot | Out-Null
New-Item -ItemType Directory -Force -Path $extractRoot | Out-Null

$originalTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
$originalTaskExists = $null -ne $originalTask
$originalTaskSignature = Get-TaskSignature $originalTask
if ($originalTaskExists) {
    $originalTaskXml = Export-ScheduledTask -TaskName $taskName
}

$originalDir = Find-OriginalAgentDirectory $originalTask
Assert-True ([bool]$originalDir) 'cannot locate the current staging Agent directory'
$sourceConfigPath = Join-Path $originalDir '.env'
Assert-True (Test-Path $sourceConfigPath) 'current staging Agent configuration is missing'

$sourceConfigText = Get-Content $sourceConfigPath -Raw
$sourceLicense = Get-DotEnvValue $sourceConfigText 'ZENITHJOY_LICENSE'
$sourceEnvironment = Get-DotEnvValue $sourceConfigText 'ZENITHJOY_ENV'
$sourceApiBase = Get-DotEnvValue $sourceConfigText 'ZENITHJOY_API_BASE'

Assert-True (
    [bool]$sourceLicense -and
    $sourceLicense -ne '__PLACEHOLDER__' -and
    $sourceLicense -ne 'ZJ-F-XXXXXX'
) 'current staging Agent has no usable license'
Assert-True (
    $sourceEnvironment -eq 'staging' -or
    ($sourceApiBase -and $sourceApiBase -match 'staging')
) 'current Agent is not configured for staging'

Write-Checkpoint "source staging Agent located at $originalDir"
Write-Checkpoint "scheduled task snapshot state=$originalTaskExists"

if (Test-Path $sharedLog) {
    Copy-Item $sharedLog $sharedLogBackup -Force
    $hadSharedLog = $true
}

try {
    Write-Host "[acceptance] downloading real install pack v$packVersion"
    Invoke-WebRequest -Uri $packUrl -OutFile $archive -UseBasicParsing
    Assert-True ((Get-Item $archive).Length -gt 100MB) 'downloaded install pack is unexpectedly small'
    $archiveHash = (Get-FileHash $archive -Algorithm SHA256).Hash
    Write-Checkpoint "artifact downloaded size=$((Get-Item $archive).Length) sha256=$archiveHash"

    & tar.exe -xzf $archive -C $extractRoot
    Assert-True ($LASTEXITCODE -eq 0) 'install pack extraction failed'

    $testDirectoryItem = Get-ChildItem $extractRoot -Directory `
        -Filter "zenithjoy-agent-v$packVersion" |
        Select-Object -First 1
    Assert-True ($null -ne $testDirectoryItem) 'expected version directory is missing after extraction'
    $testDir = $testDirectoryItem.FullName

    foreach ($requiredFile in @(
        'setup-reset.ps1',
        'start.bat',
        'start.vbs',
        'zenithjoy-agent.exe'
    )) {
        Assert-True (
            Test-Path (Join-Path $testDir $requiredFile)
        ) "real artifact is missing $requiredFile"
    }
    Write-Checkpoint 'real artifact contains setup-reset and launcher files'

    $testConfigTemplate = Join-Path $testDir '.env.template'
    $testConfig = Join-Path $testDir '.env'
    Copy-Item $sourceConfigPath $testConfigTemplate -Force
    Set-DotEnvValue $testConfigTemplate 'ZENITHJOY_ENV' 'staging'
    Set-DotEnvValue $testConfigTemplate 'ZENITHJOY_AGENT_REAL_PUBLISH' '0'
    Remove-Item $testConfig -Force -ErrorAction SilentlyContinue
    Assert-True (-not (Test-Path $testConfig)) 'test configuration already exists before first launch'
    Write-Checkpoint 'disposable staging template prepared with real publishing disabled'

    Remove-Item $sharedLog -Force -ErrorAction SilentlyContinue
    $launchStartedUtc = (Get-Date).ToUniversalTime()
    $testLaunchStarted = $true
    $testCmd = Start-Process `
        -FilePath "$env:SystemRoot\System32\cmd.exe" `
        -ArgumentList @('/d', '/c', 'call start.bat') `
        -WorkingDirectory $testDir `
        -RedirectStandardOutput $stdoutFile `
        -RedirectStandardError $stderrFile `
        -PassThru

    Wait-Until -TimeoutSeconds 120 `
        -FailureMessage 'setup-reset did not produce a fresh terminal log' `
        -Condition {
            if (-not (Test-Path $sharedLog)) {
                return $false
            }
            $item = Get-Item $sharedLog
            if ($item.LastWriteTimeUtc -lt $launchStartedUtc.AddSeconds(-2)) {
                return $false
            }
            $content = Get-Content $sharedLog -Raw
            return (
                $content.Contains('[setup-reset] done') -or
                $content -match '\[ERROR\]'
            )
        }

    $resetLog = Get-Content $sharedLog -Raw
    Assert-True ($resetLog.Contains('[setup-reset] done')) 'setup-reset did not finish successfully'
    Assert-True ($resetLog -notmatch '\[ERROR\]') 'setup-reset log contains an error'

    Wait-Until -TimeoutSeconds 30 `
        -FailureMessage 'start launcher did not report setup-reset result' `
        -Condition {
            if (-not (Test-Path $stdoutFile)) {
                return $false
            }
            $output = Get-Content $stdoutFile -Raw
            return (
                $output -match '\[setup-reset\] first-run environment cleanup done' -or
                $output -match 'setup-reset failed'
            )
        }

    $startOutput = Get-Content $stdoutFile -Raw
    Assert-True (
        $startOutput -match '\[setup-reset\] first-run environment cleanup done'
    ) 'start launcher did not report setup-reset success'
    Assert-True (
        $startOutput -notmatch 'setup-reset failed'
    ) 'start launcher reported setup-reset failure'
    Assert-True (Test-Path $testConfig) 'first launch did not create its configuration'
    Write-Checkpoint 'first launch created configuration and reported setup-reset success'

    $temporaryTask = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
    $temporaryTaskSignature = Get-TaskSignature $temporaryTask
    Assert-True (
        $temporaryTaskSignature.IndexOf(
            $testDir,
            [StringComparison]::OrdinalIgnoreCase
        ) -ge 0
    ) 'scheduled task does not point at the test installation'
    Write-Checkpoint 'scheduled task temporarily points at the test installation'

    $apiBase = Get-DotEnvValue (Get-Content $testConfig -Raw) 'ZENITHJOY_API_BASE'
    if (-not $apiBase) {
        $apiBase = 'https://staging-autopilot.zenjoymedia.media'
    }
    Assert-True ($apiBase -match 'staging') 'test launch resolved a non-staging API base'

    $python = Join-Path $testDir 'python-embedded\python.exe'
    $preflight = Join-Path $testDir 'wechat-rpa\preflight.py'
    $psexec = 'C:\Users\asus\PSTools\PsExec64.exe'
    Assert-True (Test-Path $python) 'packaged Python is missing'
    Assert-True (Test-Path $preflight) 'packaged WeChat preflight is missing'
    Assert-True (Test-Path $psexec) 'PsExec64 is missing on xian-rog'

    Remove-Item $preflightReport -Force -ErrorAction SilentlyContinue
    $preflightLines = @(
        '@echo off',
        'set PYTHONUTF8=1',
        (
            '"' + $python + '" "' + $preflight +
            '" --dry-run --middleware-url "' + $apiBase +
            '" > "' + $preflightStdout + '" 2> "' + $preflightStderr + '"'
        ),
        ('echo %ERRORLEVEL% > "' + $preflightExitFile + '"')
    )
    Set-Content -Path $preflightBatch -Value $preflightLines -Encoding ascii

    & $psexec -i 1 -accepteula -w $testDir $preflightBatch | Out-Null
    Wait-Until -TimeoutSeconds 120 `
        -FailureMessage 'interactive packaged preflight did not finish' `
        -Condition { Test-Path $preflightExitFile }

    $preflightExit = [int](Get-Content $preflightExitFile -Raw)
    if ($preflightExit -ne 0) {
        if (Test-Path $preflightStdout) {
            Get-Content $preflightStdout | Select-Object -Last 80
        }
        if (Test-Path $preflightStderr) {
            Get-Content $preflightStderr | Select-Object -Last 40
        }
    }
    Assert-True ($preflightExit -eq 0) 'packaged preflight failed'
    Assert-True (Test-Path $preflightReport) 'packaged preflight report is missing'

    $report = Get-Content $preflightReport -Raw -Encoding utf8 |
        ConvertFrom-Json
    $loginCheck = $report.checks |
        Where-Object { $_.name -eq 'wechat_login' } |
        Select-Object -First 1
    Assert-True ($null -ne $loginCheck) 'preflight report has no WeChat login check'
    Assert-True (
        $loginCheck.status -eq 'ok'
    ) 'WeChat is not logged in in interactive session 1'
    Write-Checkpoint 'packaged preflight passed and detected logged-in WeChat'

    Wait-Until -TimeoutSeconds 300 `
        -FailureMessage 'test Agent executable did not start' `
        -Condition {
            foreach ($process in @(Get-AgentProcesses)) {
                $path = [string]$process.ExecutablePath
                if (
                    $path -and
                    $path.StartsWith(
                        $testDir,
                        [StringComparison]::OrdinalIgnoreCase
                    )
                ) {
                    return $true
                }
            }
            return $false
        }
    Write-Checkpoint 'test installation Agent process started'

    $acceptancePassed = $true
    Write-Host '[acceptance] ALL ACCEPTANCE ASSERTIONS PASSED'
} finally {
    Write-Host '[acceptance] restoring original staging state'

    if ($testLaunchStarted) {
        Stop-TestProcessTree $testCmd

        if ($testDir) {
            foreach ($process in @(Get-AgentProcesses)) {
                $path = [string]$process.ExecutablePath
                if (
                    $path -and
                    $path.StartsWith(
                        $testDir,
                        [StringComparison]::OrdinalIgnoreCase
                    )
                ) {
                    Stop-Process -Id $process.ProcessId -Force `
                        -ErrorAction SilentlyContinue
                }
            }
        }

        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false `
            -ErrorAction SilentlyContinue

        if ($originalTaskExists) {
            Register-ScheduledTask -TaskName $taskName `
                -Xml $originalTaskXml -Force | Out-Null
            Start-ScheduledTask -TaskName $taskName
        }
    }

    if ($testLaunchStarted) {
        if ($hadSharedLog) {
            New-Item -ItemType Directory -Force -Path $sharedDataDir | Out-Null
            Copy-Item $sharedLogBackup $sharedLog -Force
        } else {
            Remove-Item $sharedLog -Force -ErrorAction SilentlyContinue
        }
    }

    if ($testLaunchStarted) {
        $restoredTask = Get-ScheduledTask -TaskName $taskName `
            -ErrorAction SilentlyContinue
        $restoredTaskSignature = Get-TaskSignature $restoredTask
        Assert-True (
            $restoredTaskSignature -eq $originalTaskSignature
        ) 'scheduled task restoration does not match the snapshot'
        Write-Checkpoint 'scheduled task snapshot restored'

        if ($originalTaskExists) {
            Wait-Until -TimeoutSeconds 180 `
                -FailureMessage 'original staging Agent did not restart' `
                -Condition {
                    foreach ($process in @(Get-AgentProcesses)) {
                        $path = [string]$process.ExecutablePath
                        if (
                            $path -and
                            $path.StartsWith(
                                $originalDir,
                                [StringComparison]::OrdinalIgnoreCase
                            )
                        ) {
                            return $true
                        }
                    }
                    return $false
                }
            Write-Checkpoint 'original staging Agent restarted'
        }
    }

    Remove-Item $testRoot -Recurse -Force -ErrorAction SilentlyContinue
    Assert-True (-not (Test-Path $testRoot)) 'temporary acceptance directory cleanup failed'
    Write-Checkpoint 'temporary acceptance directory removed'
}

Assert-True $acceptancePassed 'acceptance did not reach the success state'
exit 0
