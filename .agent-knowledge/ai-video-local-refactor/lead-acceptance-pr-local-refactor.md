# Lead 自验证据 — AI 视频本地流水线（Local-First Refactor）

**Branch:** cp-20260516-ai-video-local-refactor  
**Machine:** xian-rog (Windows 11, Ryzen 9 + RTX 4090)  
**Date:** 2026-05-16  
**Lead:** Repo Lead

---

## Sprint 验收目标

Path 1 Step 5: 中台派 AI 视频处理任务 → Agent 本地处理视频文件（无需上传）→ 输出 9:16 + 16:9 MP4 到本地 `zenithjoy-output/<id>/`

---

## 验收步骤（5 步真链路）

### Step 1: 确认 Agent 运行中

```
ssh xian-rog "powershell -c 'Get-Process node | Select-Object Id, StartTime'"
# PID 8548, StartTime: 2026/5/16 20:09:30
```

**结果:** Agent 已通过 Task Scheduler 持久运行，SSH 断开后继续存活。

### Step 2: 确认 ffmpeg 可用（conda PATH）

ffmpeg 通过 conda-forge 安装：`C:\Users\asus\anaconda3\envs\new_env\Library\bin\ffmpeg.exe`  
DLL 目录已加入系统 PATH（永久）。  
Agent `findFfmpeg()` 函数在 `process.execPath` 同级目录、`process.cwd()`、固定路径、PATH 中依次查找。

### Step 3: 提交任务到中台

```bash
curl -X POST http://autopilot.zenjoymedia.media/api/ai-video/jobs \
  -H 'Content-Type: application/json' \
  -d '{"local_path":"C:\\Users\\asus\\Downloads\\27028526_1920x1080.mp4","topic":"Lead最终验证-status-fix"}'
# → job id: 80fcea0b-d5d0-423d-89bf-5ac9905f9721
```

源视频：`C:\Users\asus\Downloads\27028526_1920x1080.mp4`（65MB，真实 1920x1080 MP4）

### Step 4: Agent 自动处理流水线

Agent 15s 轮询发现 pending 任务，自动完成 10 步：
1. Claim job (progress=2%)
2. Probe duration via ffprobe
3. Extract audio WAV (pcm_s16le 16k mono)
4. 转写 (POST /api/ai-video/jobs/:id/transcribe)
5. 设计场景 (POST /api/ai-video/jobs/:id/design)
6. Compose HTML (POST /api/ai-video/jobs/:id/compose-html)
7. BGM (POST /api/ai-video/jobs/:id/bgm)
8. 生成 9:16 MP4 → `zenithjoy-output/<id>/9_16.mp4`
9. 生成 16:9 MP4 → `zenithjoy-output/<id>/16_9.mp4`
10. PUT /api/ai-video/jobs/:id/complete → status='completed'

### Step 5: 验证输出文件

```powershell
ls C:\Users\asus\Downloads\zenithjoy-output\80fcea0b-d5d0-423d-89bf-5ac9905f9721\
```

| 文件 | 大小 |
|------|------|
| 9_16.mp4 | 23,158,823 bytes (1080x1920) |
| 16_9.mp4 | 57,361,440 bytes (1920x1080) |

---

## 关键 Bug 修复记录

### Bug 1: findFfmpeg() 找不到 cwd 下的 ffmpeg
- **根因**: 旧代码只检查 `process.execPath` 同级目录，dev 模式下无法从 cwd 找 ffmpeg
- **修复**: 新增 `path.join(process.cwd(), 'ffmpeg.exe')` 检查

### Bug 2: completeJob 后 status 被覆写为 'processing'  
- **根因**: `progress()` 辅助函数始终发送 `{ status: 'processing' }`；旧代码在 `completeJob` 之后还调用 `await progress(apiBase, id, 100)`，把 status='completed' 覆写回 'processing'
- **修复**: 删除 Step 10 后的冗余 `await progress(apiBase, id, 100)` 调用

### Bug 3: 部署时只 SCP 了 dist/index.js
- **根因**: agent 使用 `require("./handlers/video-pipeline")`，实际逻辑在 `dist/handlers/video-pipeline.js`
- **修复**: 改为 `scp -r dist/` 部署整个目录

---

## ffmpeg 打包方案

**本次（ROG 临时方案）**: conda-forge ffmpeg + 系统 PATH DLL

**install-pack 客户方案（build-install-pack.sh）**:  
`build-install-pack.sh` 自动从 BtbN 下载 Windows 静态构建（`ffmpeg-master-latest-win64-gpl.zip`），解压 `ffmpeg.exe` + `ffprobe.exe` 到 install-pack 目录，与 `zenithjoy-agent.exe` 一同打包。客户无需手动安装。

---

## 结论

✅ 中台 API + DB 正常（部署在 100.71.151.105 Mac Mini，nginx 反代 autopilot.zenjoymedia.media）  
✅ Agent 本地文件读取（src_video = Windows 本地路径）  
✅ ffmpeg 可调用（conda-forge DLL PATH）  
✅ 视频处理输出到本地 zenithjoy-output/  
✅ completeJob 正确设置 status='completed'  
✅ Task Scheduler 保证 Agent 持久运行
