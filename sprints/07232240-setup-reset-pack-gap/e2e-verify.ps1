$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$taskName = 'ZenithJoyAgent'
$packVersion = '2.0.89'
$packUrl = 'https://zenithjoy-static-1333590468.cos.accelerate.myqcloud.com/install-pack/zenithjoy-agent-v2.0.89.tar.gz'
$stagingApiBase = 'https://staging-autopilot.zenjoymedia.media'
$stagingApiUrl = 'wss://staging-autopilot.zenjoymedia.media/agent-ws'

$runId = if ($env:GITHUB_RUN_ID) { $env:GITHUB_RUN_ID } else { 'local' }
$runAttempt = if ($env:GITHUB_RUN_ATTEMPT) { $env:GITHUB_RUN_ATTEMPT } else { '0' }
$runGuid = [guid]::NewGuid().ToString('N')
$runToken = "$runId-$runAttempt-$runGuid"
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
$preflightReportBackup = Join-Path $testRoot 'preflight-before.json'
$sharedDataDir = Join-Path $env:APPDATA 'zenithjoy-agent'
$sharedLog = Join-Path $sharedDataDir 'setup-reset.log'
$sharedLogBackup = Join-Path $testRoot 'setup-reset-before.log'

$testCmd = $null
$testDir = $null
$originalDir = $null
$originalTask = $null
$originalTaskXml = $null
$originalTaskSignature = $null
$originalAgentPids = [Collections.Generic.HashSet[int]]::new()
$originalSharedLogHash = $null
$originalPreflightReportHash = $null
$hadSharedLog = $false
$hadPreflightReport = $false
$testRootOwned = $false
$sharedLogMutationStarted = $false
$preflightReportMutationStarted = $false
$testLaunchStarted = $false
$originalTaskRegistered = $false
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

function Remove-PathAndAssertAbsent {
    param(
        [string]$Path,
        [switch]$Recurse,
        [string]$FailureMessage
    )

    if (Test-Path $Path) {
        $removeArgs = @{
            LiteralPath = $Path
            Force = $true
            ErrorAction = 'SilentlyContinue'
        }
        if ($Recurse) {
            $removeArgs.Recurse = $true
        }
        Remove-Item @removeArgs
    }

    Assert-True (-not (Test-Path $Path)) $FailureMessage
}

function Invoke-CleanupStep {
    param(
        [string]$Name,
        [scriptblock]$Action,
        [Collections.Generic.List[Exception]]$Errors
    )

    try {
        & $Action
        Write-Checkpoint "cleanup $Name"
    } catch {
        $wrapped = [Exception]::new(
            "cleanup step '$Name' failed: $($_.Exception.Message)",
            $_.Exception
        )
        $Errors.Add($wrapped)
    }
}

