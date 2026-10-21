param([switch]$Worker, [string]$ConfigPath, [ValidateRange(1,600)][int]$TimeoutSeconds = 600)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
if (-not ('ZJProcessGroup' -as [type])) { Add-Type -Path (Join-Path $PSScriptRoot 'line02-process-job.cs') }

if ($Worker) {
    $c = Get-Content -LiteralPath $ConfigPath -Raw -Encoding utf8 | ConvertFrom-Json
    $code = 1
    try {
        $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
        if ($identity -ine $c.user) { throw 'INTERACTIVE_USER_MISMATCH' }
        if ((Get-Process -Id $PID).SessionId -eq 0) { throw 'INTERACTIVE_SESSION_REQUIRED' }
        [ZJProcessGroup]::Attach($c.job_name)
        @{ pid = $PID; start_ticks = (Get-Process -Id $PID).StartTime.ToUniversalTime().Ticks } | ConvertTo-Json | Set-Content -LiteralPath $c.worker_info -Encoding utf8
        $env:GITHUB_WORKSPACE = $c.workspace
        $env:GITHUB_SHA = $c.sha
        $env:AGENT_DIR = $c.agent
        $env:NODE_EXE = $c.node
        $env:SMOKE_KW = $c.keyword
        $env:PATH = (Split-Path $c.git) + ';' + $env:PATH
        $stderr = $c.log + '.stderr'
        $process = Start-Process -FilePath $c.bash -ArgumentList ('"' + $c.script + '"') -PassThru -NoNewWindow -RedirectStandardOutput $c.log -RedirectStandardError $stderr
        $null = $process.Handle # Cache handle before WaitForExit on Windows PowerShell 5.1.
        @{ pid = $process.Id; start_ticks = $process.StartTime.ToUniversalTime().Ticks } | ConvertTo-Json | Set-Content -LiteralPath $c.process_info -Encoding utf8
        if (-not $process.WaitForExit($c.timeout_seconds * 1000)) { throw 'INTERACTIVE_CANDIDATE_TIMEOUT' }
        $process.WaitForExit()
        $code = $process.ExitCode
        if (Test-Path -LiteralPath $stderr) { Get-Content -LiteralPath $stderr | Add-Content -LiteralPath $c.log -Encoding utf8 }
        if ($null -eq $code) { $code = 1 }
    } catch {
        $_ | Out-String | Set-Content -LiteralPath (Join-Path (Split-Path $c.result) 'worker-error.txt') -Encoding utf8
    } finally {
        @{ sha = $c.sha; exit_code = $code; user = $identity; session = (Get-Process -Id $PID).SessionId } |
            ConvertTo-Json | Set-Content -LiteralPath ($c.result + '.partial') -Encoding utf8
        Move-Item -LiteralPath ($c.result + '.partial') -Destination $c.result
    }
    exit $code
}

