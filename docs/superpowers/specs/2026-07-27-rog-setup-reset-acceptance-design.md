# xian-rog setup-reset install-pack acceptance design

## Goal

Prove that the install pack built from merge commit `12cf3468` can be
downloaded, extracted, and first-launched on the staging xian-rog machine, and
that the first launch really executes `setup-reset.ps1` before the Agent starts.

This is an acceptance run, not a production release. It must not change `main`,
publish a new manifest, or leave xian-rog pointing at a temporary installation.

## Execution path

Use the existing `E2E WeChat RPA (Self-Hosted)` workflow. It checks out a
temporary verification branch and runs
`sprints/07232240-setup-reset-pack-gap/e2e-verify.ps1` on the
`[self-hosted, wechat-capable]` xian-rog runner.

The script downloads the actual COS artifact
`zenithjoy-agent-v2.0.89.tar.gz`. The artifact was uploaded by the successful
`build` job in Actions run `30248373834`, which built merge commit `12cf3468`.
The later `publish` job failed while updating the HK manifest; that failure does
not invalidate the already-uploaded artifact, and this acceptance run must not
retry the manifest update.

## Safety and state restoration

Before changing Agent state, the script must:

1. Locate the currently installed Agent directory and its `.env`; fail before
   mutation if either cannot be located.
2. Record whether the `ZenithJoyAgent` scheduled task exists and, when it does,
   export it to XML.
3. Record the current Agent executable paths without printing secrets.
4. Create a unique test directory under `C:\Users\Public`.

The test installation copies the existing staging `.env` to the extracted
pack's `.env.template`, removes `.env`, and forces real first-run creation.
This preserves the staging license and endpoints without exposing their values
in logs.

The script must use `try/finally`. In `finally`, whether acceptance passes or
fails, it must stop Agent processes launched from the test directory, delete the
temporary scheduled task, restore and restart the original task when one
existed, preserve the original absence otherwise, remove the test directory,
and confirm the final task state matches the snapshot. The GitHub Actions runner
service is outside the Agent process tree and must never be stopped or
reconfigured.

## Acceptance assertions

The run passes only when all of these are true:

1. The extracted real artifact contains `setup-reset.ps1`, `start.bat`,
   `start.vbs`, and `zenithjoy-agent.exe`.
2. No `.env` exists before first launch, and first launch creates it from the
   staging template.
3. `%APPDATA%\zenithjoy-agent\setup-reset.log` is freshly written and contains
   `[setup-reset] done` with no `[ERROR]`.
4. `start.bat` output reports first-run cleanup success and does not report
   `setup-reset failed`.
5. The recreated `ZenithJoyAgent` task temporarily points at the extracted test
   installation.
6. The test installation's `zenithjoy-agent.exe` starts, and the packaged
   `python-embedded\python.exe wechat-rpa\preflight.py --dry-run` exits zero
   against the staging environment, including the logged-in WeChat checks.
7. Cleanup restores the original scheduled-task action and restarts the original
   staging Agent.

Any missing precondition, timeout, unsuccessful reset, failed Agent start, or
failed restoration makes the workflow red.

## Outputs

The workflow log records only paths, versions, process IDs, assertion results,
and task-action comparisons. It must not print `.env`, licenses, API tokens, or
secret values.

The temporary verification branch is retained until the acceptance evidence is
reviewed. It is not merged into `main`.
