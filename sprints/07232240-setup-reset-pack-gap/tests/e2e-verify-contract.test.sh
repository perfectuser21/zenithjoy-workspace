#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SCRIPT="$ROOT/sprints/07232240-setup-reset-pack-gap/e2e-verify.ps1"
WORKFLOW="$ROOT/.github/workflows/e2e-wechat-rpa.yml"

require_literal() {
  grep -Fq -- "$1" "$SCRIPT"
}

line_of() {
  grep -n -m1 -F -- "$1" "$SCRIPT" | cut -d: -f1
}

last_line_of() {
  grep -n -F -- "$1" "$SCRIPT" | tail -n 1 | cut -d: -f1
}

require_order() {
  local before after
  before="$(line_of "$1")"
  after="$(line_of "$2")"
  test "$before" -lt "$after"
}

test -f "$SCRIPT"
test -f "$WORKFLOW"
grep -Fq 'shell: powershell' "$WORKFLOW"
! grep -Fq 'shell: pwsh' "$WORKFLOW"
require_literal 'zenithjoy-agent-v2.0.89.tar.gz'
require_literal 'Export-ScheduledTask'
require_literal 'Register-ScheduledTask'
require_literal 'try {'
require_literal 'finally {'
require_literal 'ZENITHJOY_ENV'
require_literal 'staging'
require_literal "Set-DotEnvValue \$testConfigTemplate 'ZENITHJOY_AGENT_REAL_PUBLISH' '0'"
require_literal "Set-DotEnvValue \$testConfigTemplate 'REAL_PUBLISH' '0'"
require_literal "Set-DotEnvValue \$testConfigTemplate 'ZENITHJOY_API_BASE' \$stagingApiBase"
require_literal "Set-DotEnvValue \$testConfigTemplate 'ZENITHJOY_API_URL' \$stagingApiUrl"
require_literal '$stagingApiBase = '
require_literal 'https://staging-autopilot.zenjoymedia.media'
require_literal '$stagingApiUrl = '
require_literal 'wss://staging-autopilot.zenjoymedia.media/agent-ws'
require_literal 'prepared API base is not the required staging endpoint'
require_literal 'prepared API URL is not the required staging endpoint'
require_literal "Assert-True (\$null -ne \$originalTask) 'required original scheduled task is missing'"
require_literal 'GITHUB_RUN_ATTEMPT'
require_literal '[guid]::NewGuid()'
require_literal '$originalAgentPids'
require_literal '-not $originalAgentPids.Contains([int]$process.ProcessId)'
require_literal '$sharedLogMutationStarted = $true'
require_literal '$sharedLogRestored = $false'
require_literal '$script:sharedLogRestored = $true'
require_literal '$preflightReportMutationStarted = $true'
require_literal '$preflightReportBackup'
require_literal '$originalPreflightReportHash'
require_literal 'preflight report restoration hash mismatch'
require_literal 'function Remove-PathAndAssertAbsent'
require_literal 'Assert-True (-not (Test-Path $Path))'
require_literal 'function Invoke-CleanupStep'
require_literal '$cleanupErrors'
require_literal '$primaryError'
require_literal '[AggregateException]::new'
require_literal '[acceptance] ERROR:'
require_literal '$resetErrorLines'
require_literal 'setup-reset log contains an error:'
require_literal "Invoke-CleanupStep -Name 'register original scheduled task'"
require_literal "Invoke-CleanupStep -Name 'restore shared setup-reset log'"
require_literal "Invoke-CleanupStep -Name 'restore preflight report'"
require_literal "Invoke-CleanupStep -Name 'remove acceptance directory'"
require_literal 'setup-reset.log'
require_literal '[setup-reset] done'
require_literal 'preflight.py'
require_literal '--dry-run'
require_literal 'taskkill.exe'
require_literal 'Start-ScheduledTask'
require_literal '[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey'
require_literal '[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames'
require_literal 'GetValueNames()'
require_literal 'GetValueKind'
require_literal 'RegistryValueKind'
require_literal '$originalZenithjoyRegistry'
require_literal "Invoke-CleanupStep -Name 'reconcile HKCU Environment'"
require_literal 'registry reconciliation value mismatch'
require_literal '$preflightInvoker = Start-Process'
require_literal '$preflightInvoker.WaitForExit(120000)'
require_literal '$pythonProcess.WaitForExit(110000)'
require_literal "WriteAllText(\$exitFile, '124')"
require_literal "\$preflightCmd = Join-Path \$testRoot 'run-preflight.cmd'"
require_literal '[IO.File]::WriteAllLines('
require_literal "\$cmdExe = Join-Path \$env:SystemRoot 'System32\\cmd.exe'"
require_literal '$cmdExe,'
require_literal '$preflightInvoker'
require_literal "Invoke-CleanupStep -Name 'stop preflight invoker tree'"
require_literal "Assert-True ([string]\$originalTask.State -ne 'Disabled')"
require_literal "Assert-True (\$originalAgentPids.Count -gt 0)"
require_literal 'function Test-PathWithinDirectory'
require_literal '[IO.Path]::GetFullPath'
require_literal '[IO.Path]::DirectorySeparatorChar'
require_literal '$mutationBarrierPassed'
require_literal "Invoke-CleanupStep -Name 'wait for mutation stop barrier'"
require_literal 'RUNNER_TEMP'
require_literal '$env:TEMP'
require_literal 'icacls.exe'
require_literal '/inheritance:r'
require_literal 'SYSTEM:(OI)(CI)F'
require_literal 'acceptance directory ACL hardening failed'
require_literal '$expectedPackSha256 = '
require_literal 'edf5748a4f928b01242128cb111797bc1fa3cdf2901810b087d91e78d88fab88'
require_literal 'install pack SHA256 does not match v2.0.89'
require_literal 'runtime Agent real publish flag is not disabled'
require_literal 'runtime compatibility real publish flag is not disabled'
require_literal "Invoke-CleanupStep -Name 'remove test runtime configuration'"
require_literal "Invoke-CleanupStep -Name 'remove test configuration template'"
require_literal 'function Test-CommandLineReferencesPath'
require_literal 'function Get-TestMutationProcesses'
require_literal 'function Get-GlobalPreflightProcesses'
require_literal '$process.CommandLine'
require_literal '-not $originalAgentPids.Contains([int]$process.ProcessId)'
require_literal '$safeFinalCleanup'
require_literal 'if ($safeFinalCleanup) {'
require_literal 'manual recovery directory retained at'
require_literal '$originalAgentStartedUtc'
require_literal '$reportStability'
require_literal '.AddSeconds(10)'
require_literal '.AddSeconds(20)'
require_literal "Invoke-CleanupStep -Name 'wait for global preflight and report stability'"
require_literal '$preflightAndReportQuiescent'
require_literal '$pythonArgumentList = ('
require_literal '-ArgumentList $pythonArgumentList'
require_literal '.Replace('
require_literal "'\\\"'"

