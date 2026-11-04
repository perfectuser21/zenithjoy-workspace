param([string]$WorkflowText = '')
$ErrorActionPreference = 'Stop'
if (-not $WorkflowText) {
  $WorkflowText = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot '../../agent-preflight-e2e.yml')
}
$match = [regex]::Match($WorkflowText, '(?ms)^        id: github-proxy\r?\n        shell: powershell\r?\n        run: \|\r?\n(?<body>.*?)(?=^      - |\z)')
if (-not $match.Success) { throw 'Actual inline proxy step not found' }
$actualStep = [ScriptBlock]::Create([regex]::Replace($match.Groups['body'].Value, '(?m)^          ', ''))
$directory = Join-Path ([IO.Path]::GetTempPath()) ('zj-proxy-fixture-' + [guid]::NewGuid())
[void][IO.Directory]::CreateDirectory($directory)
$results = @()
# Environment is process-wide even when invoked as a child script in one shell.
# Preserve values in memory only; never print them or write the original env file.
$savedEnvironment = @{}
foreach ($name in @('GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0', 'GIT_CONFIG_KEY_1', 'GIT_CONFIG_VALUE_1', 'GITHUB_ENV')) {
  $savedEnvironment[$name] = @{
    Present = Test-Path ('Env:' + $name)
    Value = [Environment]::GetEnvironmentVariable($name, 'Process')
  }
}
# Replace only the TCP boundary. Every case executes the actual workflow body.
function New-Object {
  param([string]$TypeName)
  if ($TypeName -ne 'System.Net.Sockets.TcpClient') { throw 'Unexpected fixture dependency' }
  $wait = [pscustomobject]@{}
  $wait | Add-Member ScriptMethod WaitOne {
    param($milliseconds, $exitContext)
    if ($milliseconds -ne 750 -or $exitContext) { throw 'Probe must stay bounded' }
    return $script:signal
  }
  $client = [pscustomobject]@{ Connected = $script:connected; Wait = $wait }
  $client | Add-Member ScriptMethod BeginConnect {
    param($hostName, $port, $callback, $state)
    if ($hostName -ne '127.0.0.1' -or $port -ne 7890) { throw 'Probe escaped fixed loopback endpoint' }
    if ($script:beginFails) { throw 'Fixture connect failure' }
    return [pscustomobject]@{ AsyncWaitHandle = $this.Wait }
  }
  $client | Add-Member ScriptMethod EndConnect {
    param($pending)
    if ($script:endFails) { throw 'Fixture refused connection' }
  }
  $client | Add-Member ScriptMethod Close { $script:closed = $true }
  return $client
}
try {
  foreach ($case in @(
    @{ name = 'open-no-count'; signal = $true; connected = $true; count = $null; append = $true },
    @{ name = 'open-zero-count'; signal = $true; connected = $true; count = '0'; append = $true },
    @{ name = 'open-two-existing-items'; signal = $true; connected = $true; count = '2'; append = $true },
    @{ name = 'closed-preserves-existing'; signal = $false; connected = $false; count = '2'; append = $false },
    @{ name = 'begin-connect-fails'; beginFails = $true; count = '2'; append = $false },
    @{ name = 'end-connect-fails'; signal = $true; endFails = $true; count = '2'; append = $false },
    @{ name = 'not-connected'; signal = $true; connected = $false; count = '2'; append = $false },
    @{ name = 'invalid-count'; signal = $true; connected = $true; count = 'fixture-sensitive-count'; append = $false; rejects = $true },
    @{ name = 'negative-count'; signal = $true; connected = $true; count = '-1'; append = $false; rejects = $true },
    @{ name = 'overflow-count'; signal = $true; connected = $true; count = '2147483647'; append = $false; rejects = $true }
  )) {
    $script:signal = [bool]$case.signal; $script:connected = [bool]$case.connected
    $script:beginFails = [bool]$case.beginFails; $script:endFails = [bool]$case.endFails; $script:closed = $false
    Remove-Item Env:GIT_CONFIG_COUNT -ErrorAction SilentlyContinue
    if ($null -ne $case.count) { $env:GIT_CONFIG_COUNT = $case.count }
    $env:GIT_CONFIG_KEY_0 = 'credential.helper'; $env:GIT_CONFIG_VALUE_0 = 'fixture-sensitive-value-zero'
    $env:GIT_CONFIG_KEY_1 = 'http.extraHeader'; $env:GIT_CONFIG_VALUE_1 = 'fixture-sensitive-value-one'
    $env:GITHUB_ENV = Join-Path $directory ($case.name + '.env')
    [IO.File]::WriteAllText($env:GITHUB_ENV, "EXISTING_ENV_SENTINEL=keep`n")
    $rejected = $false; $log = ''
    try { $log = (& $actualStep 6>&1 | Out-String) } catch { $rejected = $true; $log = $_.Exception.Message }
    if ($rejected -ne [bool]$case.rejects) { throw ('Unexpected admission outcome: ' + $case.name) }
    if (-not $script:closed) { throw ('TCP client leaked: ' + $case.name) }
    if ($env:GIT_CONFIG_KEY_0 -ne 'credential.helper' -or $env:GIT_CONFIG_VALUE_0 -ne 'fixture-sensitive-value-zero' -or
        $env:GIT_CONFIG_KEY_1 -ne 'http.extraHeader' -or $env:GIT_CONFIG_VALUE_1 -ne 'fixture-sensitive-value-one') {
      throw ('Inherited Git config overwritten: ' + $case.name)
    }
    if ($env:GIT_CONFIG_COUNT -ne $case.count) { throw ('Current process count overwritten: ' + $case.name) }
    if ($log -match 'fixture-sensitive') { throw ('Sensitive fixture data entered diagnostics: ' + $case.name) }
    $lines = @(Get-Content -LiteralPath $env:GITHUB_ENV)
    $expected = @('EXISTING_ENV_SENTINEL=keep')
    if ($case.append) {
      $index = if ($null -eq $case.count) { 0 } else { [int]$case.count }
      $expected += "GIT_CONFIG_KEY_${index}=http.https://github.com/.proxy"
      $expected += "GIT_CONFIG_VALUE_${index}=http://127.0.0.1:7890"
      $expected += "GIT_CONFIG_COUNT=$($index + 1)"
    }
    if (($lines -join "`n") -cne ($expected -join "`n")) { throw ('Unexpected GitHub environment file: ' + $case.name) }
    $results += @{ case = $case.name; pass = $true; proxy_appended = [bool]$case.append; rejected = $rejected }
  }
  @{ scope = 'actual workflow body; TCP boundary fake; no network/global config/UI/credentials'; cases = $results; passed = $results.Count } | ConvertTo-Json -Depth 4 -Compress
} finally {
  try {
    Remove-Item -LiteralPath $directory -Recurse -Force
  } finally {
    foreach ($name in $savedEnvironment.Keys) {
      $saved = $savedEnvironment[$name]
      if ($saved.Present) {
        [Environment]::SetEnvironmentVariable($name, $saved.Value, 'Process')
      } else {
        [Environment]::SetEnvironmentVariable($name, $null, 'Process')
      }
    }
  }
}
