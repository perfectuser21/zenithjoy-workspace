# Spike: Android MediaProjection 截图/录音方案

Sprint: 07120952-line02-content-judgment-gate  
日期: 2026-07-12  
结论人: Android Agent 开发

## 结论

采用 **MediaProjection 一次性授权** 方案（one-time authorization）：

- 启动时弹一次系统权限对话框，用户授权后缓存 `MediaProjection` 实例
- 后续截图/录音无需再弹框，直接复用实例
- App 重启后需重新授权（系统限制，不可绕过）

## 截图路线（ContentJudgmentService）

1. `MediaProjectionManager.createScreenCaptureIntent()` 弹授权
2. `ImageReader` + `VirtualDisplay` 捕获屏幕帧
3. 压缩为 JPEG (quality=70)，base64 编码
4. POST `/api/acquisition/judge-video`（capture_type=screenshot）
5. 8s 超时 → 本地标 pending，不阻塞后续视频

## 录音路线（AudioRecordService，备用方案）

仅在截图无法获得视频音轨信息时启用（视频类型鉴别补充）：

1. `AudioPlaybackCaptureConfiguration`（Android 10+）捕获系统音频
2. 录制 3s PCM 片段，转 base64
3. POST `/api/acquisition/judge-video`（capture_type=audio）

## 已排除的方案

| 方案 | 排除原因 |
|------|---------|
| AccessibilityService 读取文本 | 无法判断视频内容，仅能读 UI 文字 |
| 直接调 Douyin API 拿视频元数据 | 需要登录态 + 反爬限制，不稳定 |
| OCR 屏幕截图本地推理 | 设备算力不足，延迟高 |
| 无限重试等待授权 | 用户体验差，一次性授权已足够 |

## 注意事项

- `MediaProjection` 实例必须在 `foreground service` 中持有，防止被系统回收
- 截图分辨率建议 720p（平衡质量与传输大小），base64 后约 100-200KB
- 录音片段 3s PCM 16kHz 单声道 base64 后约 90KB
- 生产环境不应传 `force_result` / `force_timeout` 参数（API 端校验 NODE_ENV）