require_order "Assert-True (\$null -ne \$originalTask) 'required original scheduled task is missing'" \
  'New-Item -ItemType Directory -Force -Path $testRoot'
require_order 'Assert-True ($originalAgentPids.Count -gt 0)' \
  'New-Item -ItemType Directory -Force -Path $testRoot'
require_order '$registrySnapshotCaptured = $true' '$testLaunchStarted = $true'
require_order 'acceptance directory ACL verification failed' \
  'downloading real install pack'
require_order '$sharedLogMutationStarted = $true' \
  'Remove-PathAndAssertAbsent -Path $sharedLog'
require_order '$preflightReportMutationStarted = $true' \
  'Remove-PathAndAssertAbsent -Path $preflightReport'
require_order '$testLaunchStarted = $true' '$testCmd = Start-Process'
require_order '$pythonProcess.WaitForExit(110000)' \
  '$preflightInvoker.WaitForExit(120000)'
require_order "Invoke-CleanupStep -Name 'register original scheduled task'" \
  "Invoke-CleanupStep -Name 'restore shared setup-reset log'"
require_order "Invoke-CleanupStep -Name 'restore shared setup-reset log'" \
  "Invoke-CleanupStep -Name 'restore preflight report'"
require_order 'shared setup-reset log restoration hash mismatch' \
  '$script:sharedLogRestored = $true'
