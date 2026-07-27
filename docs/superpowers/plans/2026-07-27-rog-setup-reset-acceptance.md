# Rog Setup Reset Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the real `2.0.89` install pack on xian-rog staging, prove first-run setup-reset and logged-in WeChat preflight work, then restore the original Agent state.

**Architecture:** Add a sprint-local PowerShell evaluator consumed by the existing self-hosted Harness workflow. A Bash contract test statically enforces the evaluator's fail-closed snapshot/restore and secret-handling boundaries before the evaluator is allowed to run on Rog.

**Tech Stack:** PowerShell 7, Windows ScheduledTasks/CIM APIs, GitHub Actions workflow dispatch, Bash contract testing.

---

### Task 1: Add the fail-closed evaluator contract

**Files:**
- Create: `sprints/07232240-setup-reset-pack-gap/tests/e2e-verify-contract.test.sh`
- Test: `sprints/07232240-setup-reset-pack-gap/tests/e2e-verify-contract.test.sh`

- [ ] **Step 1: Write the failing contract test**

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SCRIPT="$ROOT/sprints/07232240-setup-reset-pack-gap/e2e-verify.ps1"

test -f "$SCRIPT"
grep -Fq 'zenithjoy-agent-v2.0.89.tar.gz' "$SCRIPT"
grep -Fq 'Export-ScheduledTask' "$SCRIPT"
grep -Fq 'Register-ScheduledTask' "$SCRIPT"
grep -Fq 'try {' "$SCRIPT"
grep -Fq 'finally {' "$SCRIPT"
grep -Fq 'ZENITHJOY_ENV' "$SCRIPT"
grep -Fq 'staging' "$SCRIPT"
grep -Fq 'ZENITHJOY_AGENT_REAL_PUBLISH' "$SCRIPT"
grep -Fq 'setup-reset.log' "$SCRIPT"
grep -Fq '[setup-reset] done' "$SCRIPT"
grep -Fq 'preflight.py' "$SCRIPT"
grep -Fq -- '--dry-run' "$SCRIPT"
grep -Fq 'taskkill.exe' "$SCRIPT"
grep -Fq 'Start-ScheduledTask' "$SCRIPT"
! grep -Eq 'Write-(Host|Output).*(LICENSE|\\.env)' "$SCRIPT"

echo "e2e-verify contract: PASS"
```

- [ ] **Step 2: Run the contract and verify it fails before implementation**

Run:

```bash
bash sprints/07232240-setup-reset-pack-gap/tests/e2e-verify-contract.test.sh
```

Expected: non-zero exit because `e2e-verify.ps1` does not exist.

- [ ] **Step 3: Commit the red contract**

```bash
git add sprints/07232240-setup-reset-pack-gap/tests/e2e-verify-contract.test.sh
git commit -m "test(agent): define rog install acceptance contract"
```

### Task 2: Implement the xian-rog evaluator

**Files:**
- Create: `sprints/07232240-setup-reset-pack-gap/e2e-verify.ps1`
- Test: `sprints/07232240-setup-reset-pack-gap/tests/e2e-verify-contract.test.sh`

- [ ] **Step 1: Implement strict helpers and precondition discovery**

The script must enable strict error handling and define these helpers:

```powershell
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}

function Get-AgentProcesses {
    @(Get-CimInstance Win32_Process -Filter "Name='zenithjoy-agent.exe'" -ErrorAction SilentlyContinue)
}

function Get-TaskSignature {
    param($Task)
    if ($null -eq $Task) { return '<absent>' }
    return (@($Task.Actions | ForEach-Object {
        "$($_.Execute)|$($_.Arguments)|$($_.WorkingDirectory)"
    }) -join ';')
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
    if (-not $found) { $lines.Add("$Key=$Value") }
    [IO.File]::WriteAllLines($Path, $lines, [Text.UTF8Encoding]::new($false))
}
```

Discover the existing Agent directory from running process paths, then the
scheduled-task `start.vbs` argument, then `Desktop\zenithjoy-agent-v*`.
Accept only a directory containing `.env`. Read the environment without
printing it, and fail before mutation unless it contains a non-placeholder
license and either `ZENITHJOY_ENV=staging` or a staging API hostname.

- [ ] **Step 2: Snapshot task and shared log state**

Use:

```powershell
$originalTask = Get-ScheduledTask -TaskName 'ZenithJoyAgent' -ErrorAction SilentlyContinue
$originalTaskExists = $null -ne $originalTask
$originalTaskXml = if ($originalTaskExists) {
    Export-ScheduledTask -TaskName 'ZenithJoyAgent'
} else { $null }
$originalTaskSignature = Get-TaskSignature $originalTask

$sharedLog = Join-Path $env:APPDATA 'zenithjoy-agent\setup-reset.log'
if (Test-Path $sharedLog) {
    Copy-Item $sharedLog $logBackup -Force
    $hadSharedLog = $true
}
```

Do not log XML or environment contents.

- [ ] **Step 3: Download and prepare the real artifact**

Within a unique `C:\Users\Public\zj-accept-1467-$env:GITHUB_RUN_ID` directory:

```powershell
$url = 'https://zenithjoy-static-1333590468.cos.accelerate.myqcloud.com/install-pack/zenithjoy-agent-v2.0.89.tar.gz'
Invoke-WebRequest -Uri $url -OutFile $archive -UseBasicParsing
tar -xzf $archive -C $extractRoot
$testDir = (Get-ChildItem $extractRoot -Directory -Filter 'zenithjoy-agent-v2.0.89' | Select-Object -First 1).FullName

@('setup-reset.ps1', 'start.bat', 'start.vbs', 'zenithjoy-agent.exe') |
    ForEach-Object { Assert-True (Test-Path (Join-Path $testDir $_)) "missing $_" }

