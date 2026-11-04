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