require_order 'shared setup-reset log cleanup failed' \
  '$script:sharedLogRestored = $true'
require_order "Invoke-CleanupStep -Name 'restore preflight report'" \
  "Invoke-CleanupStep -Name 'remove acceptance directory'"
require_order '$archiveHash = ' \
  'install pack SHA256 does not match v2.0.89'
require_order 'install pack SHA256 does not match v2.0.89' \
  '& tar.exe -xzf $archive'
require_order "Invoke-CleanupStep -Name 'stop preflight invoker tree'" \
  "Invoke-CleanupStep -Name 'wait for mutation stop barrier'"
require_order "Invoke-CleanupStep -Name 'unregister test scheduled task'" \
  "Invoke-CleanupStep -Name 'stop preflight invoker tree'"
require_order "Invoke-CleanupStep -Name 'wait for mutation stop barrier'" \
  "Invoke-CleanupStep -Name 'register original scheduled task'"
require_order "Invoke-CleanupStep -Name 'reconcile HKCU Environment'" \
  "Invoke-CleanupStep -Name 'start original scheduled task'"
require_order "Invoke-CleanupStep -Name 'wait for new original Agent process'" \
  "Invoke-CleanupStep -Name 'wait for global preflight and report stability'"
require_order "Invoke-CleanupStep -Name 'wait for global preflight and report stability'" \
  "Invoke-CleanupStep -Name 'restore preflight report'"
require_order "Invoke-CleanupStep -Name 'remove test runtime configuration'" \
  "Invoke-CleanupStep -Name 'remove test configuration template'"
require_order "Invoke-CleanupStep -Name 'remove test configuration template'" \
  "Invoke-CleanupStep -Name 'remove acceptance directory'"

primary_line="$(line_of '$primaryError = $null')"
root_line="$(line_of 'New-Item -ItemType Directory -Force -Path $testRoot')"
catch_line="$(last_line_of '} catch {')"
finally_line="$(last_line_of '} finally {')"
test "$primary_line" -lt "$root_line"
test "$root_line" -lt "$catch_line"
test "$catch_line" -lt "$finally_line"

test "$(grep -c -F '(-not $sharedLogMutationStarted) -or' "$SCRIPT")" -eq 2
test "$(grep -c -F '$sharedLogRestored' "$SCRIPT")" -eq 3
shared_log_start_gate_line="$(
  grep -n -m1 -F '(-not $sharedLogMutationStarted) -or' "$SCRIPT" |
    cut -d: -f1
)"
shared_log_final_gate_line="$(
  grep -n -F '(-not $sharedLogMutationStarted) -or' "$SCRIPT" |
    tail -n 1 |
    cut -d: -f1
)"
start_original_line="$(
  line_of "Invoke-CleanupStep -Name 'start original scheduled task'"
)"
safe_final_line="$(line_of '$safeFinalCleanup = (')"
test "$shared_log_start_gate_line" -lt "$start_original_line"
test "$safe_final_line" -lt "$shared_log_final_gate_line"

test "$(grep -c -F 'Remove-Item' "$SCRIPT")" -eq 1
! grep -Fq 'mutation stop barrier did not pass' "$SCRIPT"
! grep -Fq 'if ($mutationBarrierPassed) {' "$SCRIPT"
! grep -Eq 'Write-(Host|Output).*(LICENSE|\.env)' "$SCRIPT"
! grep -Eq 'Write-(Host|Output).*(sourceLicense|sourceConfigText|preparedConfigText)' "$SCRIPT"
! grep -Eq 'Write-(Host|Output).*(Registry|originalZenithjoyRegistry)' "$SCRIPT"

echo "e2e-verify contract: PASS"