Copy-Item (Join-Path $originalDir '.env') (Join-Path $testDir '.env.template') -Force
Remove-Item (Join-Path $testDir '.env') -Force -ErrorAction SilentlyContinue
Set-DotEnvValue (Join-Path $testDir '.env.template') 'ZENITHJOY_ENV' 'staging'
Set-DotEnvValue (Join-Path $testDir '.env.template') 'ZENITHJOY_AGENT_REAL_PUBLISH' '0'
```

- [ ] **Step 4: Execute first launch and assert setup-reset**

Start `cmd.exe /d /c call start.bat` with stdout/stderr redirected inside the
test root. Poll up to 120 seconds for a fresh shared log. Fail unless:

```powershell
$resetLog -match '\[setup-reset\] done'
$resetLog -notmatch '\[ERROR\]'
$startOutput -match '\[setup-reset\] first-run environment cleanup done'
$startOutput -notmatch 'setup-reset failed'
Test-Path (Join-Path $testDir '.env')
```

Then query `ZenithJoyAgent` and assert its action contains the test directory.

- [ ] **Step 5: Assert Agent startup and logged-in WeChat preflight**

Poll up to 300 seconds for a `zenithjoy-agent.exe` process whose
`ExecutablePath` starts with the test directory. Parse only
`ZENITHJOY_API_BASE` from the copied test `.env`, then run:

```powershell
$python = Join-Path $testDir 'python-embedded\python.exe'
$preflight = Join-Path $testDir 'wechat-rpa\preflight.py'
$preflightProcess = Start-Process -FilePath $python `
    -ArgumentList @($preflight, '--dry-run', '--middleware-url', $apiBase) `
    -Wait -PassThru -NoNewWindow `
    -RedirectStandardOutput $preflightStdout `
    -RedirectStandardError $preflightStderr
Assert-True ($preflightProcess.ExitCode -eq 0) 'packaged preflight failed'
```

This covers the real Windows session, installed WeChat, WeChat version,
WeChat login, pywinauto, UIA, staging middleware, and hotkey checks.

- [ ] **Step 6: Restore original staging state in `finally`**

Always:

```powershell
if ($null -ne $testCmd -and -not $testCmd.HasExited) {
    & "$env:SystemRoot\System32\taskkill.exe" /PID $testCmd.Id /T /F | Out-Null
}
Get-AgentProcesses | Where-Object {
    $_.ExecutablePath -and $_.ExecutablePath.StartsWith($testDir, [StringComparison]::OrdinalIgnoreCase)
} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Unregister-ScheduledTask -TaskName 'ZenithJoyAgent' -Confirm:$false -ErrorAction SilentlyContinue
if ($originalTaskExists) {
    Register-ScheduledTask -TaskName 'ZenithJoyAgent' -Xml $originalTaskXml -Force | Out-Null
    Start-ScheduledTask -TaskName 'ZenithJoyAgent'
}
```

Restore or remove the shared log to match its original state. Assert the final
task signature equals the snapshot and, when an original task existed, wait for
an Agent process from the original directory. Remove the unique test directory.
Any restoration failure must fail the workflow.

- [ ] **Step 7: Run contract and commit**

Run:

```bash
bash sprints/07232240-setup-reset-pack-gap/tests/e2e-verify-contract.test.sh
git diff --check
```

Expected: `e2e-verify contract: PASS`, then exit zero.

Commit:

```bash
git add sprints/07232240-setup-reset-pack-gap/e2e-verify.ps1
git commit -m "test(agent): add rog install-pack acceptance evaluator"
```

### Task 3: Execute through Harness

**Files:**
- Verify: `sprints/07232240-setup-reset-pack-gap/e2e-verify.ps1`

- [ ] **Step 1: Push only the temporary verification branch**

```bash
git push -u origin cp-0727-rog-1467-acceptance
```

- [ ] **Step 2: Dispatch the existing self-hosted evaluator**

```bash
gh workflow run e2e-wechat-rpa.yml \
  --ref cp-0727-rog-1467-acceptance \
  -f task_id=73a75417-e636-407e-b29b-41faf41afde7 \
  -f sprint_dir=sprints/07232240-setup-reset-pack-gap \
  -f pr_branch=cp-0727-rog-1467-acceptance
```

- [ ] **Step 3: Monitor to terminal state**

Resolve the workflow run whose head branch and creation time match the dispatch:

```bash
RUN_ID=$(gh run list --workflow e2e-wechat-rpa.yml \
  --branch cp-0727-rog-1467-acceptance --event workflow_dispatch --limit 1 \
  --json databaseId --jq '.[0].databaseId')
test -n "$RUN_ID"
gh run watch "$RUN_ID" --interval 10
gh run view "$RUN_ID" --json status,conclusion,headSha,jobs,url
```

Expected: workflow and `e2e` job conclude `success`.

### Task 4: Verify restoration evidence

**Files:**
- Verify: GitHub Actions run log

- [ ] **Step 1: Read the full evaluator log**

```bash
gh run view "$RUN_ID" --log
```

Require explicit PASS records for artifact files, `.env` first creation,
setup-reset log, scheduled-task temporary action, Agent process, packaged
preflight, task restoration, and original Agent restart.

- [ ] **Step 2: Confirm no production mutation**

Confirm no `Agent Install Pack` workflow was manually dispatched, no manifest
endpoint was called by the evaluator, and `main` still points to the expected
commit or a descendant unrelated to the temporary branch.

- [ ] **Step 3: Update the task plan**

Mark the Rog acceptance complete only after the run is green and restoration is
visible in the same log. Keep the temporary branch until evidence review is
complete.
