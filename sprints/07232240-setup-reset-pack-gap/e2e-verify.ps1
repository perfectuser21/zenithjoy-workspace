$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$taskName = 'ZenithJoyAgent'
$packVersion = '2.0.89'
$packUrl = 'https://zenithjoy-static-1333590468.cos.accelerate.myqcloud.com/install-pack/zenithjoy-agent-v2.0.89.tar.gz'
$expectedPackSha256 = 'edf5748a4f928b01242128cb111797bc1fa3cdf2901810b087d91e78d88fab88'
$stagingApiBase = 'https://staging-autopilot.zenjoymedia.media'
$stagingApiUrl = 'wss://staging-autopilot.zenjoymedia.media/agent-ws'

$runId = if ($env:GITHUB_RUN_ID) { $env:GITHUB_RUN_ID } else { 'local' }
$runAttempt = if ($env:GITHUB_RUN_ATTEMPT) { $env:GITHUB_RUN_ATTEMPT } else { '0' }
$runGuid = [guid]::NewGuid().ToString('N')
$runToken = "$runId-$runAttempt-$runGuid"
$privateTempRoot = if ($env:RUNNER_TEMP) {
    $env:RUNNER_TEMP
} elseif ($env:TEMP) {
    $env:TEMP
} else {
    [IO.Path]::GetTempPath()
}
$testRoot = Join-Path $privateTempRoot "zj-accept-1467-$runToken"
$archive = Join-Path $testRoot "zenithjoy-agent-v$packVersion.tar.gz"
$extractRoot = Join-Path $testRoot 'extract'
$stdoutFile = Join-Path $testRoot 'start-stdout.txt'
$stderrFile = Join-Path $testRoot 'start-stderr.txt'
$preflightStdout = Join-Path $testRoot 'preflight-stdout.txt'
$preflightStderr = Join-Path $testRoot 'preflight-stderr.txt'
$preflightExitFile = Join-Path $testRoot 'preflight-exit.txt'
$preflightWrapper = Join-Path $testRoot 'run-preflight.ps1'
$preflightCmd = Join-Path $testRoot 'run-preflight.cmd'
$psexecStdout = Join-Path $testRoot 'psexec-stdout.txt'
$psexecStderr = Join-Path $testRoot 'psexec-stderr.txt'
$preflightReport = 'C:\Users\Public\zj-preflight.json'
$preflightReportBackup = Join-Path $testRoot 'preflight-before.json'
$sharedDataDir = Join-Path $env:APPDATA 'zenithjoy-agent'
$sharedLog = Join-Path $sharedDataDir 'setup-reset.log'
$sharedLogBackup = Join-Path $testRoot 'setup-reset-before.log'

$testCmd = $null
$preflightInvoker = $null
$testDir = $null
$originalDir = $null
$originalTask = $null
$originalTaskXml = $null
$originalTaskSignature = $null
$originalAgentPids = [Collections.Generic.HashSet[int]]::new()
$originalZenithjoyRegistry = (
    [Collections.Generic.Dictionary[string, object]]::new(
        [StringComparer]::OrdinalIgnoreCase
    )
)
$originalSharedLogHash = $null
$originalPreflightReportHash = $null
$hadSharedLog = $false
$hadPreflightReport = $false
$testRootOwned = $false
$sharedLogMutationStarted = $false
$sharedLogRestored = $false
$preflightReportMutationStarted = $false
$testLaunchStarted = $false
$registrySnapshotCaptured = $false
$registryReconciled = $false
$mutationBarrierPassed = $false
$preflightAndReportQuiescent = $false
$originalTaskRegistered = $false
$originalTaskVerified = $false
$originalAgentStartedUtc = $null
$newOriginalAgentObserved = $false
$reportRestored = $false
$safeFinalCleanup = $false
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

function Test-PathWithinDirectory {
    param([string]$Path, [string]$Directory)

    if (-not $Path -or -not $Directory) {
        return $false
    }

    try {
        $normalizedPath = [IO.Path]::GetFullPath($Path)
        $trimChars = [char[]]@(
            [IO.Path]::DirectorySeparatorChar,
            [IO.Path]::AltDirectorySeparatorChar
        )
        $normalizedDirectory = (
            [IO.Path]::GetFullPath($Directory)
        ).TrimEnd($trimChars)
        $directoryPrefix = (
            $normalizedDirectory + [IO.Path]::DirectorySeparatorChar
        )
        return $normalizedPath.StartsWith(
            $directoryPrefix,
            [StringComparison]::OrdinalIgnoreCase
        )
    } catch {
        return $false
    }
}