function Stop-TestProcessTree {
    param($Process)

    if ($null -eq $Process) {
        return
    }

    if (-not $Process.HasExited) {
        & "$env:SystemRoot\System32\taskkill.exe" `
            /PID $Process.Id /T /F 2>$null | Out-Null
        Assert-True (
            $LASTEXITCODE -eq 0
        ) 'taskkill could not stop the test launcher process tree'
    }
}

$primaryError = $null
$cleanupErrors = [Collections.Generic.List[Exception]]::new()
try {
    $originalTask = Get-ScheduledTask -TaskName $taskName `
        -ErrorAction SilentlyContinue
    Assert-True ($null -ne $originalTask) 'required original scheduled task is missing'
    $originalTaskXml = Export-ScheduledTask -TaskName $taskName
    $originalTaskSignature = Get-TaskSignature $originalTask

    $originalDir = Find-OriginalAgentDirectory $originalTask
    Assert-True ([bool]$originalDir) 'cannot locate the current staging Agent directory'
    $sourceConfigPath = Join-Path $originalDir '.env'
    Assert-True (
        Test-Path $sourceConfigPath
    ) 'current staging Agent configuration is missing'

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

    foreach ($process in @(Get-AgentProcesses)) {
        $path = [string]$process.ExecutablePath
        if (
            $path -and
            $path.StartsWith(
                $originalDir,
                [StringComparison]::OrdinalIgnoreCase
            )
        ) {
            $null = $originalAgentPids.Add([int]$process.ProcessId)
        }
    }

    Write-Checkpoint "source staging Agent located at $originalDir"
    Write-Checkpoint 'required scheduled task snapshot captured'
    Write-Checkpoint "original Agent PID count=$($originalAgentPids.Count)"

    Assert-True (
        -not (Test-Path $testRoot)
    ) 'unique acceptance directory already exists'
    $testRootOwned = $true
    New-Item -ItemType Directory -Force -Path $testRoot | Out-Null
    Assert-True (Test-Path $testRoot) 'acceptance directory creation failed'
    New-Item -ItemType Directory -Force -Path $extractRoot | Out-Null
    Assert-True (Test-Path $extractRoot) 'extraction directory creation failed'

    if (Test-Path $sharedLog) {
        $hadSharedLog = $true
        $originalSharedLogHash = (
            Get-FileHash $sharedLog -Algorithm SHA256
        ).Hash
        Copy-Item $sharedLog $sharedLogBackup -Force
        Assert-True (
            Test-Path $sharedLogBackup
        ) 'shared setup-reset log backup is missing'
        Assert-True (
            (Get-FileHash $sharedLogBackup -Algorithm SHA256).Hash -eq
            $originalSharedLogHash
        ) 'shared setup-reset log backup hash mismatch'
    }

    if (Test-Path $preflightReport) {
        $hadPreflightReport = $true
        $originalPreflightReportHash = (
            Get-FileHash $preflightReport -Algorithm SHA256
        ).Hash
        Copy-Item $preflightReport $preflightReportBackup -Force
        Assert-True (
            Test-Path $preflightReportBackup
        ) 'preflight report backup is missing'
        Assert-True (
            (Get-FileHash $preflightReportBackup -Algorithm SHA256).Hash -eq
            $originalPreflightReportHash
        ) 'preflight report backup hash mismatch'
    }

    Write-Host "[acceptance] downloading real install pack v$packVersion"
    Invoke-WebRequest -Uri $packUrl -OutFile $archive -UseBasicParsing
    Assert-True (
        (Get-Item $archive).Length -gt 100MB
    ) 'downloaded install pack is unexpectedly small'
    $archiveHash = (Get-FileHash $archive -Algorithm SHA256).Hash
    Write-Checkpoint (
        "artifact downloaded size=$((Get-Item $archive).Length) " +
        "sha256=$archiveHash"
    )

    & tar.exe -xzf $archive -C $extractRoot
    Assert-True ($LASTEXITCODE -eq 0) 'install pack extraction failed'

    $testDirectoryItem = Get-ChildItem $extractRoot -Directory `
        -Filter "zenithjoy-agent-v$packVersion" |
        Select-Object -First 1
    Assert-True (
        $null -ne $testDirectoryItem
    ) 'expected version directory is missing after extraction'
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
    Set-DotEnvValue $testConfigTemplate 'REAL_PUBLISH' '0'
    Set-DotEnvValue $testConfigTemplate 'ZENITHJOY_API_BASE' $stagingApiBase
    Set-DotEnvValue $testConfigTemplate 'ZENITHJOY_API_URL' $stagingApiUrl
    Remove-PathAndAssertAbsent -Path $testConfig `
        -FailureMessage 'test configuration exists before first launch'

    $preparedConfigText = Get-Content $testConfigTemplate -Raw
    Assert-True (
        (Get-DotEnvValue $preparedConfigText 'ZENITHJOY_ENV') -eq 'staging'
    ) 'prepared environment is not staging'
    Assert-True (
        (Get-DotEnvValue $preparedConfigText 'ZENITHJOY_AGENT_REAL_PUBLISH') -eq
        '0'
    ) 'prepared Agent real publish flag is not disabled'
    Assert-True (
        (Get-DotEnvValue $preparedConfigText 'REAL_PUBLISH') -eq '0'
    ) 'prepared compatibility real publish flag is not disabled'
    Assert-True (
        (Get-DotEnvValue $preparedConfigText 'ZENITHJOY_API_BASE') -eq
        $stagingApiBase
    ) 'prepared API base is not the required staging endpoint'
    Assert-True (
        (Get-DotEnvValue $preparedConfigText 'ZENITHJOY_API_URL') -eq
        $stagingApiUrl
    ) 'prepared API URL is not the required staging endpoint'
    Write-Checkpoint 'disposable staging template is explicit and fail-closed'

    $sharedLogMutationStarted = $true
    Remove-PathAndAssertAbsent -Path $sharedLog `
        -FailureMessage 'shared setup-reset log removal failed'
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
    Assert-True (
        $resetLog.Contains('[setup-reset] done')
    ) 'setup-reset did not finish successfully'
    Assert-True (
        $resetLog -notmatch '\[ERROR\]'
    ) 'setup-reset log contains an error'

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
    Assert-True (
        Test-Path $testConfig
    ) 'first launch did not create its configuration'
    Write-Checkpoint 'first launch created configuration and reported success'

    $runtimeConfigText = Get-Content $testConfig -Raw
    $apiBase = Get-DotEnvValue $runtimeConfigText 'ZENITHJOY_API_BASE'
    $apiUrl = Get-DotEnvValue $runtimeConfigText 'ZENITHJOY_API_URL'
    Assert-True (
        $apiBase -eq $stagingApiBase
    ) 'test launch did not retain the required staging API base'
    Assert-True (
        $apiUrl -eq $stagingApiUrl
    ) 'test launch did not retain the required staging API URL'

    $temporaryTask = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
    $temporaryTaskSignature = Get-TaskSignature $temporaryTask
    Assert-True (
        $temporaryTaskSignature.IndexOf(
            $testDir,
            [StringComparison]::OrdinalIgnoreCase
        ) -ge 0
    ) 'scheduled task does not point at the test installation'
    Write-Checkpoint 'scheduled task temporarily points at test installation'

    $python = Join-Path $testDir 'python-embedded\python.exe'
    $preflight = Join-Path $testDir 'wechat-rpa\preflight.py'
    $psexec = 'C:\Users\asus\PSTools\PsExec64.exe'
    Assert-True (Test-Path $python) 'packaged Python is missing'
    Assert-True (Test-Path $preflight) 'packaged WeChat preflight is missing'
    Assert-True (Test-Path $psexec) 'PsExec64 is missing on xian-rog'

    $preflightReportMutationStarted = $true
    Remove-PathAndAssertAbsent -Path $preflightReport `
        -FailureMessage 'preflight report removal failed'
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
    Assert-True ($preflightExit -eq 0) 'packaged preflight failed'
    Assert-True (
        Test-Path $preflightReport
    ) 'packaged preflight report is missing'

    $report = Get-Content $preflightReport -Raw -Encoding utf8 |
        ConvertFrom-Json
    $loginCheck = $report.checks |
        Where-Object { $_.name -eq 'wechat_login' } |
        Select-Object -First 1
    Assert-True (
        $null -ne $loginCheck
    ) 'preflight report has no WeChat login check'
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
} catch {
    $primaryError = $_.Exception
} finally {
    Write-Host '[acceptance] restoring original staging state'

    if ($testLaunchStarted) {
        Invoke-CleanupStep -Name 'stop test launcher tree' `
            -Errors $cleanupErrors -Action {
                Stop-TestProcessTree $testCmd
            }

        Invoke-CleanupStep -Name 'stop test Agent processes' `
            -Errors $cleanupErrors -Action {
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
                                -ErrorAction Stop
                        }
                    }
                }
            }

        Invoke-CleanupStep -Name 'unregister test scheduled task' `
            -Errors $cleanupErrors -Action {
                Unregister-ScheduledTask -TaskName $taskName `
                    -Confirm:$false -ErrorAction Stop
            }

        Invoke-CleanupStep -Name 'register original scheduled task' `
            -Errors $cleanupErrors -Action {
                Register-ScheduledTask -TaskName $taskName `
                    -Xml $originalTaskXml -Force | Out-Null
                $script:originalTaskRegistered = $true
            }

        Invoke-CleanupStep -Name 'verify original scheduled task' `
            -Errors $cleanupErrors -Action {
                $restoredTask = Get-ScheduledTask -TaskName $taskName `
                    -ErrorAction Stop
                Assert-True (
                    (Get-TaskSignature $restoredTask) -eq
                    $originalTaskSignature
                ) 'scheduled task restoration does not match snapshot'
            }
    }

    if ($sharedLogMutationStarted) {
        Invoke-CleanupStep -Name 'restore shared setup-reset log' `
            -Errors $cleanupErrors -Action {
                if ($hadSharedLog) {
                    New-Item -ItemType Directory -Force `
                        -Path $sharedDataDir | Out-Null
                    Copy-Item $sharedLogBackup $sharedLog -Force
                    Assert-True (
                        Test-Path $sharedLog
                    ) 'shared setup-reset log restoration is missing'
                    Assert-True (
                        (Get-FileHash $sharedLog -Algorithm SHA256).Hash -eq
                        $originalSharedLogHash
                    ) 'shared setup-reset log restoration hash mismatch'
                } else {
                    Remove-PathAndAssertAbsent -Path $sharedLog `
                        -FailureMessage 'shared setup-reset log cleanup failed'
                }
            }
    }

    if ($preflightReportMutationStarted) {
        Invoke-CleanupStep -Name 'restore preflight report' `
            -Errors $cleanupErrors -Action {
                if ($hadPreflightReport) {
                    Copy-Item $preflightReportBackup $preflightReport -Force
                    Assert-True (
                        Test-Path $preflightReport
                    ) 'preflight report restoration is missing'
                    Assert-True (
                        (Get-FileHash $preflightReport -Algorithm SHA256).Hash -eq
                        $originalPreflightReportHash
                    ) 'preflight report restoration hash mismatch'
                } else {
                    Remove-PathAndAssertAbsent -Path $preflightReport `
                        -FailureMessage 'preflight report cleanup failed'
                }
            }
    }

    if ($testLaunchStarted) {
        Invoke-CleanupStep -Name 'start original scheduled task' `
            -Errors $cleanupErrors -Action {
                Assert-True (
                    $script:originalTaskRegistered
                ) 'original scheduled task registration did not succeed'
                Start-ScheduledTask -TaskName $taskName -ErrorAction Stop
            }

        Invoke-CleanupStep -Name 'wait for new original Agent process' `
            -Errors $cleanupErrors -Action {
                Wait-Until -TimeoutSeconds 180 `
                    -FailureMessage 'a new original staging Agent did not start' `
                    -Condition {
                        foreach ($process in @(Get-AgentProcesses)) {
                            $path = [string]$process.ExecutablePath
                            if (
                                $path -and
                                $path.StartsWith(
                                    $originalDir,
                                    [StringComparison]::OrdinalIgnoreCase
                                ) -and
                                -not $originalAgentPids.Contains([int]$process.ProcessId)
                            ) {
                                return $true
                            }
                        }
                        return $false
                    }
            }
    }

    Invoke-CleanupStep -Name 'remove acceptance directory' `
        -Errors $cleanupErrors -Action {
            if ($testRootOwned) {
                Remove-PathAndAssertAbsent -Path $testRoot -Recurse `
                    -FailureMessage 'temporary acceptance directory cleanup failed'
            } else {
                Assert-True (
                    -not (Test-Path $testRoot)
                ) 'unowned acceptance directory unexpectedly exists'
            }
        }
}

$allErrors = [Collections.Generic.List[Exception]]::new()
if ($null -ne $primaryError) {
    $allErrors.Add(
        [Exception]::new(
            "acceptance failed: $($primaryError.Message)",
            $primaryError
        )
    )
}
foreach ($cleanupError in $cleanupErrors) {
    $allErrors.Add($cleanupError)
}
if (-not $acceptancePassed -and $null -eq $primaryError) {
    $allErrors.Add([Exception]::new('acceptance did not reach success state'))
}

if ($allErrors.Count -gt 0) {
    throw [AggregateException]::new(
        'acceptance and cleanup reported one or more failures',
        [Exception[]]$allErrors.ToArray()
    )
}

exit 0
