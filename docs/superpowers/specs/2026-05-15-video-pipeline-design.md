# AI Video Pipeline Design

Date: 2026-05-15
Branch: cp-video-pipeline-ai-editor

## Overview

Customer uploads a source video + script/title. The system transcribes audio with Whisper, rough-cuts silent/bad segments with FFmpeg, and exports both 9:16 and 16:9 versions. Walking skeleton only — no template library yet.

## Architecture

```
Browser → POST /api/ai-video/upload (hk-vps, multipart)
       → saves files to /opt/zenithjoy/video-pipeline/jobs/{job_id}/
       → SSHes xian-m4: nohup python3 process.py {job_id} &
       → returns {job_id}

Browser polls GET /api/ai-video/task/{job_id} every 5s
hk-vps polling loop reads status.json from xian-m4 via SSH cat

xian-m4: process.py
  1. Whisper transcription → segments.json
  2. FFmpeg rough cut (drop silences >1.5s)
  3. Export 9:16 (1080×1920) and 16:9 (1920×1080)
  4. SCP outputs back to hk-vps /opt/zenithjoy/video-pipeline/jobs/{job_id}/out/
  5. Write status.json {status, progress, outputs}

Browser downloads via GET /download/video-pipeline/jobs/{job_id}/out/{file}
```

## DB Migration

Extend `zenithjoy.ai_video_generations`:
```sql
ALTER TABLE zenithjoy.ai_video_generations
  ADD COLUMN IF NOT EXISTS source_video_path TEXT,
  ADD COLUMN IF NOT EXISTS script_text       TEXT,
  ADD COLUMN IF NOT EXISTS logo_path         TEXT,
  ADD COLUMN IF NOT EXISTS output_9_16_url   TEXT,
  ADD COLUMN IF NOT EXISTS output_16_9_url   TEXT;
```

`platform = 'local-whisper-ffmpeg'`, `model = 'whisper-large'`.

## Components

### 1. Upload Endpoint (hk-vps, apps/api)
`POST /api/ai-video/upload` — multer multipart, fields: `video` (required), `script` (required), `logo` (optional), `platform` (optional, default '9:16,16:9').

Saves to `/opt/zenithjoy/video-pipeline/jobs/{job_id}/src/`, writes DB row, spawns processing via SSH.

### 2. SSH Dispatch (hk-vps)
`services/video-pipeline/dispatch.ts` — thin wrapper:
```ts
ssh xian-m4 "nohup python3 /opt/video-pipeline/process.py JOB_ID > /opt/video-pipeline/jobs/JOB_ID/process.log 2>&1 &"
```
Files synced to xian-m4 via `scp` before dispatch.

### 3. process.py (xian-m4)
`services/video-pipeline/process.py`
- Read `config.json` for job params
- Whisper transcription → `segments.json`
- Build keep-segments list (drop silences, keep voiced)
- FFmpeg concat rough cut
- FFmpeg scale+crop for 9:16 and 16:9
- SCP outputs back to hk-vps job dir
- Write `status.json` with progress updates

### 4. Status Poller (hk-vps)
`services/video-pipeline/poller.ts` — started per-job after dispatch:
```ts
setInterval(() => {
  const status = JSON.parse(ssh("cat /opt/video-pipeline/jobs/{id}/status.json"))
  updateDB(id, status)
}, 5000)
```

### 5. Upload UI (`apps/api/public/video-editor.html`)
Single HTML page:
- File picker: video (mp4/mov), logo (png/jpg, optional)
- Textarea: script/title
- Submit → POST multipart
- Progress polling loop → shows progress bar + download links when done

## nginx (hk-vps)
Add location block to serve `/download/video-pipeline/` from `/opt/zenithjoy/video-pipeline/`.

## Testing Strategy

| Layer | What | How |
|-------|------|-----|
| E2E/smoke | Full upload → process → download | `.github/workflows/scripts/smoke/video-pipeline-smoke.sh` |
| Integration | upload endpoint saves files + DB row | `apps/api/src/services/__tests__/ai-video-upload.service.test.ts` |
| Unit | `buildKeepSegments()` logic | `process.py::test_build_keep_segments` |

Smoke script: curl upload a test video → poll until `completed` → verify both download URLs return 200.

## Storage Paths

```
hk-vps:
  /opt/zenithjoy/video-pipeline/
    jobs/{job_id}/
      src/video.mp4
      src/logo.png   (optional)
      config.json
      out/9_16.mp4
      out/16_9.mp4
    
xian-m4:
  /opt/video-pipeline/
    jobs/{job_id}/  (synced from hk-vps)
    process.py
    status.json     (written during processing)
```