function Test-CommandLineReferencesPath {
    param([string]$CommandLine, [string]$Directory)

    if (-not $CommandLine -or -not $Directory) {
        return $false
    }

    try {
        $trimChars = [char[]]@(
            [IO.Path]::DirectorySeparatorChar,
            [IO.Path]::AltDirectorySeparatorChar
        )
        $normalizedDirectory = (
            [IO.Path]::GetFullPath($Directory)
        ).TrimEnd($trimChars)
        $escapedDirectory = [regex]::Escape($normalizedDirectory)
        $pattern = (
            '(?i)(^|["''\s=])' + $escapedDirectory +
            '(?=\\|/|["''\s]|$)'
        )
        return [regex]::IsMatch($CommandLine, $pattern)
    } catch {
        return $false
    }
}

function Get-TestMutationProcesses {
    param(
        [string]$Root,
        [string]$Directory,
        [Collections.Generic.HashSet[int]]$OriginalAgentPids
    )

    return @(
        Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object {
            $process = $_
            $processName = [string]$process.Name
            $processCommandLine = [string]$process.CommandLine
            $isNewAgent = (
                $processName -ieq 'zenithjoy-agent.exe' -and
                -not $OriginalAgentPids.Contains([int]$process.ProcessId)
            )
            $referencesTestPath = (
                (Test-CommandLineReferencesPath $processCommandLine $Root) -or
                (
                    $Directory -and
                    (Test-CommandLineReferencesPath `
                        $processCommandLine $Directory)
                )
            )
            return $isNewAgent -or $referencesTestPath
        }
    )
}

function Get-GlobalPreflightProcesses {
    return @(
        Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object {
            $process = $_
            ([string]$process.CommandLine) -match '(?i)preflight\.py'
        }
    )
}

function Test-ProcessExited {
    param($Process)

    if ($null -eq $Process) {
        return $true
    }

    try {
        $Process.Refresh()
        return $Process.HasExited
    } catch {
        return $true
    }
}

function Test-RegistryValueEqual {
    param($Expected, $Actual)

    if ($Expected -is [Array] -or $Actual -is [Array]) {
        $expectedItems = @($Expected)
        $actualItems = @($Actual)
        if ($expectedItems.Count -ne $actualItems.Count) {
            return $false
        }
        for ($i = 0; $i -lt $expectedItems.Count; $i++) {
            if (-not [object]::Equals(
                $expectedItems[$i],
                $actualItems[$i]
            )) {
                return $false
            }
        }
        return $true
    }

    return [object]::Equals($Expected, $Actual)
}

function ConvertTo-PowerShellLiteral {
    param([string]$Value)

    return "'" + $Value.Replace("'", "''") + "'"
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
    Assert-True ([string]$originalTask.State -ne 'Disabled') `
        'required original scheduled task is disabled'
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
            Test-PathWithinDirectory $path $originalDir
        ) {
            $null = $originalAgentPids.Add([int]$process.ProcessId)
        }
    }
    Assert-True ($originalAgentPids.Count -gt 0) `
        'original staging Agent is not running'

    $environmentKey = (
        [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey(
            'Environment',
            $false
        )
    )
    Assert-True (
        $null -ne $environmentKey
    ) 'HKCU Environment registry key is unavailable'
    foreach ($name in @($environmentKey.GetValueNames())) {
        if ($name -like 'ZENITHJOY_*') {
            $originalZenithjoyRegistry[$name] = [PSCustomObject]@{
                Value = $environmentKey.GetValue(
                    $name,
                    $null,
                    [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames
                )
                Kind = [Microsoft.Win32.RegistryValueKind](
                    $environmentKey.GetValueKind($name)
                )
            }
        }
    }
    $environmentKey.Dispose()
    $registrySnapshotCaptured = $true

    Write-Checkpoint "source staging Agent located at $originalDir"
    Write-Checkpoint 'required scheduled task snapshot captured'
    Write-Checkpoint 'HKCU environment snapshot captured'
    Write-Checkpoint "original Agent PID count=$($originalAgentPids.Count)"

    Assert-True (
        -not (Test-Path $testRoot)
    ) 'unique acceptance directory already exists'
    $testRootOwned = $true
    New-Item -ItemType Directory -Force -Path $testRoot | Out-Null
    Assert-True (Test-Path $testRoot) 'acceptance directory creation failed'
    $currentIdentity = (
        [Security.Principal.WindowsIdentity]::GetCurrent().Name
    )
    $currentIdentityGrant = "${currentIdentity}:(OI)(CI)F"
    & "$env:SystemRoot\System32\icacls.exe" $testRoot `
        /inheritance:r /grant:r $currentIdentityGrant `
        'SYSTEM:(OI)(CI)F' | Out-Null
    Assert-True (
        $LASTEXITCODE -eq 0
    ) 'acceptance directory ACL hardening failed'
    & "$env:SystemRoot\System32\icacls.exe" $testRoot /verify | Out-Null
    Assert-True (
        $LASTEXITCODE -eq 0
    ) 'acceptance directory ACL verification failed'
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
    Assert-True (
        $archiveHash.ToLowerInvariant() -eq $expectedPackSha256
    ) 'install pack SHA256 does not match v2.0.89'
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
    $resetErrorLines = @(
        $resetLog -split "`r?`n" |
        Where-Object { $_ -match '\[ERROR\]' } |
        ForEach-Object { $_.Trim() }
    )
    Assert-True (
        $resetErrorLines.Count -eq 0
    ) (
        'setup-reset log contains an error: ' +
        ($resetErrorLines -join ' | ')
    )
    Assert-True (
        $resetLog.Contains('[setup-reset] done')
    ) 'setup-reset did not finish successfully'

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
    $agentRealPublish = Get-DotEnvValue `
        $runtimeConfigText 'ZENITHJOY_AGENT_REAL_PUBLISH'
    $compatRealPublish = Get-DotEnvValue $runtimeConfigText 'REAL_PUBLISH'
    Assert-True (
        $apiBase -eq $stagingApiBase
    ) 'test launch did not retain the required staging API base'
    Assert-True (
        $apiUrl -eq $stagingApiUrl
    ) 'test launch did not retain the required staging API URL'
    Assert-True (
        $agentRealPublish -eq '0'
    ) 'runtime Agent real publish flag is not disabled'
    Assert-True (
        $compatRealPublish -eq '0'
    ) 'runtime compatibility real publish flag is not disabled'

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
    $preflightWrapperTemplate = @'
$ErrorActionPreference = 'Stop'
$env:PYTHONUTF8 = '1'
$python = __PYTHON__
$preflight = __PREFLIGHT__
$apiBase = __API_BASE__
$stdoutFile = __STDOUT__
$stderrFile = __STDERR__
$exitFile = __EXIT_FILE__
$quotedPreflight = '"' + $preflight.Replace('"', '\"') + '"'
$quotedApiBase = '"' + $apiBase.Replace('"', '\"') + '"'
$pythonArgumentList = (
    $quotedPreflight + ' --dry-run --middleware-url ' + $quotedApiBase
)
$pythonProcess = Start-Process -FilePath $python `
    -ArgumentList $pythonArgumentList `
    -RedirectStandardOutput $stdoutFile `
    -RedirectStandardError $stderrFile `
    -PassThru
$finished = $pythonProcess.WaitForExit(110000)
if (-not $finished) {
    & "$env:SystemRoot\System32\taskkill.exe" `
        /PID $pythonProcess.Id /T /F 2>$null | Out-Null
    [IO.File]::WriteAllText($exitFile, '124')
    exit 124
}
[IO.File]::WriteAllText($exitFile, [string]$pythonProcess.ExitCode)
exit $pythonProcess.ExitCode
'@
    $preflightWrapperText = $preflightWrapperTemplate.Replace(
        '__PYTHON__',
        (ConvertTo-PowerShellLiteral $python)
    )
    $preflightWrapperText = $preflightWrapperText.Replace(
        '__PREFLIGHT__',
        (ConvertTo-PowerShellLiteral $preflight)
    )
    $preflightWrapperText = $preflightWrapperText.Replace(
        '__API_BASE__',
        (ConvertTo-PowerShellLiteral $apiBase)
    )
    $preflightWrapperText = $preflightWrapperText.Replace(
        '__STDOUT__',
        (ConvertTo-PowerShellLiteral $preflightStdout)
    )
    $preflightWrapperText = $preflightWrapperText.Replace(
        '__STDERR__',
        (ConvertTo-PowerShellLiteral $preflightStderr)
    )
    $preflightWrapperText = $preflightWrapperText.Replace(
        '__EXIT_FILE__',
        (ConvertTo-PowerShellLiteral $preflightExitFile)
    )
    [IO.File]::WriteAllText(
        $preflightWrapper,
        $preflightWrapperText,
        [Text.UTF8Encoding]::new($false)
    )

    $powershellExe = (
        "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
    )
    $cmdExe = Join-Path $env:SystemRoot 'System32\cmd.exe'
    [IO.File]::WriteAllLines(
        $preflightCmd,
        @(
            '@echo off',
            (
                '"' + $powershellExe + '"' +
                ' -NoProfile -ExecutionPolicy Bypass -File ' +
                '"' + $preflightWrapper + '"'
            ),
            'exit /b %ERRORLEVEL%'
        ),
        [Text.Encoding]::ASCII
    )
    $psexecArguments = @(
        '-i',
        '1',
        '-accepteula',
        '-w',
        ('"' + $testDir + '"'),
        $cmdExe,
        '/d',
        '/c',
        ('"' + $preflightCmd + '"')
    )
    $preflightInvoker = Start-Process `
        -FilePath $psexec `
        -ArgumentList $psexecArguments `
        -RedirectStandardOutput $psexecStdout `
        -RedirectStandardError $psexecStderr `
        -PassThru
    $preflightFinished = $preflightInvoker.WaitForExit(120000)
    if (-not $preflightFinished) {
        Stop-TestProcessTree $preflightInvoker
        throw 'interactive packaged preflight exceeded 120 seconds'
    }
    Assert-True (
        Test-Path $preflightExitFile
    ) 'interactive packaged preflight did not write an exit code'
    $preflightExit = [int](Get-Content $preflightExitFile -Raw)
    $preflightFailureChecks = @()
    if (Test-Path $preflightReport) {
        try {
            $failureReport = Get-Content $preflightReport -Raw `
                -Encoding utf8 | ConvertFrom-Json
            $preflightFailureChecks = @(
                $failureReport.checks |
                Where-Object { $_.status -ne 'ok' } |
                ForEach-Object { "$($_.name)=$($_.status)" }
            )
        } catch {
            $preflightFailureChecks = @('<report-parse-failed>')
        }
    }
    Assert-True (
        $preflightExit -eq 0
    ) (
        'packaged preflight failed: ' +
        "preflight_exit=$preflightExit " +
        "failing_checks=$($preflightFailureChecks -join ',')"
    )
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
                    Test-PathWithinDirectory $path $testDir
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
    Write-Host (
        "[acceptance] ERROR: acceptance failed: $($primaryError.Message)"
    )
} finally {
    Write-Host '[acceptance] restoring original staging state'

    if ($testLaunchStarted) {
        Invoke-CleanupStep -Name 'unregister test scheduled task' `
            -Errors $cleanupErrors -Action {
                Unregister-ScheduledTask -TaskName $taskName `
                    -Confirm:$false -ErrorAction Stop
            }

        Invoke-CleanupStep -Name 'stop preflight invoker tree' `
            -Errors $cleanupErrors -Action {
                Stop-TestProcessTree $preflightInvoker
            }

        Invoke-CleanupStep -Name 'stop test launcher tree' `
            -Errors $cleanupErrors -Action {
                Stop-TestProcessTree $testCmd
            }

        Invoke-CleanupStep -Name 'wait for mutation stop barrier' `
            -Errors $cleanupErrors -Action {
                Wait-Until -TimeoutSeconds 60 `
                    -FailureMessage 'test mutation processes did not stop' `
                    -Condition {
                        Stop-TestProcessTree $preflightInvoker
                        Stop-TestProcessTree $testCmd

                        $mutationProcesses = @(
                            Get-TestMutationProcesses `
                                $testRoot $testDir $originalAgentPids
                        )
                        foreach ($process in $mutationProcesses) {
                            Stop-Process -Id $process.ProcessId -Force `
                                -ErrorAction SilentlyContinue
                        }

                        $remainingMutationProcesses = @(
                            Get-TestMutationProcesses `
                                $testRoot $testDir $originalAgentPids
                        )
                        return (
                            (Test-ProcessExited $preflightInvoker) -and
                            (Test-ProcessExited $testCmd) -and
                            $remainingMutationProcesses.Count -eq 0
                        )
                    }
                $script:mutationBarrierPassed = $true
            }

        Invoke-CleanupStep -Name 'dispose test process handles' `
            -Errors $cleanupErrors -Action {
                if ($null -ne $preflightInvoker) {
                    $preflightInvoker.Dispose()
                }
                if ($null -ne $testCmd) {
                    $testCmd.Dispose()
                }
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
                $script:originalTaskVerified = $true
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
                $script:sharedLogRestored = $true
            }
    }

    if ($testLaunchStarted -and $registrySnapshotCaptured) {
        Invoke-CleanupStep -Name 'reconcile HKCU Environment' `
            -Errors $cleanupErrors -Action {
                $environmentKey = (
                    [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey(
                        'Environment',
                        $true
                    )
                )
                Assert-True (
                    $null -ne $environmentKey
                ) 'HKCU Environment registry key is unavailable for restore'

                $currentNames = @(
                    $environmentKey.GetValueNames() |
                    Where-Object { $_ -like 'ZENITHJOY_*' }
                )
                foreach ($name in $currentNames) {
                    if (-not $originalZenithjoyRegistry.ContainsKey($name)) {
                        $environmentKey.DeleteValue($name, $false)
                    }
                }

                foreach ($name in $originalZenithjoyRegistry.Keys) {
                    $entry = $originalZenithjoyRegistry[$name]
                    $environmentKey.SetValue(
                        $name,
                        $entry.Value,
                        [Microsoft.Win32.RegistryValueKind]($entry.Kind)
                    )
                }

                $expectedNames = @(
                    $originalZenithjoyRegistry.Keys | Sort-Object
                )
                $restoredNames = @(
                    $environmentKey.GetValueNames() |
                    Where-Object { $_ -like 'ZENITHJOY_*' } |
                    Sort-Object
                )
                Assert-True (
                    ($expectedNames -join "`0") -eq
                    ($restoredNames -join "`0")
                ) 'registry reconciliation name set mismatch'

                foreach ($name in $expectedNames) {
                    $entry = $originalZenithjoyRegistry[$name]
                    $restoredKind = $environmentKey.GetValueKind($name)
                    $restoredValue = $environmentKey.GetValue(
                        $name,
                        $null,
                        [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames
                    )
                    Assert-True (
                        $restoredKind -eq $entry.Kind
                    ) 'registry reconciliation kind mismatch'
                    Assert-True (
                        Test-RegistryValueEqual $entry.Value $restoredValue
                    ) 'registry reconciliation value mismatch'
                }
                $environmentKey.Dispose()
                $script:registryReconciled = $true
            }
    }

    if (
        $testLaunchStarted -and
        $mutationBarrierPassed -and
        $originalTaskRegistered -and
        $originalTaskVerified -and
        (
            (-not $sharedLogMutationStarted) -or
            $sharedLogRestored
        )
    ) {
        Invoke-CleanupStep -Name 'start original scheduled task' `
            -Errors $cleanupErrors -Action {
                Assert-True (
                    $script:registryReconciled
                ) 'HKCU Environment reconciliation did not succeed'
                Start-ScheduledTask -TaskName $taskName -ErrorAction Stop
                $script:originalAgentStartedUtc = (
                    Get-Date
                ).ToUniversalTime()
            }

        Invoke-CleanupStep -Name 'wait for new original Agent process' `
            -Errors $cleanupErrors -Action {
                Wait-Until -TimeoutSeconds 180 `
                    -FailureMessage 'a new original staging Agent did not start' `
                    -Condition {
                        foreach ($process in @(Get-AgentProcesses)) {
                            $path = [string]$process.ExecutablePath
                            if (
                                (Test-PathWithinDirectory $path $originalDir) -and
                                -not $originalAgentPids.Contains([int]$process.ProcessId)
                            ) {
                                return $true
                            }
                        }
                        return $false
                    }
                $script:newOriginalAgentObserved = $true
            }
    }

    if ($newOriginalAgentObserved) {
        $reportStability = [PSCustomObject]@{
            State = $null
            SinceUtc = $null
        }
        Invoke-CleanupStep -Name 'wait for global preflight and report stability' `
            -Errors $cleanupErrors -Action {
                Assert-True (
                    $null -ne $script:originalAgentStartedUtc
                ) 'original Agent start time is unavailable'
                Wait-Until -TimeoutSeconds 120 `
                    -FailureMessage (
                        'global preflight/report state did not become stable'
                    ) `
                    -Condition {
                        $preflightProcesses = @(
                            Get-GlobalPreflightProcesses
                        )
                        if ($preflightProcesses.Count -gt 0) {
                            $reportStability.State = $null
                            $reportStability.SinceUtc = $null
                            return $false
                        }

                        $nowUtc = (Get-Date).ToUniversalTime()
                        if (Test-Path $preflightReport) {
                            $reportItem = Get-Item $preflightReport
                            $reportHash = (
                                Get-FileHash $preflightReport -Algorithm SHA256
                            ).Hash
                            $reportState = (
                                "$($reportItem.Length)|" +
                                "$($reportItem.LastWriteTimeUtc.Ticks)|" +
                                $reportHash
                            )
                        } else {
                            $reportState = '<absent>'
                        }

                        if ($reportStability.State -ne $reportState) {
                            $reportStability.State = $reportState
                            $reportStability.SinceUtc = $nowUtc
                            return $false
                        }

                        return (
                            $null -ne $reportStability.SinceUtc -and
                            $nowUtc -ge (
                                $reportStability.SinceUtc
                            ).AddSeconds(10) -and
                            $nowUtc -ge (
                                $originalAgentStartedUtc
                            ).AddSeconds(20)
                        )
                    }
                $script:preflightAndReportQuiescent = $true
            }
    }

    if ($preflightReportMutationStarted) {
        Invoke-CleanupStep -Name 'restore preflight report' `
            -Errors $cleanupErrors -Action {
                Assert-True (
                    $script:preflightAndReportQuiescent
                ) 'global preflight/report state is not quiescent'
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
                $script:reportRestored = $true
            }
    }

    if (-not $testLaunchStarted) {
        $mutationBarrierPassed = $true
        $originalTaskRegistered = $true
        $originalTaskVerified = $true
    }
    $safeFinalCleanup = (
        $mutationBarrierPassed -and
        $originalTaskRegistered -and
        $originalTaskVerified -and
        (
            (-not $sharedLogMutationStarted) -or
            $sharedLogRestored
        ) -and
        (
            (-not $testLaunchStarted) -or
            $newOriginalAgentObserved
        ) -and
        (
            (-not $preflightReportMutationStarted) -or
            $reportRestored
        )
    )

    if ($safeFinalCleanup) {
        Invoke-CleanupStep -Name 'remove test runtime configuration' `
            -Errors $cleanupErrors -Action {
                if ($testDir) {
                    $testConfig = Join-Path $testDir '.env'
                    Remove-PathAndAssertAbsent -Path $testConfig `
                        -FailureMessage (
                            'test runtime configuration cleanup failed'
                        )
                }
            }

        Invoke-CleanupStep -Name 'remove test configuration template' `
            -Errors $cleanupErrors -Action {
                if ($testDir) {
                    $testConfigTemplate = Join-Path $testDir '.env.template'
                    Remove-PathAndAssertAbsent -Path $testConfigTemplate `
                        -FailureMessage (
                            'test configuration template cleanup failed'
                        )
                }
            }

        Invoke-CleanupStep -Name 'remove acceptance directory' `
            -Errors $cleanupErrors -Action {
                if ($testRootOwned) {
                    Remove-PathAndAssertAbsent -Path $testRoot -Recurse `
                        -FailureMessage (
                            'temporary acceptance directory cleanup failed'
                        )
                } else {
                    Assert-True (
                        -not (Test-Path $testRoot)
                    ) 'unowned acceptance directory unexpectedly exists'
                }
            }
    } elseif ($testRootOwned) {
        Write-Host (
            "[acceptance] manual recovery directory retained at $testRoot"
        )
    }
}

$allErrors = [Collections.Generic.List[Exception]]::new()
foreach ($cleanupError in $cleanupErrors) {
    Write-Host "[acceptance] ERROR: $($cleanupError.Message)"
}
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
