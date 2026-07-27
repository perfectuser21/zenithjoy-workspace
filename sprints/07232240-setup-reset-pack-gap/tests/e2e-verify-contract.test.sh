#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SCRIPT="$ROOT/sprints/07232240-setup-reset-pack-gap/e2e-verify.ps1"

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

require_order "Assert-True (\$null -ne \$originalTask) 'required original scheduled task is missing'" \
  'New-Item -ItemType Directory -Force -Path $testRoot'
require_order '$sharedLogMutationStarted = $true' \
  'Remove-PathAndAssertAbsent -Path $sharedLog'
require_order '$preflightReportMutationStarted = $true' \
  'Remove-PathAndAssertAbsent -Path $preflightReport'
require_order '$testLaunchStarted = $true' '$testCmd = Start-Process'
require_order "Invoke-CleanupStep -Name 'register original scheduled task'" \
  "Invoke-CleanupStep -Name 'restore shared setup-reset log'"
require_order "Invoke-CleanupStep -Name 'restore shared setup-reset log'" \
  "Invoke-CleanupStep -Name 'restore preflight report'"
require_order "Invoke-CleanupStep -Name 'restore preflight report'" \
  "Invoke-CleanupStep -Name 'remove acceptance directory'"

primary_line="$(line_of '$primaryError = $null')"
root_line="$(line_of 'New-Item -ItemType Directory -Force -Path $testRoot')"
catch_line="$(last_line_of '} catch {')"
finally_line="$(last_line_of '} finally {')"
test "$primary_line" -lt "$root_line"
test "$root_line" -lt "$catch_line"
test "$catch_line" -lt "$finally_line"

test "$(grep -c -F 'Remove-Item' "$SCRIPT")" -eq 1
! grep -Eq 'Write-(Host|Output).*(LICENSE|\.env)' "$SCRIPT"
! grep -Eq 'Write-(Host|Output).*(sourceLicense|sourceConfigText|preparedConfigText)' "$SCRIPT"

echo "e2e-verify contract: PASS"
