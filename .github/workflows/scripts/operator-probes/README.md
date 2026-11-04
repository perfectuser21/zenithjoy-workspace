# Explicit headful operator probes

`line02-keyword-comment.sh` is the current Line02 keyword/comment read probe. It requires the approved Windows interactive desktop and dedicated Douyin profile. It does not belong to the automatic Linux `smoke/*.sh` inventory.

The existing current-candidate launcher is `.github/workflows/scripts/run-line02-candidate.ps1`, called by both the dedicated Line02 workflow and nightly. Its candidate SHA, approved user/profile, shared `zj-rog-desktop` mutex, process-tree cleanup and failure receipts remain in force. Moving the script does not prove a successful external run.

The probe's original bytes are retained, including its historical filename/usage comments. Current location:

```bash
bash .github/workflows/scripts/operator-probes/line02-keyword-comment.sh
```

Only the pure diagnostic definitions may run without the physical Windows environment:

```bash
source .github/workflows/scripts/operator-probes/line02-keyword-comment.sh --source-only
```

An expired session, missing headful Chrome, empty videos/comments or nonzero child exit remains failure. Do not call the physical launcher from Linux glob or treat a source-only diagnostic check as real keyword/comment acceptance.

## Native folder event diagnostic

Run explicitly from services/agent after installing the locked dependencies:

    npm exec -- tsx ../../.github/workflows/scripts/operator-probes/folder-watch-native.mjs

The probe owns and removes a temporary directory, calls the actual production manager and forwards real OS events. Native readiness and one target delivery each have an independent 8-second limit; the total native budget is 16 seconds. Failure exits nonzero and preserves diagnostics in stderr. Success is printed only after cleanup.

This is a source-checkout operator diagnostic, outside the default Vitest include and customer install pack. The production callback in src/index.ts currently logs events. Publishing obtains the bound path and independently reads the directory in handlers/douyin-publish.ts; it does not depend on native event delivery. The six existing folder binding/read/close tests and current publishing contracts remain blocking CI coverage.

macOS native event stability was not established by this audit. Historical positive and negative observations remain in docs/ci/round3-business-native-watch-results.json. This explicit probe does not establish platform login, publishing success or a cold-start delivery SLA.