# This is the existing ROG test profile. Never search personal profiles or installed code.
$testUser = 'XX-ROG\asus'
$profile = 'C:\Temp\zj-douyin-burner-v1\' + [char]0x6d4b + [char]0x8bd5 + ' 1'
if ($env:COMPUTERNAME -ine 'XX-ROG') { throw 'APPROVED_TEST_HOST_REQUIRED' }
if ((Get-CimInstance Win32_ComputerSystem).UserName -ine $testUser) { throw 'APPROVED_TEST_USER_NOT_LOGGED_IN' }
if (-not (Test-Path -LiteralPath $profile -PathType Container)) { throw 'APPROVED_TEST_PROFILE_MISSING' }
if ($env:GITHUB_SHA -notmatch '^[a-f0-9]{40}$') { throw 'CANDIDATE_SHA_REQUIRED' }
$workspace = (Resolve-Path -LiteralPath $env:GITHUB_WORKSPACE).Path
$actual = (& git -C $workspace rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $actual -cne $env:GITHUB_SHA) { throw 'CANDIDATE_SHA_MISMATCH' }
$agent = Join-Path $workspace 'services\agent'
$envFile = Join-Path $agent '.env'
if (Test-Path -LiteralPath $envFile) { throw 'CANDIDATE_ENV_ALREADY_EXISTS' }
$bash = 'C:\Program Files\Git\bin\bash.exe'
if (-not (Test-Path -LiteralPath $bash)) { throw 'GIT_BASH_REQUIRED' }
$node = (Get-Command node -ErrorAction Stop).Source
$git = (Get-Command git -ErrorAction Stop).Source
$runId = [guid]::NewGuid().ToString('N')
$directory = Join-Path (Join-Path $workspace 'line02-candidate-evidence') $runId
New-Item -ItemType Directory -Path $directory -Force | Out-Null
$taskName = 'ZJLine02Candidate-' + $runId
$registered = $false
$createdEnv = $false
$group = $null
try {
    $workerSid = (New-Object Security.Principal.NTAccount($testUser)).Translate([Security.Principal.SecurityIdentifier]).Value
    $group = New-Object ZJProcessGroup(('Global\' + $taskName), $workerSid)
    [IO.File]::WriteAllText($envFile, "ZJ_MAIN_DATA_DIR=$profile`n", (New-Object Text.UTF8Encoding($false)))
    $createdEnv = $true
    $config = @{
        job_name = ('Global\' + $taskName); timeout_seconds = $TimeoutSeconds
        worker_info = (Join-Path $directory 'worker.json'); process_info = (Join-Path $directory 'process.json')
        workspace = $workspace; sha = $env:GITHUB_SHA; agent = $agent; node = $node; git = $git
        user = $testUser; keyword = $env:SMOKE_KW; bash = $bash
        script = (Join-Path $workspace '.github\workflows\scripts\smoke\line02-keyword-comment-smoke.sh')
        log = (Join-Path $directory 'stdout.log'); result = (Join-Path $directory 'result.json')
    }
    $configPath = Join-Path $directory 'config.json'
    $config | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding utf8
    $arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $PSCommandPath + '" -Worker -ConfigPath "' + $configPath + '"'
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments -WorkingDirectory $workspace
    $principal = New-ScheduledTaskPrincipal -UserId $testUser -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName $taskName -Action $action -Principal $principal -Settings $settings | Out-Null
    $registered = $true
    Start-ScheduledTask -TaskName $taskName
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds + 15)
    while (-not (Test-Path -LiteralPath $config.result)) {
        if ((Get-Date) -ge $deadline) { throw 'INTERACTIVE_CANDIDATE_TIMEOUT' }
        Start-Sleep -Seconds 2
    }
    # Worker writes its receipt only after the actual shared gate process returns.
    $receipt = Get-Content -LiteralPath $config.result -Raw -Encoding utf8 | ConvertFrom-Json
    Get-Content -LiteralPath $config.log -Encoding utf8
    if ($receipt.sha -cne $env:GITHUB_SHA -or $receipt.user -ine $testUser -or $receipt.session -le 0) { throw 'CANDIDATE_RECEIPT_IDENTITY_MISMATCH' }
    if ($receipt.exit_code -ne 0) { throw "CANDIDATE_GATE_FAILED exit=$($receipt.exit_code)" }
 } catch {
    $_ | Out-String | Set-Content -LiteralPath (Join-Path $directory 'failure.txt') -Encoding utf8
    throw
} finally {
    try {
        if ($null -ne $group) {
            $group.Reap()
            'PROCESS_TREE_REAPED' | Set-Content -LiteralPath (Join-Path $directory 'cleanup.txt') -Encoding ascii
        }
    } catch {
        'PROCESS_TREE_NOT_REAPED: ' + $_ | Set-Content -LiteralPath (Join-Path $directory 'cleanup-failure.txt') -Encoding utf8
        throw
    } finally {
        if ($null -ne $group) { $group.Dispose() }
        if ($registered) { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false }
        if ($createdEnv) { Remove-Item -LiteralPath $envFile }
        # Evidence remains in the workspace on success, failure, or timeout.
        if (-not (Test-Path -LiteralPath (Join-Path $directory 'result.json'))) {
            'Worker produced no receipt; inspect failure.txt and process identity.' | Set-Content -LiteralPath (Join-Path $directory 'missing-receipt.txt') -Encoding ascii
        }
    }
}
